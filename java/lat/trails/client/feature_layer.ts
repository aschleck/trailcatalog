import { S2LatLng } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { Camera, projectE7Array, projectS2LatLng } from 'js/map/camera';
import { RgbaU32, Vec2 } from 'js/map/common/types';
import { Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { GLYPHER, toGraphemes } from 'js/map/rendering/glypher';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { LocationIndex } from 'js/map/workers/location_index';
import { Z_USER_DATA, Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

import { FeatureStore } from './feature_store';
import { EditableFeature, EditableLine, EditablePoint } from './features';

const DEFAULT_LINE_COLOR = '#e8442e';
const DEFAULT_POINT_COLOR = '#e8442e';
const DEFAULT_WIDTH_PX = 3;
const POINT_RADIUS_PX = 5;
const SELECTED_POINT_RADIUS_PX = 7;
// The casing LineProgram draws is a pixel wide on each side, see line_cap_program.ts.
const CASING_PX = 1;
const SELECTED_CASING = 0xFFFFFFFF as RgbaU32;
const POINT_CASING = 0xFFFFFFFF as RgbaU32;
const LABEL_FILL = 0x1A1A1AFF as RgbaU32;
const LABEL_STROKE = 0xFFFFFFFF as RgbaU32;
// FONT_SIZE is 28, so labels are 14px.
const LABEL_SCALE = 0.5;
const LABEL_OFFSET_PX = [POINT_RADIUS_PX + 4, 0] as Vec2;
// Tracks recorded by GPS wiggle every few meters, and Glypher refuses to bend text around turns
// that sharp, so a label follows the line simplified to about this many pixels.
const LABEL_PATH_TOLERANCE_PX = 4;
// Where along a line to try starting its label, as fractions of its length, best first
const LABEL_ANCHORS = [0.5, 0.3, 0.7, 0.15, 0.85];

const Z_LINE = Z_USER_DATA;
const Z_SELECTED_LINE = Z_USER_DATA_HIGHLIGHT;
const Z_POINT = Z_USER_DATA_HIGHLIGHT + 1;
const Z_LABEL = Z_USER_DATA_HIGHLIGHT + 2;

// How far a line may sit from where it was drawn, which is only the rounding to E7. That moves
// each axis by up to half a unit, and mercator stretches latitude by sec(lat), so this covers
// drawing up to 83 degrees north or south, where sec reaches 8:
// => hypot(0.5, 0.5 * 8) = 4.03 E7 units
// => 4.03e-7 degrees, over 180 degrees to the mercator unit
const DRAWN_TOLERANCE = 4.03e-7 / 180;

interface ProjectedLine {
  feature: EditableLine;
  // The array these points came from, so that reprojecting can be skipped when it is unchanged
  latLngE7: Int32Array;
  points: Float64Array;
  // The line simplified for its label at an integer zoom, and the vertices to try starting it at
  label: {zoom: number; points: Float64Array; anchors: number[]}|undefined;
}

interface ProjectedPoint {
  feature: EditablePoint;
  at: Vec2;
}

/** Draws the open collection's features. */
export class FeatureLayer extends Layer {

  // Prefixed to everything this layer puts in the shared index
  private readonly producer: string;
  private hidden: ReadonlySet<string>;
  private selected: string|undefined;
  // Every line, visible or not, so that a folder toggling does not reproject its lines
  private readonly projected: Map<string, ProjectedLine>;
  private visibleLines: ProjectedLine[];
  private visiblePoints: ProjectedPoint[];
  // What is in the index, by line id, as the latLngE7 array it was built from
  private readonly published: Map<string, Int32Array>;
  private readonly glGeometry: WebGLBuffer;
  private geometry: ArrayBuffer;
  private geometryDrawables: Drawable[];
  private readonly glLabels: WebGLBuffer;
  private labels: ArrayBuffer;
  private labelDrawables: Drawable[];
  private generation: number;
  private planned: number;
  private labelsPlanned: {generation: number; zoom: number};
  // Glypher builds its atlas asynchronously and plans nothing for a grapheme it lacks, so labels
  // planned before the atlas holds them have to be planned again once it does.
  private labelsMissingGlyphs: boolean;

  constructor(
      private readonly store: FeatureStore,
      // Where lines go so that drawing snaps and routes along them
      private readonly locations: LocationIndex,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
  ) {
    super(/* copyright= */ []);
    this.producer = locations.producer();
    this.hidden = new Set();
    this.selected = undefined;
    this.projected = new Map();
    this.visibleLines = [];
    this.visiblePoints = [];
    this.published = new Map();
    // An imported day hike is about 100 kb of geometry.
    this.glGeometry = renderer.createDataBuffer(128 * 1024);
    this.geometry = new ArrayBuffer(128 * 1024);
    this.geometryDrawables = [];
    this.glLabels = renderer.createDataBuffer(16 * 1024);
    this.labels = new ArrayBuffer(16 * 1024);
    this.labelDrawables = [];
    this.generation = 0;
    this.planned = -1;
    this.labelsPlanned = {generation: -1, zoom: -1};
    this.labelsMissingGlyphs = false;
    this.registerDisposer(() => {
      renderer.deleteBuffer(this.glGeometry);
      renderer.deleteBuffer(this.glLabels);
      this.locations.unload([...this.published.keys()].map(id => this.key(id)));
    });

    store.listen(() => {
      this.refresh();
    });
  }

  /** Hides the features with these ids, and everything inside the folders among them. */
  setHidden(hidden: ReadonlySet<string>): void {
    this.hidden = hidden;
    this.refresh();
  }

  setSelected(id: string|undefined): void {
    if (id === this.selected) {
      return;
    }

    this.selected = id;
    this.generation += 1;
  }

  isVisible(feature: EditableFeature): boolean {
    let at: EditableFeature|undefined = feature;
    while (at) {
      if (this.hidden.has(at.id)) {
        return false;
      }

      const parent = this.store.parentOf(at);
      at = parent !== undefined ? this.store.get(parent) : undefined;
    }
    return true;
  }

  override hasNewData(): boolean {
    return this.generation !== this.planned || this.labelsMissingGlyphs;
  }

  override render(planner: Planner, zoom: number): void {
    if (this.generation !== this.planned) {
      this.planGeometry();
      this.planned = this.generation;
    }
    // Curved labels are laid out in pixels along mercator paths, so they follow the zoom.
    if (
        this.labelsMissingGlyphs
            || this.labelsPlanned.generation !== this.generation
            || this.labelsPlanned.zoom !== zoom) {
      this.planLabels(zoom);
      this.labelsPlanned = {generation: this.generation, zoom};
    }

    planner.add(this.geometryDrawables);
    planner.add(this.labelDrawables);
  }

  private refresh(): void {
    const lines = this.store.lines();
    const live = new Set<string>();
    this.visibleLines = [];
    for (const line of lines) {
      live.add(line.id);
      let projected = this.projected.get(line.id);
      if (!projected || projected.latLngE7 !== line.latLngE7) {
        const points = projectE7Array(line.latLngE7);
        projected = {feature: line, latLngE7: line.latLngE7, points, label: undefined};
        this.projected.set(line.id, projected);
      }
      projected.feature = line;
      if (this.isVisible(line)) {
        this.visibleLines.push(projected);
      }
    }
    for (const id of [...this.projected.keys()]) {
      if (!live.has(id)) {
        this.projected.delete(id);
      }
    }

    this.visiblePoints = [];
    for (const point of this.store.points()) {
      if (this.isVisible(point)) {
        this.visiblePoints.push({
          feature: point,
          at: projectS2LatLng(S2LatLng.fromE7(point.latE7, point.lngE7)),
        });
      }
    }

    this.publish();
    this.generation += 1;
  }

  // Puts visible lines into the index so that drawing snaps onto them and routes along them. A
  // vertex that snapped onto a line's vertex sits on it exactly, since E7 round trips those
  // coordinates, and an end that snapped partway along a segment joins it within
  // DRAWN_TOLERANCE.
  //
  // Each line is its own group, keyed by its id, so that editing one line does not reproject
  // every other.
  private publish(): void {
    const wanted = new Map<string, ProjectedLine>();
    for (const line of this.visibleLines) {
      wanted.set(line.feature.id, line);
    }

    const stale = [];
    for (const [id, latLngE7] of this.published) {
      if (wanted.get(id)?.latLngE7 !== latLngE7) {
        stale.push(id);
      }
    }
    if (stale.length > 0) {
      this.locations.unload(stale.map(id => this.key(id)));
      for (const id of stale) {
        this.published.delete(id);
      }
    }

    for (const [id, line] of wanted) {
      if (this.published.has(id)) {
        continue;
      }

      const key = this.key(id);
      this.locations.load(key, DRAWN_TOLERANCE, [{id: key, points: line.points}], []);
      this.published.set(id, line.latLngE7);
    }
  }

  private key(id: string): string {
    return `${this.producer}${id}`;
  }

  private planGeometry(): void {
    const selectedLine = this.visibleLines.find(l => l.feature.id === this.selected);
    let needed = 0;
    for (const line of this.visibleLines) {
      needed += LineProgram.bytesNeeded(line.points.length / 2);
    }
    if (selectedLine) {
      needed += LineProgram.bytesNeeded(selectedLine.points.length / 2);
    }
    // Each point is a zero length segment, which the cap program draws as a circle.
    needed += this.visiblePoints.length * LineProgram.bytesNeeded(2);
    this.geometry = growBuffer(this.geometry, needed);

    const drawables: Drawable[] = [];
    let offset = 0;
    const push = (
        fill: RgbaU32,
        stroke: RgbaU32,
        radius: number,
        points: ArrayLike<number>,
        z: number,
        joins: 'line'|'caps'|'both') => {
      const result =
          LineProgram.push(
              fill, stroke, radius, /* stipple= */ false, points, this.geometry, offset);
      offset += result.geometryByteLength;
      if (result.instanceCount === 0) {
        return;
      }

      const drawable = {
        elements: undefined,
        geometry: this.glGeometry,
        geometryByteLength: result.geometryByteLength,
        geometryOffset: result.geometryOffset,
        instanced: {
          count: result.instanceCount,
        },
        program: this.renderer.lineProgram,
        texture: undefined,
        vertexCount: result.vertexCount,
        z,
      };
      if (joins !== 'caps') {
        drawables.push(drawable);
      }
      // Circles at the joins, or else a corner shows the gap between two unmitered rectangles.
      if (joins !== 'line') {
        drawables.push({...drawable, program: this.renderer.lineCapProgram});
      }
    };

    for (const line of this.visibleLines) {
      const color = parseColor(line.feature.data.stroke ?? DEFAULT_LINE_COLOR);
      push(color, darken(color), lineRadius(line.feature), line.points, Z_LINE, 'both');
    }
    if (selectedLine) {
      const color = parseColor(selectedLine.feature.data.stroke ?? DEFAULT_LINE_COLOR);
      push(
          color,
          SELECTED_CASING,
          lineRadius(selectedLine.feature) + 2,
          selectedLine.points,
          Z_SELECTED_LINE,
          'both');
    }
    for (const point of this.visiblePoints) {
      const color = parseColor(point.feature.data.fill ?? DEFAULT_POINT_COLOR);
      const selected = point.feature.id === this.selected;
      push(
          color,
          selected ? SELECTED_CASING : POINT_CASING,
          selected ? SELECTED_POINT_RADIUS_PX : POINT_RADIUS_PX,
          [point.at[0], point.at[1], point.at[0], point.at[1]],
          Z_POINT,
          'caps');
    }

    if (offset > 0) {
      this.renderer.uploadData(this.geometry, offset, this.glGeometry);
    }
    this.geometryDrawables = drawables;
  }

  private planLabels(zoom: number): void {
    const labeled: Array<{graphemes: string[]; line?: ProjectedLine; point?: ProjectedPoint}> = [];
    let needed = 0;
    for (const line of this.visibleLines) {
      const name = line.feature.data.name;
      if (name) {
        const graphemes = toGraphemes(name);
        needed += GLYPHER.bytesNeeded(graphemes);
        labeled.push({graphemes, line});
      }
    }
    for (const point of this.visiblePoints) {
      const name = point.feature.data.name;
      if (name) {
        const graphemes = toGraphemes(name);
        needed += GLYPHER.bytesNeeded(graphemes);
        labeled.push({graphemes, point});
      }
    }
    this.labels = growBuffer(this.labels, needed);

    // Pixels per mercator unit, see mbtile_layer.ts#render.
    const pixelsPerWorld = 256 * Math.pow(2, zoom - 1);
    const drawables = [];
    let offset = 0;
    this.labelsMissingGlyphs = false;
    for (const {graphemes, line, point} of labeled) {
      if (!GLYPHER.measurePx(graphemes, LABEL_SCALE)) {
        this.labelsMissingGlyphs = true;
        continue;
      }

      if (point) {
        const planned =
            GLYPHER.plan(
                graphemes,
                point.at,
                labelOffset(graphemes),
                LABEL_SCALE,
                /* angle= */ 0,
                LABEL_FILL,
                LABEL_STROKE,
                Z_LABEL,
                this.labels,
                offset,
                this.glLabels,
                this.renderer);
        drawables.push(...planned.drawables);
        offset += planned.byteSize;
        continue;
      }

      const path = labelPath(line!, zoom);
      for (const anchor of path.anchors) {
        const planned =
            GLYPHER.planCurved(
                graphemes,
                path.points.subarray(2 * anchor),
                pixelsPerWorld,
                LABEL_SCALE,
                LABEL_FILL,
                LABEL_STROKE,
                Z_LABEL,
                this.labels,
                offset,
                this.glLabels,
                this.renderer);
        if (planned.drawables.length > 0) {
          drawables.push(...planned.drawables);
          offset += planned.byteSize;
          break;
        }
      }
    }

    if (offset > 0) {
      this.renderer.uploadData(this.labels, offset, this.glLabels);
    }
    this.labelDrawables = drawables;
  }
}

// Glypher centers text on its anchor, so shifting by half the width puts it right of the marker.
function labelOffset(graphemes: string[]): Vec2 {
  const size = GLYPHER.measurePx(graphemes, LABEL_SCALE);
  return [LABEL_OFFSET_PX[0] + (size ? size[0] / 2 : 0), LABEL_OFFSET_PX[1]];
}

function lineRadius(line: EditableLine): number {
  return (line.data.width_px ?? DEFAULT_WIDTH_PX) / 2 + CASING_PX;
}

function labelPath(line: ProjectedLine, zoom: number):
    {points: Float64Array; anchors: number[]} {
  const level = Math.floor(zoom);
  if (line.label?.zoom !== level) {
    // Simplified for the integer zoom, so the path holds still while zooming within it
    const points =
        simplify(line.points, LABEL_PATH_TOLERANCE_PX / (256 * Math.pow(2, level - 1)));
    line.label = {zoom: level, points, anchors: anchorVertices(points)};
  }
  return line.label;
}

// Returns the vertex reached at each of LABEL_ANCHORS along the path.
function anchorVertices(points: Float64Array): number[] {
  const along = [0];
  for (let i = 2; i < points.length; i += 2) {
    along.push(
        along[along.length - 1]
            + Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]));
  }

  const total = along[along.length - 1];
  return LABEL_ANCHORS.map(fraction => {
    const index = along.findIndex(d => d >= total * fraction);
    return index < 0 ? 0 : index;
  });
}

function simplify(points: Float64Array, tolerance: number): Float64Array {
  const keep = SimpleS2.douglasPeucker(points, tolerance, /* pinned= */ null);
  const simplified = [];
  for (let i = 0; i < keep.length; ++i) {
    if (keep[i]) {
      simplified.push(points[2 * i], points[2 * i + 1]);
    }
  }
  return Float64Array.from(simplified);
}

export function parseColor(hex: string): RgbaU32 {
  const rgb = parseInt(hex.slice(1), 16);
  return (((Number.isNaN(rgb) ? 0 : rgb) << 8) | 0xFF) >>> 0 as RgbaU32;
}

function darken(color: RgbaU32): RgbaU32 {
  const r = Math.round(((color >>> 24) & 0xFF) * 0.4);
  const g = Math.round(((color >>> 16) & 0xFF) * 0.4);
  const b = Math.round(((color >>> 8) & 0xFF) * 0.4);
  return ((r << 24) | (g << 16) | (b << 8) | (color & 0xFF)) >>> 0 as RgbaU32;
}
