import { KIND_PACKED_POINT, OBJECTS_WIRE_VERSION } from 'java/lat/trails/wire/wire';
import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';
import { POINTS_ATLAS_SIZE, pointsAtlasIndex } from 'java/org/trailcatalog/client/points/points_atlas';
import { aDescendsB, PointCategory } from 'java/org/trailcatalog/models/categories';
import { Camera, projectS2LatLng, worldRadiusAt } from 'js/map/camera';
import { Copyright, RawUuid, RgbaU32, Vec2 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { LabelObstacles } from 'js/map/layers/label_placer';
import { WATER_TEXT_FILL } from 'js/map/layers/mbtile_layer';
import { BillboardProgram } from 'js/map/rendering/billboard_program';
import { growBuffer } from 'js/map/rendering/buffers';
import { GLYPHER, toGraphemes, wrap } from 'js/map/rendering/glypher';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { PoolClient, sharedPool } from 'js/map/workers/client_pool';
import { Command as FetcherCommand, Initialize as FetcherInitialize, LoadCellCommand, Request as FetcherRequest, Snap, UnloadCellsCommand } from 'js/map/workers/s2_data_fetcher';
import { CellKey, Stream } from 'js/map/workers/s2_streams';
import { Z_OVERLAY_TEXT, Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

import { getLabelBox, LabelCollisions } from './label_collisions';
import { Data } from './workers/collection_loader';

// The sizes trailcatalog draws its points at, see trail_layer.ts
const ICON_SIZE_PX = [20, 20] as Vec2;
const HOVER_ICON_SIZE_PX = [28, 28] as Vec2;
const NO_OFFSET = [0, 0] as Vec2;
// Past about half the icon the cursor is on the map around it.
const HOVER_RADIUS_PX = 10;
// A viewport at zoom 14 holds a few hundred points, and 64 bytes apiece fits that.
const INITIAL_BUFFER_BYTES = 65536;
// About 450 names of a dozen glyphs at SdfProgram's 48 bytes per glyph
const INITIAL_LABEL_BYTES = 262144;

// A darker shade of the contours' brown, so a name reads as part of the terrain
const LABEL_FILL = 0x4F3F2CFF as RgbaU32;
const LABEL_STROKE = 0xF4F0E8FF as RgbaU32;
// FONT_SIZE is 28, so names are about 12px.
const LABEL_SCALE = 0.42;
const HIGHLIGHTED_LABEL_SCALE = 0.5;
const LABEL_LINE_GRAPHEMES = 12;
const LABEL_GAP_PX = 4;
// Added around every label and icon, so neighbors keep LABEL_GAP_PX between them
const LABEL_PAD_PX = LABEL_GAP_PX / 2;

// Placed first, because a hiker steers by summits, then by the ice and water below them, then by
// the gaps between them
const LABEL_PRIORITY = [
  [PointCategory.NATURAL_PEAK, PointCategory.NATURAL_VOLCANO],
  [PointCategory.NATURAL_GLACIER],
  [PointCategory.NATURAL_LAKE, PointCategory.NATURAL_BAY, PointCategory.NATURAL_STRAIT],
  [PointCategory.NATURAL_MOUNTAIN_PASS, PointCategory.NATURAL_SADDLE],
];

// Areas, whose name sits in the middle of them with no icon. Glaciers take a deeper shade of the
// glaciated contour labels' blue and open water takes the basemap's water names' blue.
const AREA_LABEL_FILLS = new Map<number, RgbaU32>([
  [PointCategory.NATURAL_BAY, WATER_TEXT_FILL],
  [PointCategory.NATURAL_GLACIER, 0x1F78A3FF as RgbaU32],
  [PointCategory.NATURAL_LAKE, WATER_TEXT_FILL],
  [PointCategory.NATURAL_STRAIT, WATER_TEXT_FILL],
]);

// The server has nothing to simplify in a point.
const NO_SNAP: Snap[] = [{minZoom: 0, snap: undefined}];

const TEXT_DECODER = new TextDecoder();

/** A point a PointCollectionLayer drew from its collection. */
export interface Point {
  id: RawUuid;
  // The OSM node id and PointCategory, plus the name when the node has one
  data: Data;
  // Mercator
  position: Vec2;
}

/** Draws a collection of points as trailcatalog's icons with their names beside them. */
export class PointCollectionLayer extends Layer {

  private readonly fetcher: PoolClient<FetcherInitialize, FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly cells: Map<CellKey, Point[]>;
  private readonly atlas: WebGLTexture;
  private atlasLoaded: boolean;
  private buffer: ArrayBuffer;
  private readonly glBuffer: WebGLBuffer;
  private drawables: Drawable[];
  private labels: ArrayBuffer;
  private readonly glLabels: WebGLBuffer;
  private labelDrawables: Drawable[];
  // Each placed label's box by point id, in mercator scaled by pixelsPerWorld, so a click on a name
  // finds it and the next plan places it before its equals
  private labelBoxes: Map<number, {point: Point; box: number[]}>;
  private labelsMissingGlyphs: boolean;
  // What the drawables were planned for, or undefined to plan them again
  private planned: {avoided: number[]; generation: number; zoom: number}|undefined;
  // Only points descending from these draw and answer the cursor
  private categories: PointCategory[];
  private hovered: Point|undefined;
  // The point the inspector shows, which stays drawn after its cell unloads. Hovered and selected
  // points are compared by id because a cell that reloads makes new ones.
  private selected: Point|undefined;

  constructor(
      copyrights: Copyright[],
      url: string,
      streams: Stream[],
      categories: PointCategory[],
      private readonly labelZoom: number,
      private readonly iconZoom: number,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
      // What the open collection drew, which our labels make way for
      private readonly avoid: LabelObstacles,
      // Where our icons and labels are, so that the basemap's labels make way for them
      private readonly obstacles: LabelObstacles,
  ) {
    super(copyrights);
    this.fetcher =
        sharedPool<FetcherInitialize, FetcherRequest, FetcherCommand>(
            new URL('s2_data_fetcher_worker.js', import.meta.url).href, /* count= */ 1)
            .connect({
              covering: url + '/covering',
              snaps: NO_SNAP,
              streams,
              url: url + '/objects',
              wireVersion: OBJECTS_WIRE_VERSION,
            });
    this.registerDisposer(() => { this.fetcher.dispose(); });
    this.fetching = false;
    this.cells = new Map();
    this.atlas = renderer.createTexture();
    this.registerDisposer(() => { this.renderer.deleteTexture(this.atlas); });
    this.atlasLoaded = false;
    this.buffer = new ArrayBuffer(INITIAL_BUFFER_BYTES);
    this.glBuffer = renderer.createDataBuffer(INITIAL_BUFFER_BYTES);
    this.registerDisposer(() => {
      this.renderer.deleteBuffer(this.glBuffer);
    });
    this.drawables = [];
    this.labels = new ArrayBuffer(INITIAL_LABEL_BYTES);
    this.glLabels = renderer.createDataBuffer(INITIAL_LABEL_BYTES);
    this.registerDisposer(() => {
      this.renderer.deleteBuffer(this.glLabels);
      this.obstacles.boxes = [];
    });
    this.labelDrawables = [];
    this.labelBoxes = new Map();
    this.labelsMissingGlyphs = false;
    this.planned = undefined;
    this.categories = categories;
    this.hovered = undefined;
    this.selected = undefined;

    this.fetcher.onresponse = command => {
      if (command.kind === 'lcc') {
        this.loadCell(command);
      } else if (command.kind === 'ucc') {
        this.unloadCells(command);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
        this.redraw();
      } else if (command.kind === 'ssc') {
        // trailcatalog points have no schema
      } else {
        checkExhaustive(command);
      }
    };

    fetch(new URL('images/atlases/points.png', import.meta.url))
        .then(response => {
          if (!response.ok) {
            throw new Error(`Unable to fetch the points atlas: ${response.status}`);
          }
          return response.blob();
        })
        .then(blob => createImageBitmap(blob))
        .then(bitmap => {
          this.renderer.uploadTexture(bitmap, this.atlas);
          this.atlasLoaded = true;
          this.redraw();
        });
  }

  /** Shows only the points descending from the categories. */
  setCategories(categories: PointCategory[]): void {
    this.categories = categories;
    if (this.hovered && !this.shows(this.hovered)) {
      this.hovered = undefined;
    }
    this.redraw();
  }

  /** Highlights the point as if the pointer were over it, or clears the highlight. */
  highlightPoint(point: Point|undefined): void {
    if (point?.data.id !== this.hovered?.data.id) {
      this.hovered = point;
      this.redraw();
    }
  }

  /** Draws the point as selected, the way a hovered one draws, or stops. */
  selectPoint(point: Point|undefined): void {
    if (point?.data.id !== this.selected?.data.id) {
      this.selected = point;
      this.redraw();
    }
  }

  /** Clears our obstacles and hit boxes while hidden, because render stops being called. */
  setShown(shown: boolean): void {
    this.planned = undefined;
    if (!shown) {
      this.obstacles.boxes = [];
      this.labelBoxes = new Map();
    }
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    const target = this.pointsAt(point)[0];
    this.highlightPoint(target);
    return target !== undefined;
  }

  override hoverLost(source: EventSource): void {
    this.highlightPoint(undefined);
  }

  override loadingData(): boolean {
    return this.fetching;
  }

  override render(planner: Planner, zoom: number): void {
    if (zoom < this.labelZoom) {
      if (this.planned) {
        this.planned = undefined;
        this.obstacles.boxes = [];
      }
      return;
    }

    // Labels are placed in mercator scaled to pixels, so a pan doesn't replan them. FeatureLayer
    // assigns avoid a new array of boxes whenever it replans its labels, which isn't only on zoom.
    const icons = zoom >= this.iconZoom;
    if (this.labelsMissingGlyphs
        || this.planned?.generation !== this.generation
        || this.planned.zoom !== zoom
        || this.planned.avoided !== this.avoid.boxes) {
      if (icons) {
        this.plan();
      }
      this.planLabels(zoom);
      this.planned = {avoided: this.avoid.boxes, generation: this.generation, zoom};
    }
    planner.add(this.labelDrawables);
    if (icons && this.atlasLoaded) {
      planner.add(this.drawables);
    }
  }

  override viewportChanged(bounds: S2LatLngRect, zoom: number): void {
    const lat = bounds.lat();
    const lng = bounds.lng();
    this.fetcher.broadcast({
      kind: 'uvr',
      viewport: {
        lat: [lat.lo(), lat.hi()],
        lng: [lng.lo(), lng.hi()],
        zoom,
      },
    });
  }

  // Plans every shown point's icon, with the hovered and selected ones larger and on top.
  private plan(): void {
    const shown = [];
    for (const points of this.cells.values()) {
      shown.push(
          ...points.filter(
              point => this.shows(point) && !isArea(point) && !this.isHighlighted(point)));
    }
    const raised: Point[] = [];
    for (const point of [this.selected, this.hovered]) {
      if (point && !isArea(point) && !raised.some(r => getId(r) === getId(point))) {
        raised.push(point);
      }
    }
    const count = shown.length + raised.length;
    this.buffer = growBuffer(this.buffer, count * BillboardProgram.bytesNeeded());

    const drawables: Drawable[] = [];
    let offset = 0;
    const push = (point: Point, size: Vec2, z: number) => {
      const {byteSize, drawable} =
          this.renderer.billboardProgram.plan(
              point.position,
              NO_OFFSET,
              size,
              /* angle= */ 0,
              /* tint= */ 0xFFFFFFFF as RgbaU32,
              z,
              pointsAtlasIndex(point.data.type as number),
              POINTS_ATLAS_SIZE,
              this.buffer,
              offset,
              this.glBuffer,
              this.atlas);
      drawables.push(drawable);
      offset += byteSize;
    };
    for (const point of shown) {
      push(point, ICON_SIZE_PX, Z_OVERLAY_TEXT + 0.5);
    }
    for (const point of raised) {
      push(point, HOVER_ICON_SIZE_PX, Z_USER_DATA_HIGHLIGHT);
    }

    this.renderer.uploadData(this.buffer, offset, this.glBuffer);
    this.drawables = drawables;
  }

  // Places each shown point's name where it clears the open collection, the icons, and the names
  // placed before it. Under iconZoom there are no icons, so a name sits on its point.
  private planLabels(zoom: number): void {
    const pixelsPerWorld = worldRadiusAt(zoom);
    const icons = zoom >= this.iconZoom;
    const collisions = new LabelCollisions();
    const avoidScale = pixelsPerWorld / this.avoid.pixelsPerWorld;
    const avoided = this.avoid.boxes.map(v => v * avoidScale);
    collisions.insert(avoided);

    const shown = [];
    for (const points of this.cells.values()) {
      shown.push(...points.filter(point => this.shows(point)));
    }
    // The selected point keeps its name after its cell unloads, the way it keeps its icon.
    const selected = this.selected;
    if (selected && this.shows(selected) && !shown.some(p => getId(p) === getId(selected))) {
      shown.push(selected);
    }
    if (icons) {
      for (const point of shown) {
        if (!isArea(point)) {
          const x = point.position[0] * pixelsPerWorld;
          const y = point.position[1] * pixelsPerWorld;
          const half = ICON_SIZE_PX[0] / 2 + LABEL_PAD_PX;
          collisions.insert([x - half, y - half, x + half, y + half]);
        }
      }
    }

    // A highlighted name goes first, then names by tier, and a name placed last time goes before
    // its equals so zooming doesn't swap neighbors every frame. Every unhighlighted score is under
    // 2 * (LABEL_PRIORITY.length + 1).
    const priority = (point: Point) => {
      const type = point.data.type as number;
      const tier = LABEL_PRIORITY.findIndex(c => c.some(category => aDescendsB(type, category)));
      return (this.isHighlighted(point) ? 0 : 2 * (LABEL_PRIORITY.length + 1))
          + 2 * (tier < 0 ? LABEL_PRIORITY.length : tier)
          + (this.labelBoxes.has(getId(point)) ? 0 : 1);
    };
    const named = shown.filter(point => point.data.name);
    named.sort((a, b) => priority(a) - priority(b) || getId(a) - getId(b));

    const labels = named.map(point => ({
      point,
      graphemes: wrap(toGraphemes(point.data.name as string), LABEL_LINE_GRAPHEMES),
    }));
    this.labels =
        growBuffer(
            this.labels,
            labels.reduce((sum, {graphemes}) => sum + GLYPHER.bytesNeeded(graphemes), 0));

    const drawables = [];
    const boxes = new Map<number, {point: Point; box: number[]}>();
    let offset = 0;
    this.labelsMissingGlyphs = false;
    for (const {point, graphemes} of labels) {
      const highlighted = this.isHighlighted(point);
      const scale = highlighted ? HIGHLIGHTED_LABEL_SCALE : LABEL_SCALE;
      const size = GLYPHER.measurePx(graphemes, scale);
      if (!size) {
        this.labelsMissingGlyphs = true;
        continue;
      }

      const x = point.position[0] * pixelsPerWorld;
      const y = point.position[1] * pixelsPerWorld;
      const iconPx = highlighted ? HOVER_ICON_SIZE_PX[0] : ICON_SIZE_PX[0];
      const left =
          icons && !isArea(point) ? x + iconPx / 2 + LABEL_GAP_PX : x - size[0] / 2;
      const box = getLabelBox(left, y, size, LABEL_PAD_PX);
      // A highlighted name is never dropped, or else one that grew on hover could collide, lose
      // the hover, shrink back, and flicker.
      if (!highlighted && collisions.hits(box)) {
        continue;
      }

      const planned =
          GLYPHER.plan(
              graphemes,
              point.position,
              [left - x, 0],
              scale,
              /* angle= */ 0,
              AREA_LABEL_FILLS.get(point.data.type as number) ?? LABEL_FILL,
              LABEL_STROKE,
              Z_OVERLAY_TEXT + 0.5,
              this.labels,
              offset,
              this.glLabels,
              this.renderer,
              {horizontal: 'start', vertical: 'middle'});
      collisions.insert(box);
      boxes.set(getId(point), {point, box});
      drawables.push(...planned.drawables);
      offset += planned.byteSize;
    }

    if (offset > 0) {
      this.renderer.uploadData(this.labels, offset, this.glLabels);
    }
    this.labelDrawables = drawables;
    this.labelBoxes = boxes;
    this.obstacles.boxes = collisions.boxes.slice(avoided.length);
    this.obstacles.pixelsPerWorld = pixelsPerWorld;
  }

  /**
   * Returns the shown points within HOVER_RADIUS_PX of the point, closest first, and then the
   * ones whose label is under it.
   */
  pointsAt(point: S2LatLng): Point[] {
    if (this.camera.zoom < this.labelZoom) {
      return [];
    }

    const [x, y] = projectS2LatLng(point);
    const labeled = [];
    const px = x * this.obstacles.pixelsPerWorld;
    const py = y * this.obstacles.pixelsPerWorld;
    for (const {point, box} of this.labelBoxes.values()) {
      if (box[0] <= px && px <= box[2] && box[1] <= py && py <= box[3]) {
        labeled.push(point);
      }
    }
    if (this.camera.zoom < this.iconZoom) {
      return labeled;
    }

    // A mercator unit is worldRadius pixels.
    const radius = HOVER_RADIUS_PX * this.camera.inverseWorldRadius;
    const found: Array<{point: Point; distance2: number}> = [];
    for (const points of this.cells.values()) {
      for (const candidate of points) {
        if (!this.shows(candidate) || isArea(candidate)) {
          continue;
        }
        const dx = candidate.position[0] - x;
        const dy = candidate.position[1] - y;
        const distance2 = dx * dx + dy * dy;
        if (distance2 < radius * radius) {
          found.push({point: candidate, distance2});
        }
      }
    }
    found.sort((a, b) => a.distance2 - b.distance2);
    const near = found.map(({point}) => point);
    return [...near, ...labeled.filter(point => !near.some(n => getId(n) === getId(point)))];
  }

  private isHighlighted(point: Point): boolean {
    return point.data.id === this.hovered?.data.id || point.data.id === this.selected?.data.id;
  }

  private shows(point: Point): boolean {
    const type = point.data.type as number;
    return this.categories.some(category => aDescendsB(type, category));
  }

  private loadCell(command: LoadCellCommand): void {
    const source = new LittleEndianView(command.data);
    const version = source.getVarInt32();
    if (version !== OBJECTS_WIRE_VERSION) {
      throw new Error(`Unhandled version ${version}`);
    }
    const kind = source.getVarInt32();
    if (kind !== KIND_PACKED_POINT) {
      throw new Error(`Expected packed points, got kind ${kind}`);
    }

    const points = [];
    const count = source.getVarInt32();
    for (let i = 0; i < count; ++i) {
      // id,type,name,marker
      const id = source.getVarBigInt64();
      const type = source.getVarInt32();
      const name = TEXT_DECODER.decode(source.sliceInt8(source.getVarInt32()));
      const latE7 = source.getInt32();
      const lngE7 = source.getInt32();
      const data: Data = {id: Number(id), type};
      if (name) {
        data.name = name;
      }
      points.push({
        id: {lsb: id, msb: 0n},
        data,
        position: projectS2LatLng(S2LatLng.fromE7(latE7, lngE7)),
      });
    }
    this.cells.set(command.key, points);
    this.redraw();
  }

  private unloadCells(command: UnloadCellsCommand): void {
    for (const key of command.keys) {
      const hovered = this.hovered;
      if (hovered && this.cells.get(key)?.some(point => getId(point) === getId(hovered))) {
        this.hovered = undefined;
      }
      this.cells.delete(key);
    }
    this.redraw();
  }
}

function getId(point: Point): number {
  return point.data.id as number;
}

function isArea(point: Point): boolean {
  return AREA_LABEL_FILLS.has(point.data.type as number);
}
