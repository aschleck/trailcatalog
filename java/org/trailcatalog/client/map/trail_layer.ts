import { aDescendsB, WayCategory } from 'java/org/trailcatalog/models/categories';
import { S2LatLng, S2LatLngRect, SimpleS2 } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';
import { Camera, projectLatLngRect, projectS2LatLng, ScreenProjection } from 'js/map/camera';
import { WorldBoundsQuadtree } from 'js/map/common/bounds_quadtree';
import { DPI } from 'js/map/common/dpi';
import { Copyright, RgbaU32, Vec2, Vec4 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { BillboardProgram } from 'js/map/rendering/billboard_program';
import { GLYPHER, toGraphemes } from 'js/map/rendering/glypher';
import { LinePattern, LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';

import { formatDistance } from 'js/units/formatters';
import { reinterpretLong } from '../common/math';
import { S2CellNumber } from '../common/types';
import { Listener, MapDataService } from '../data/map_data_service';
import { Path, Point, Trail } from '../models/types';
import { COARSE_ZOOM_THRESHOLD, FINE_ZOOM_THRESHOLD } from '../workers/data_constants';

import {
  DEFAULT_PALETTE,
  DEFAULT_HEX_PALETTE,
  ERROR_PALETTE,
  HOVER_PALETTE,
  LinePalette,
} from './colors';
import { HOVER_CHANGED, SELECTION_CHANGED } from './events';
import { PinRenderer } from './pin_renderer';
import { POINTS_ATLAS_SIZE, pointsAtlasIndex } from '../points/points_atlas';

export interface Filters {
  trail?: (id: bigint) => boolean;
}

const NO_OFFSET = [0, 0] as Vec2;
const POINT_BILLBOARD_SIZE_PX = [20, 20] as Vec2;
const POINT_HOVER_BILLBOARD_SIZE_PX = [28, 28] as Vec2;

const Z_PATH = 110;
const Z_POINT = 111;
const Z_TRAIL_MARKER = 112;
const Z_RAISED_PATH = 113;
const Z_RAISED_TRAIL_MARKER = 114;
const PATH_RADIUS_PX = 1.5;
// An 8 pixel line, so the 2 pixel alternating stroke on each side leaves 4 pixels of fill.
const BROKEN_PATH_RADIUS_PX = 4;
const RAISED_PATH_RADIUS_PX = 4;
const TRAIL_MARKER_TEXT_SCALE = 0.5;

interface PathHandle {
  readonly entity: Path;
  readonly line: Float32Array|Float64Array;
}

interface PointHandle {
  readonly entity: Point;
  readonly markerPx: Vec2;
}

interface TrailHandle {
  readonly entity: Trail;
  readonly markerPx: Vec2;
  // Widens from the unlabeled pin to the labeled one when the label gets measured, because a
  // trail is hoverable before anything has measured its label.
  screenPixelBound: Vec4;
  // Undefined until the viewport first reaches this trail at a zoom that labels pins, and while a
  // grapheme of its label is missing from the glyph atlas.
  label: TrailLabel|undefined;
}

interface TrailLabel {
  readonly graphemes: string[];
  readonly textSize: Vec2;
}

type Handle = PathHandle|PointHandle|TrailHandle;

interface CellPlan {
  buffer: WebGLBuffer;
  paths: Drawable[];
  points: Drawable[];
}

const RENDER_POINT_ZOOM_THRESHOLD = 14;
const RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD = 12;

const NO_TEXT = [0, 0] as Vec2;

// 35px is a larger than the full height of a trail marker (full not half
// because they are not centered vertically.)
const CLICK_RADIUS_PX = 35 * DPI;

// Grows the pin query past the viewport so a marker just off screen still contributes the pin that
// reaches into view.
const PIN_QUERY_PADDING = 0.5;

export class TrailLayer extends Layer implements Listener {

  // A note on bounds: we load trails into all quadtrees because trail pins have different sizes at
  // different zooms.
  private readonly overviewBounds: WorldBoundsQuadtree<Handle>;
  private readonly coarseBounds: WorldBoundsQuadtree<Handle>;
  private readonly fineBounds: WorldBoundsQuadtree<Handle>;
  private readonly coarsePlans: Map<S2CellNumber, CellPlan>;
  private readonly finePlans: Map<S2CellNumber, CellPlan>;
  private readonly interactivePlan: CellPlan;
  private readonly pinPixelBounds: Vec4;
  private readonly active: Map<bigint, LinePalette>;
  private readonly hovering: Map<bigint, LinePalette>;
  // Every pin on screen, replanned each render.
  private readonly pinBuffer: WebGLBuffer;
  // Asks for another frame after a label missed the glyph atlas.
  private readonly pinLabelDebouncer: Debouncer;
  private readonly pinRenderer: PinRenderer;
  private readonly pointsAtlas: WebGLTexture;
  private readonly queryClosestBuffer: Handle[];
  private readonly queryVisibleBuffer: TrailHandle[];
  // An entry with no palette is a pinned path that nothing has highlighted.
  private readonly plannedEntities: Map<bigint, LinePalette|undefined>;
  private readonly visiblePins: Drawable[];
  private interactiveScratchBuffer: ArrayBuffer;
  private pinScratchBuffer: ArrayBuffer;
  private loadScratchBuffer: ArrayBuffer;
  private lastHoverTarget: Path|Point|Trail|undefined;

  constructor(
      copyrights: Copyright[],
      private readonly camera: Camera,
      private readonly dataService: MapDataService,
      private filters: Filters,
      private readonly renderer: Renderer,
  ) {
    super(copyrights);
    this.overviewBounds = new WorldBoundsQuadtree<Handle>();
    this.coarseBounds = new WorldBoundsQuadtree<Handle>();
    this.fineBounds = new WorldBoundsQuadtree<Handle>();
    this.coarsePlans = new Map();
    this.finePlans = new Map();
    this.interactivePlan = {
      buffer: this.renderer.createDataBuffer(0),
      paths: [],
      points: [],
    };
    this.pinBuffer = this.renderer.createDataBuffer(0);
    this.pinLabelDebouncer = new Debouncer(10, () => { this.redraw(); });
    this.registerDisposer(() => {
      for (const source of [this.coarsePlans, this.finePlans]) {
        for (const {buffer} of source.values()) {
          this.renderer.deleteBuffer(buffer);
        }
      }

      this.renderer.deleteBuffer(this.pinBuffer);
      this.renderer.deleteBuffer(this.interactivePlan.buffer);
      this.renderer.deleteTexture(this.pointsAtlas);
    });
    this.active = new Map();
    this.hovering = new Map();
    this.pinRenderer = new PinRenderer(renderer);
    this.registerDisposable(this.pinRenderer);
    this.pointsAtlas = renderer.createTexture();
    this.queryClosestBuffer = [];
    this.queryVisibleBuffer = [];
    this.plannedEntities = new Map();
    this.visiblePins = [];
    this.interactiveScratchBuffer = new ArrayBuffer(64 * 1024);
    this.pinScratchBuffer = new ArrayBuffer(256 * 1024);
    this.loadScratchBuffer = new ArrayBuffer(1024 * 1024);

    const pinPixelSize = this.pinRenderer.measureUnlabeledPin();
    const halfPinWidth = pinPixelSize[0] / 2;
    const halfPinHeight = pinPixelSize[1] / 2;
    this.pinPixelBounds = [
      -halfPinWidth,
      -halfPinHeight,
      halfPinWidth,
      halfPinHeight,
    ];


    this.dataService.setListener(this);
    this.registerDisposer(() => {
      this.dataService.clearListener();
    });

    fetch(new URL('images/atlases/points.png', import.meta.url))
        .then(response => {
          if (response.ok) {
            return response.blob();
          } else {
            throw new Error('Unable to fetch atlas');
          }
        })
        .then(blob => createImageBitmap(blob))
        .then(bitmap => {
          if (this.isDisposed) {
            bitmap.close();
            return;
          }
          renderer.uploadTexture(bitmap, this.pointsAtlas);
          this.redraw();
        });
  }

  click(point: S2LatLng, px: [number, number], _: boolean, source: EventSource): boolean {
    source.trigger(SELECTION_CHANGED, {
      selected: this.lastHoverTarget,
      clickPx: px,
    });
    return true;
  }

  hover(point: S2LatLng, source: EventSource): boolean {
    const best = this.queryClosest(projectS2LatLng(point));
    if (this.lastHoverTarget !== best) {
      if (this.lastHoverTarget) {
        this.setHover(this.lastHoverTarget, false);
      }
      if (best) {
        this.setHover(best, true);
      }
      source.trigger(HOVER_CHANGED, {target: best});
      this.lastHoverTarget = best;
    }
    return true;
  }

  override render(planner: Planner, zoom: number, projection: ScreenProjection): void {
    this.pinRenderer.mark();
    this.planInteractive();
    // The camera's own bounds rather than the last viewportChanged, which only comes once the map
    // settles, or else a fast zoom in covers and labels the far wider view it started from.
    const viewport = this.camera.viewportBounds(projection.widthPx, projection.heightPx);

    const detailPlans = [];
    if (this.showDetail(this.camera.zoom)) {
      const useFine = this.showFine(this.camera.zoom);
      const cells = getCellsIn(viewport, SimpleS2.HIGHEST_FINE_INDEX_LEVEL);
      for (const cell of cells) {
        const fine = useFine ? this.finePlans.get(cell) : undefined;
        if (fine) {
          detailPlans.push(fine);
          continue;
        }
        const coarse = this.coarsePlans.get(cell);
        if (coarse) {
          detailPlans.push(coarse);
        }
      }
    }

    for (const {paths, points} of detailPlans.values()) {
      if (this.camera.zoom >= COARSE_ZOOM_THRESHOLD) {
        planner.add(paths);
      }

      if (this.camera.zoom >= RENDER_POINT_ZOOM_THRESHOLD) {
        planner.add(points);
      }
    }

    // A pinned trail draws wherever the camera is, so this plan has no zoom gate.
    planner.add(this.interactivePlan.paths);
    planner.add(this.interactivePlan.points);

    const labeled = this.camera.zoom >= RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD;
    this.planVisiblePins(planner, labeled, viewport);
    this.pinRenderer.sweep();
  }

  // An overview cell reaches S2 level 7, a few hundred kilometers across, so it holds orders of
  // magnitude more trails than a viewport shows. Planning a pin is a few dozen buffer writes
  // against a texture the pin cache already holds, and render only runs when the camera or the data
  // moved, so we replan the pins the viewport reaches rather than hold geometry for trails nobody
  // is looking at.
  //
  // Culling pays for itself twice: each labeled pin needs its own z so that it covers the labels
  // behind it, and Planner sorts on z ahead of program, so every pin submitted costs a billboard to
  // sdf program switch whether or not it is on screen.
  private planVisiblePins(planner: Planner, labeled: boolean, bounds: S2LatLngRect): void {
    const handles = this.queryVisibleBuffer;
    handles.length = 0;
    const viewport = projectLatLngRect(bounds);
    const padX = (viewport.high[0] - viewport.low[0]) * PIN_QUERY_PADDING;
    const padY = (viewport.high[1] - viewport.low[1]) * PIN_QUERY_PADDING;
    // Only loadOverviewCell inserts into overviewBounds, so everything this returns is a trail.
    this.overviewBounds.queryRect({
      low: [viewport.low[0] - padX, viewport.low[1] - padY] as Vec2,
      high: [viewport.high[0] + padX, viewport.high[1] + padY] as Vec2,
    }, handles);
    const filter = this.filters.trail;
    let kept = 0;
    for (const handle of handles) {
      if (!filter || filter(handle.entity.id)) {
        handles[kept++] = handle;
      }
    }
    handles.length = kept;
    // Ordered by trail so that the z ladder below is a property of the trails on screen and not of
    // the order the quadtree walked them, or else which pin covers which label changes as you pan.
    handles.sort((a, b) => a.entity.id < b.entity.id ? -1 : 1);

    // First, measure the labels, because the buffer has to be sized before anything is planned
    // into it.
    let bufferSize = 0;
    let missingGlyphs = false;
    for (const handle of handles) {
      bufferSize += BillboardProgram.bytesNeeded();
      if (!labeled) {
        continue;
      }

      const label = handle.label ?? this.measureLabel(handle);
      if (label) {
        bufferSize += GLYPHER.bytesNeeded(label.graphemes);
      } else {
        missingGlyphs = true;
      }
    }
    if (missingGlyphs) {
      // measurePx fails on a grapheme the atlas does not hold yet, and queues a rebuild, so ask
      // for another frame and plan those pins then.
      this.pinLabelDebouncer.trigger();
    }

    this.pinScratchBuffer = growBuffer(this.pinScratchBuffer, bufferSize);
    const buffer = this.pinScratchBuffer;
    const pins = this.visiblePins;
    pins.length = 0;
    let offset = 0;
    let zEpsilon = 0;

    for (const handle of handles) {
      const entity = handle.entity;
      const special = this.hovering.get(entity.id) ?? this.active.get(entity.id);
      const z = special ? Z_RAISED_TRAIL_MARKER : Z_TRAIL_MARKER;

      const label = labeled ? handle.label : undefined;
      if (labeled && !label) {
        continue;
      }

      const pinPlan =
          this.pinRenderer.planPin(
              {
                textSize: label?.textSize ?? NO_TEXT,
                fillColor: special?.hex.fill ?? DEFAULT_HEX_PALETTE.fill,
                strokeColor: special?.hex.stroke ?? '#ffffffff',
              },
              entity.markerPx,
              z + zEpsilon,
              buffer,
              offset,
              this.pinBuffer);
      pins.push(pinPlan.drawable);
      offset += pinPlan.byteSize;

      if (label) {
        const {byteSize, drawables} =
            GLYPHER.plan(
                label.graphemes,
                entity.markerPx,
                pinPlan.textOffset,
                TRAIL_MARKER_TEXT_SCALE,
                /* angle= */ 0,
                special ? special.raw.stroke : DEFAULT_PALETTE.stroke,
                special ? special.raw.fill : DEFAULT_PALETTE.fill,
                z + zEpsilon + 0.0000001,
                buffer,
                offset,
                this.pinBuffer,
                this.renderer);
        pins.push(...drawables);
        offset += byteSize;

        // Leaves room for the label to sit between this pin and the next one up the ladder.
        zEpsilon += 0.0000002;
      }
    }

    this.renderer.uploadData(buffer, offset, this.pinBuffer);
    planner.add(pins);
  }

  private measureLabel(handle: TrailHandle): TrailLabel|undefined {
    const {value, unit} = formatDistance(handle.entity.lengthMeters);
    const graphemes = toGraphemes(`${value} ${unit}`);
    const textSize = GLYPHER.measurePx(graphemes, TRAIL_MARKER_TEXT_SCALE);
    if (!textSize) {
      return undefined;
    }

    const pinSize = this.pinRenderer.measureLabeledPin(textSize);
    const halfDetailWidth = pinSize[0] / 2;
    handle.screenPixelBound = [
      -halfDetailWidth,
      0,
      halfDetailWidth,
      pinSize[1],
    ];

    handle.label = {graphemes, textSize};
    return handle.label;
  }

  getTrail(id: bigint): Trail|undefined {
    return this.dataService.trails.get(id);
  }

  listTrailsOnPath(path: Path): Trail[] {
    return this.dataService.listTrailsOnPath(path);
  }

  queryInBounds(bounds: S2LatLngRect): Array<Path|Point|Trail> {
    const near: Handle[] = [];
    this.getActiveBounds().queryRect(projectLatLngRect(bounds), near);
    return near.map(h => h.entity);
  }

  queryClosest(point: Vec2): Path|Trail|Point|undefined {
    // This method is kind of funny because it tries to be abstract about the types it's processing,
    // but it ends up being type specific implicitly.

    const near = this.queryClosestBuffer;
    near.length = 0;
    const screenToWorldPx = this.camera.inverseWorldRadius;
    // We want to select a trail even if 0 distance to a path
    const pathAntibias2 = screenToWorldPx * screenToWorldPx;
    // We like points
    const pointBias2 = 5 * 10;
    // But we really like trails
    const trailBias2 = 10 * 10;
    const radius = CLICK_RADIUS_PX * screenToWorldPx;
    this.getActiveBounds().queryCircle(point, radius, near);
    // Pinned paths are in no quadtree. They answer the mouse at every zoom, so no single tree
    // suits them, and overviewBounds holds trails only. There are few enough to test one by one.
    for (const path of this.dataService.pinnedPaths.values()) {
      const bound = path.bound;
      if (point[0] + radius < bound.low[0]
          || point[0] - radius > bound.high[0]
          || point[1] + radius < bound.low[1]
          || point[1] - radius > bound.high[1]) {
        continue;
      }

      // The pin and the cell copy are separate objects carrying the same vertices, so without
      // this the line gets measured twice.
      if (near.some(h => h.entity instanceof Path && h.entity.id === path.id)) {
        continue;
      }

      near.push({entity: path, line: path.line});
    }

    let best = undefined;
    let bestDistance2 = (7 * screenToWorldPx) * (7 * screenToWorldPx);
    for (const handle of near) {
      let d2 = Number.MAX_VALUE;
      if (handle.entity instanceof Path) {
        const pathHandle = handle as PathHandle;
        if (this.pathAnswersMouse(handle.entity)) {
          d2 = distanceCheckLine(point, pathHandle.line) + pathAntibias2;
        }
      } else if (
          handle.entity instanceof Point && this.camera.zoom >= RENDER_POINT_ZOOM_THRESHOLD) {
        const pointHandle = handle as PointHandle;
        const p = pointHandle.markerPx;
        const halfX = POINT_BILLBOARD_SIZE_PX[0] / 2;
        const halfY = POINT_BILLBOARD_SIZE_PX[1] / 2;
        const lowX = p[0] - halfX * screenToWorldPx;
        const lowY = p[1] - halfY * screenToWorldPx;
        const highX = p[0] + halfX * screenToWorldPx;
        const highY = p[1] + halfY * screenToWorldPx;
        if (lowX <= point[0]
            && point[0] <= highX
            && lowY <= point[1]
            && point[1] <= highY) {
          // Labels can overlap each other, so we pick the one most centered
          const dx = highX / 2 + lowX / 2 - point[0];
          const dy = highY / 2 + lowY / 2 - point[1];
          d2 = (dx * dx + dy * dy) / pointBias2;
        }
      } else if (handle.entity instanceof Trail) {
        if (this.filters.trail && !this.filters.trail(handle.entity.id)) {
          continue;
        }

        const trailHandle = handle as TrailHandle;
        const p = trailHandle.markerPx;
        const bound =
            this.camera.zoom >= RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD
                ? trailHandle.screenPixelBound : this.pinPixelBounds;
        const lowX = p[0] + bound[0] * screenToWorldPx;
        const lowY = p[1] + bound[1] * screenToWorldPx;
        const highX = p[0] + bound[2] * screenToWorldPx;
        const highY = p[1] + bound[3] * screenToWorldPx;
        if (lowX <= point[0]
            && point[0] <= highX
            && lowY <= point[1]
            && point[1] <= highY) {
          // Labels can overlap each other, so we pick the one most centered
          const dx = highX / 2 + lowX / 2 - point[0];
          const dy = highY / 2 + lowY / 2 - point[1];
          d2 = (dx * dx + dy * dy) / trailBias2;
        }
      } else {
        continue;
      }

      if (d2 < bestDistance2) {
        best = handle.entity;
        bestDistance2 = d2;
      }
    }

    if (best instanceof Path) {
      const trails = this.dataService.pathsToTrails.get(best.id) ?? [];
      if (trails.length === 1) {
        return trails[0];
      } else {
        return best;
      }
    } else {
      return best;
    }
  }

  // Drop the pinned check and a pinned trail draws dashed, and vanishes entirely, until the
  // overview cell claiming its paths loads, which at low zooms is never.
  private onTrail(path: Path): boolean {
    return this.dataService.pathsToTrails.has(path.id)
        || this.dataService.pinnedPaths.has(path.id);
  }

  // The look of a path that nothing highlights. A path that a working trail shares with a broken
  // one still dashes, because the black dashes read as the working trail.
  private restingStyle(path: Path, onTrail: boolean):
      {fill: RgbaU32; stroke: RgbaU32; radius: number; pattern: LinePattern} {
    const broken =
        (this.dataService.pathsToTrails.get(path.id) ?? []).some(t => t.lengthMeters < 0);
    if (broken) {
      return {
        fill: ERROR_PALETTE.raw.fill,
        stroke: ERROR_PALETTE.raw.stroke,
        radius: BROKEN_PATH_RADIUS_PX,
        pattern: 'alternating',
      };
    } else {
      return {
        fill: DEFAULT_PALETTE.fill,
        stroke: DEFAULT_PALETTE.stroke,
        radius: PATH_RADIUS_PX,
        pattern: onTrail ? 'solid' : 'dashed',
      };
    }
  }

  private drawsAsTrail(path: Path): boolean {
    return this.onTrail(path) || isPath(path.type);
  }

  private pathAnswersMouse(path: Path): boolean {
    return this.dataService.pinnedPaths.has(path.id)
        || (this.showDetail(this.camera.zoom) && this.drawsAsTrail(path));
  }

  setActive(entity: Path|Trail, state: boolean, color: LinePalette): void {
    this.setColor(entity, this.active, state, color);
  }

  setFilters(filters: Filters): void {
    this.filters = filters;
    this.redraw();
  }

  setHover(entity: Path|Point|Trail, state: boolean): void {
    this.setColor(entity, this.hovering, state, HOVER_PALETTE);
  }

  private setColor(
      entity: Path|Point|Trail,
      set: Map<bigint, LinePalette>,
      state: boolean,
      color: LinePalette): void {
    let ids;
    if (entity instanceof Path) {
      ids = [entity.id];
    } else if (entity instanceof Trail) {
      ids = entity.paths.map(id => id & ~1n);
      ids.push(entity.id); // what are the odds that a path and its trail will collide?
    } else if (entity instanceof Point) {
      ids = [entity.id]; // what are the odds that a point is near a same ID path
    } else {
      throw checkExhaustive(entity);
    }

    if (state) {
      for (const id of ids) {
        set.set(id, color);
      }
    } else {
      for (const id of ids) {
        set.delete(id);
      }
    }

    this.redraw();
  }

  // Everything that draws above the cell data: whatever is highlighted, plus the pinned paths.
  private planInteractive(): void {
    const planned = this.plannedEntities;
    planned.clear();
    for (const id of this.dataService.pinnedPaths.keys()) {
      planned.set(id, undefined);
    }
    // Deleting before setting moves an id to the back of the map, so an id in both maps draws
    // last and in the hover palette.
    for (const source of [this.active, this.hovering]) {
      for (const [id, palette] of source) {
        planned.delete(id);
        planned.set(id, palette);
      }
    }

    let bufferSize = 0;
    for (const id of planned.keys()) {
      const path = this.pathToPlan(id);
      if (path) {
        bufferSize += LineProgram.bytesNeeded(path.line.length / 2);
      }

      if (this.dataService.getPoint(id)) {
        bufferSize += BillboardProgram.bytesNeeded();
      }
    }

    this.interactiveScratchBuffer = growBuffer(this.interactiveScratchBuffer, bufferSize);
    const buffer = this.interactiveScratchBuffer;
    this.interactivePlan.paths.length = 0;
    this.interactivePlan.points.length = 0;
    let offset = 0;

    for (const [id, palette] of planned) {
      const path = this.pathToPlan(id);
      if (path) {
        const pattern: LinePattern = this.onTrail(path) ? 'solid' : 'dashed';
        const style =
            palette
                ? {
                  fill: palette.raw.fill,
                  stroke: palette.raw.stroke,
                  radius: RAISED_PATH_RADIUS_PX,
                  pattern,
                }
                : this.restingStyle(path, this.onTrail(path));
        const drawable =
            this.renderer.lineProgram.plan(
                style.fill,
                style.stroke,
                style.radius,
                style.pattern,
                palette ? Z_RAISED_PATH : Z_PATH,
                path.line,
                buffer,
                offset,
                this.interactivePlan.buffer);
        this.interactivePlan.paths.push(drawable);
        offset += drawable.geometryByteLength;
      }

      const point = this.dataService.getPoint(id);
      if (point) {
        const icon = pointsAtlasIndex(point.type);
        const {byteSize, drawable} =
            this.renderer.billboardProgram.plan(
                point.markerPx,
                NO_OFFSET,
                POINT_HOVER_BILLBOARD_SIZE_PX,
                /* angle= */ 0,
                0xFFFFFFFF as RgbaU32,
                Z_RAISED_TRAIL_MARKER,
                icon,
                POINTS_ATLAS_SIZE,
                buffer,
                offset,
                this.interactivePlan.buffer,
                this.pointsAtlas);
        this.interactivePlan.points.push(drawable);
        offset += byteSize;
      }
    }

    this.renderer.uploadData(buffer, offset, this.interactivePlan.buffer);
  }

  // A pin is fetched precise, so it holds the same vertices as its cell copy and either will
  // draw. We prefer the cell copy because that is the one the quadtrees hold.
  private pathToPlan(id: bigint): Path|undefined {
    const path = this.dataService.getPath(id) ?? this.dataService.pinnedPaths.get(id);
    if (!path) {
      return undefined;
    }
    return this.drawsAsTrail(path) ? path : undefined;
  }

  viewportChanged(bounds: S2LatLngRect, zoom: number, fetchZoom: number): void {
    this.dataService.updateViewport({
      lat: [bounds.lat().lo(), bounds.lat().hi()],
      lng: [bounds.lng().lo(), bounds.lng().hi()],
      zoom: fetchZoom,
    });
  }

  loadOverviewCell(id: S2CellNumber, trails: Iterable<Trail>): void {
    for (const trail of trails) {
      // One handle in all three quadtrees so widening its bound for the labeled pin reaches every
      // zoom that queries it.
      const handle = {
        entity: trail,
        markerPx: trail.markerPx,
        screenPixelBound: this.pinPixelBounds,
        label: undefined,
      };
      this.overviewBounds.insert(handle, trail.mouseBound);
      this.coarseBounds.insert(handle, trail.mouseBound);
      this.fineBounds.insert(handle, trail.mouseBound);
    }

    this.redraw();
  }

  loadCoarseCell(id: S2CellNumber, paths: Iterable<Path>): void {
    this.coarsePlans.set(id, this.planCell(paths, [], this.coarseBounds));
    this.redraw();
  }

  loadFineCell(id: S2CellNumber, paths: Iterable<Path>, points: Iterable<Point>): void {
    this.finePlans.set(id, this.planCell(paths, points, this.fineBounds));
    this.redraw();
  }

  private planCell(
      paths: Iterable<Path>,
      points: Iterable<Point>,
      bounds: WorldBoundsQuadtree<Handle>): CellPlan {
    let bufferSize = 0;
    for (const path of paths) {
      if (this.drawsAsTrail(path)) {
        bufferSize += LineProgram.bytesNeeded(path.line.length / 2);
      }
    }
    for (const _ of points) {
      bufferSize += BillboardProgram.bytesNeeded();
    }

    this.loadScratchBuffer = growBuffer(this.loadScratchBuffer, bufferSize);
    const buffer = this.loadScratchBuffer;
    const plan: CellPlan = {
      buffer: this.renderer.createDataBuffer(0),
      paths: [],
      points: [],
    };
    let offset = 0;

    for (const path of paths) {
      if (!this.drawsAsTrail(path)) {
        continue;
      }

      const style = this.restingStyle(path, this.onTrail(path));
      const drawable =
          this.renderer.lineProgram.plan(
              style.fill,
              style.stroke,
              style.radius,
              style.pattern,
              Z_PATH,
              path.line,
              buffer,
              offset,
              plan.buffer);
      plan.paths.push(drawable);
      offset += drawable.geometryByteLength;

      bounds.insert({
        entity: path,
        line: path.line,
      }, path.bound);
    }

    for (const point of points) {
      const icon = pointsAtlasIndex(point.type);
      const {byteSize, drawable} =
          this.renderer.billboardProgram.plan(
              point.markerPx,
              NO_OFFSET,
              POINT_BILLBOARD_SIZE_PX,
              /* angle= */ 0,
              0xFFFFFFFF as RgbaU32,
              Z_POINT,
              icon,
              POINTS_ATLAS_SIZE,
              buffer,
              offset,
              plan.buffer,
              this.pointsAtlas);
      plan.points.push(drawable);
      offset += byteSize;

      bounds.insert({
        entity: point,
        markerPx: point.markerPx,
      }, point.mouseBound);
    }

    this.renderer.uploadData(buffer, offset, plan.buffer);
    return plan;
  }

  loadPinned(): void {
    this.redraw();
  }

  unloadCoarseCell(id: S2CellNumber, paths: Iterable<Path>): void {
    const plan = this.coarsePlans.get(id);
    if (plan) {
      this.renderer.deleteBuffer(plan.buffer);
      this.coarsePlans.delete(id);
    }

    for (const path of paths) {
      this.coarseBounds.delete(path.bound);
    }
  }

  unloadFineCell(id: S2CellNumber, paths: Iterable<Path>, points: Iterable<Point>): void {
    const plan = this.finePlans.get(id);
    if (plan) {
      this.renderer.deleteBuffer(plan.buffer);
      this.finePlans.delete(id);
    }

    for (const path of paths) {
      this.fineBounds.delete(path.bound);
    }
    for (const point of points) {
      this.fineBounds.delete(point.mouseBound);
    }
  }

  private getActiveBounds(): WorldBoundsQuadtree<Handle> {
    // TODO(april): ideally we would query both fine and coarse because they may have different
    // content, but that's annoying.
    const zoom = this.camera.zoom;
    if (this.showDetail(zoom)) {
      if (this.showFine(zoom)) {
        return this.fineBounds;
      } else {
        return this.coarseBounds;
      }
    } else {
      return this.overviewBounds;
    }
  }

  private showDetail(zoom: number): boolean {
    return zoom >= COARSE_ZOOM_THRESHOLD;
  }

  private showFine(zoom: number): boolean {
    return zoom >= FINE_ZOOM_THRESHOLD;
  }
}

function growBuffer(buffer: ArrayBuffer, needed: number): ArrayBuffer {
  if (needed <= buffer.byteLength) {
    return buffer;
  }
  const capacity = Math.pow(2, Math.ceil(Math.log2(needed)) + 1);
  return new ArrayBuffer(capacity);
}

function distanceCheckLine(point: Vec2, line: Float32Array|Float64Array): number {
  let bestDistance2 = Number.MAX_VALUE;
  for (let i = 0; i < line.length - 2; i += 2) {
    const x1 = line[i + 0];
    const y1 = line[i + 1];
    const x2 = line[i + 2];
    const y2 = line[i + 3];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dotted = (point[0] - x1) * dx + (point[1] - y1) * dy;
    const length2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, dotted / length2));
    const px = x1 + t * dx - point[0];
    const py = y1 + t * dy - point[1];
    const d2 = px * px + py * py;

    if (d2 < bestDistance2) {
      bestDistance2 = d2;
    }
  }
  return bestDistance2;
}

// A sidewalk and a crossing are the only footways that exist to carry a pedestrian alongside a
// road. The rest of highway=footway is trail, which is most of what a national park is mapped as.
function isPath(type: number): boolean {
  return (aDescendsB(type, WayCategory.PATH)
        && !aDescendsB(type, WayCategory.PATH_FOOTWAY_SIDEWALK)
        && !aDescendsB(type, WayCategory.PATH_FOOTWAY_CROSSING))
    || aDescendsB(type, WayCategory.PISTE)
    || aDescendsB(type, WayCategory.ROAD_TRACK);
}

function getCellsIn(bounds: S2LatLngRect, deepest: number): Set<S2CellNumber> {
  const cells =
      SimpleS2.cover(
          bounds.lat().lo(), bounds.lat().hi(), bounds.lng().lo(), bounds.lng().hi(), deepest);
  const ids = new Set<S2CellNumber>();
  for (let i = 0; i < cells.size(); ++i) {
    ids.add(reinterpretLong(cells.getAtIndex(i).id()) as S2CellNumber);
  }
  return ids;
}
