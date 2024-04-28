import { aDescendsB, PointCategory, WayCategory } from 'java/org/trailcatalog/models/categories';
import { S2CellId, S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive, checkExists } from 'js/common/asserts';
import { LittleEndianView } from 'js/common/little_endian_view';
import { Camera, projectLatLngRect, projectS2LatLng } from 'js/map2/camera';
import { WorldBoundsQuadtree } from 'js/map2/common/bounds_quadtree';
import { DPI } from 'js/map2/common/dpi';
import { LatLng, RgbaU32, Vec2, Vec4 } from 'js/map2/common/types';
import { EventSource, Layer } from 'js/map2/layer';
import { GLYPHER, toGraphemes } from 'js/map2/rendering/glypher';
import { Planner } from 'js/map2/rendering/planner';
import { Drawable } from 'js/map2/rendering/program';
import { Renderer } from 'js/map2/rendering/renderer';
import { TexturePool } from 'js/map2/rendering/texture_pool';

import { formatDistance } from '../common/formatters';
import { degreesE7ToLatLng, projectLatLng, reinterpretLong } from '../common/math';
import { S2CellNumber } from '../common/types';
import { Listener, MapDataService } from '../data/map_data_service';
import { Path, Point, Trail } from '../models/types';
import { COARSE_ZOOM_THRESHOLD, FINE_ZOOM_THRESHOLD, PIN_CELL_ID } from '../workers/data_constants';

import { DEFAULT_PALETTE, DEFAULT_HEX_PALETTE, HOVER_PALETTE, LinePalette } from './colors';
import { HOVER_CHANGED, SELECTION_CHANGED } from './events';
import { PinRenderer } from './pin_renderer';

export interface Filters {
  trail?: (id: bigint) => boolean;
}

const NO_OFFSET = [0, 0] as Vec2;
const POINT_BILLBOARD_SIZE_PX = [20, 20] as Vec2;
const POINT_HOVER_BILLBOARD_SIZE_PX = [28, 28] as Vec2;
const POINTS_ATLAS = new Map<PointCategory, number>([
  // [point.svg, 0], // point.svg
  [PointCategory.AMENITY_HUT_ALPINE, 1], // alpine_hut.svg
  [PointCategory.AMENITY_FIRE_BARBECUE, 2], // barbecue.svg
  // [bridge.svg, 3], // bridge.svg
  [PointCategory.AMENITY_CAMP_SITE, 4], // camp_site.svg
  [PointCategory.NATURAL_CAVE_ENTRANCE, 5], // cave_entrance.svg
  [PointCategory.AMENITY_WATER_DRINKING, 6], // drinking_water.svg
  [PointCategory.AMENITY_FIRE_PIT, 7], // firepit.svg
  [PointCategory.INFORMATION_GUIDE_POST, 8], // guidepost.svg
  [PointCategory.WAY_MOUNTAIN_PASS, 9], // mountain_pass.svg
  [PointCategory.AMENITY_PARKING, 10], // parking.svg
  [PointCategory.NATURAL_PEAK, 11], // peak.svg
  [PointCategory.AMENITY_PICNIC_TABLE, 12], // picnic_table.svg
  [PointCategory.NATURAL_SADDLE, 13], // saddle.svg
  [PointCategory.AMENITY_SHELTER, 14], // shelter.svg
  [PointCategory.AMENITY_TOILETS, 15], // toilets.svg
  [PointCategory.WAY_PATH_TRAILHEAD, 16], // trailhead.svg
  [PointCategory.WAY_VIEWPOINT, 17], // viewpoint.svg
  [PointCategory.INFORMATION_VISITOR_CENTER, 18], // visitor_center.svg
  [PointCategory.NATURAL_VOLCANO, 19], // volcano.svg
  [PointCategory.NATURAL_WATERFALL, 20], // waterfall.svg
  [PointCategory.AMENITY_HUT_WILDERNESS, 21], // wilderness_hut.svg

  // Custom additions, do not remove
  // !!! This is a repeat of camp site
  [PointCategory.AMENITY_CAMP_PITCH, 4], // camp_site.svg
  // !!! This is a repeat of picnic table
  [PointCategory.AMENITY_PICNIC_SITE, 12], // picnic_table.svg
]);
const POINTS_ATLAS_SIZE = [8, 4] as Vec2;

const Z_PATH = 110;
const Z_RAISED_PATH = 111;
const Z_POINT = 112;
const Z_TRAIL_MARKER = 113;
const Z_RAISED_TRAIL_MARKER = 114;
const PATH_RADIUS_PX = 1.5;
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
  readonly screenPixelBound: Vec4;
}

type Handle = PathHandle|PointHandle|TrailHandle;

interface CellPlan {
  buffer: WebGLBuffer;
  paths: Drawable[];
  pinsLabeled: Drawable[];
  pinsUnlabeled: Drawable[];
  points: Drawable[];
}

const RENDER_POINT_ZOOM_THRESHOLD = 14;
const RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD = 12;

const UNLABELED_PIN_REGULAR = {
  textSize: [0, 0] as const,
  fillColor: DEFAULT_HEX_PALETTE.fill,
  strokeColor: '#ffffffff',
};

// 35px is a larger than the full height of a trail marker (full not half
// because they are not centered vertically.)
const CLICK_RADIUS_PX = 35 * DPI;

export class TrailLayer extends Layer implements Listener {

  // A note on bounds: we load trails into all quadtrees because trail pins have different sizes at
  // different zooms.
  private readonly overviewBounds: WorldBoundsQuadtree<Handle>;
  private readonly coarseBounds: WorldBoundsQuadtree<Handle>;
  private readonly fineBounds: WorldBoundsQuadtree<Handle>;
  private readonly overviewPlans: Map<S2CellNumber, CellPlan>;
  private readonly coarsePlans: Map<S2CellNumber, CellPlan>;
  private readonly finePlans: Map<S2CellNumber, CellPlan>;
  private readonly interactivePlan: CellPlan;
  private readonly pinPixelBounds: Vec4;
  private readonly active: Map<bigint, LinePalette>;
  private readonly hovering: Map<bigint, LinePalette>;
  private readonly pinRenderer: PinRenderer;
  private readonly pointsAtlas: WebGLTexture;
  private generation: number;
  private lastGeneration: number;
  private lastHoverTarget: Path|Point|Trail|undefined;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: MapDataService,
      private filters: Filters,
      private readonly renderer: Renderer,
  ) {
    super();
    this.overviewBounds = new WorldBoundsQuadtree<Handle>();
    this.coarseBounds = new WorldBoundsQuadtree<Handle>();
    this.fineBounds = new WorldBoundsQuadtree<Handle>();
    this.overviewPlans = new Map();
    this.coarsePlans = new Map();
    this.finePlans = new Map();
    this.interactivePlan = {
      buffer: this.renderer.createDataBuffer(0),
      paths: [],
      pinsLabeled: [],
      pinsUnlabeled: [],
      points: [],
    };
    this.registerDisposer(() => {
      for (const source of [this.overviewPlans, this.coarsePlans, this.finePlans]) {
        for (const {buffer} of source.values()) {
          this.renderer.deleteBuffer(buffer);
        }
      }

      this.renderer.deleteBuffer(this.interactivePlan.buffer);
    });
    this.active = new Map();
    this.hovering = new Map();
    this.pinRenderer = new PinRenderer(renderer);
    this.registerDisposable(this.pinRenderer);
    // Why don't we need to dispose?
    this.pointsAtlas = new TexturePool(renderer).acquire();

    const pinPixelSize = this.pinRenderer.measureUnlabeledPin();
    const halfPinWidth = pinPixelSize[0] / 2;
    const halfPinHeight = pinPixelSize[1] / 2;
    this.pinPixelBounds = [
      -halfPinWidth,
      -halfPinHeight,
      halfPinWidth,
      halfPinHeight,
    ];

    this.generation = -1;
    this.lastGeneration = -1;

    this.dataService.setListener(this);
    this.registerDisposer(() => {
      this.dataService.clearListener();
    });

    fetch('/static/images/atlases/points.png')
        .then(response => {
          if (response.ok) {
            return response.blob();
          } else {
            throw new Error('Unable to fetch atlas');
          }
        })
        .then(blob => createImageBitmap(blob))
        .then(bitmap => {
          renderer.uploadTexture(bitmap, this.pointsAtlas);
          this.generation += 1;
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
      source.trigger(HOVER_CHANGED, {target: best});
    }
    this.lastHoverTarget = best;
    if (best) {
      this.setHover(best, true);
    }
    return true;
  }

  override render(planner: Planner): void {
    // TODO(april): we don't mark and sweep the pin renderer and it's not clear how we would

    for (const source of [
      new Map([['', this.interactivePlan]]),
      this.overviewPlans,
      this.camera.zoom >= FINE_ZOOM_THRESHOLD ? this.finePlans : this.coarsePlans,
    ]) {
      for (const {paths, pinsLabeled, pinsUnlabeled, points} of source.values()) {
        if (this.camera.zoom >= COARSE_ZOOM_THRESHOLD) {
          planner.add(paths);
        }

        if (this.camera.zoom >= RENDER_POINT_ZOOM_THRESHOLD) {
          planner.add(points);
        }

        if (this.camera.zoom >= RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD) {
          planner.add(pinsLabeled);
        } else {
          planner.add(pinsUnlabeled);
        }
      }
    }

    planner.add(this.interactivePlan.paths);
    planner.add(this.interactivePlan.points);

    this.lastGeneration = this.generation;
  }

  override hasNewData(): boolean {
    return this.generation !== this.lastGeneration;
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

    const near: Handle[] = [];
    const screenToWorldPx = this.camera.inverseWorldRadius;
    // We want to select a trail even if 0 distance to a path
    const pathAntibias2 = screenToWorldPx * screenToWorldPx;
    // We like points
    const pointBias2 = 5 * 10;
    // But we really like trails
    const trailBias2 = 10 * 10;
    const radius = CLICK_RADIUS_PX * screenToWorldPx;
    this.getActiveBounds().queryCircle(point, radius, near);

    let best = undefined;
    let bestDistance2 = (7 * screenToWorldPx) * (7 * screenToWorldPx);
    for (const handle of near) {
      let d2 = Number.MAX_VALUE;
      if (handle.entity instanceof Path && this.camera.zoom >= COARSE_ZOOM_THRESHOLD) {
        const path = handle.entity;
        if (this.dataService.pathsToTrails.has(path.id) || isPath(path.type)) {
          const pathHandle = handle as PathHandle;
          d2 = distanceCheckLine(point, pathHandle.line) + pathAntibias2;
        }
      } else if (handle.entity instanceof Point && this.camera.zoom >= FINE_ZOOM_THRESHOLD) {
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

  setActive(entity: Path|Trail, state: boolean, color: LinePalette): void {
    this.setColor(entity, this.active, state, color);
  }

  setFilters(filters: Filters): void {
    this.filters = filters;
    this.generation += 1;
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

    this.updateInteractive();
  }

  private updateInteractive(): void {
    const buffer = new ArrayBuffer(1024 * 1024 * 1024);
    this.interactivePlan.paths.length = 0;
    this.interactivePlan.pinsLabeled.length = 0;
    this.interactivePlan.pinsUnlabeled.length = 0;
    this.interactivePlan.points.length = 0;
    let offset = 0;

    // Order matters here! We want to draw active things *before* hovered things because they draw
    // at the same Z and the first thing drawn will win.
    for (const source of [this.hovering, this.active]) {
      for (const [id, palette] of source) {
        const path = this.dataService.getPath(id);
        if (path) {
          const onTrail = this.dataService.pathsToTrails.has(path.id);
          if (!onTrail && !isPath(path.type)) {
            continue;
          }

          const drawable =
              this.renderer.lineProgram.plan(
                  palette.raw.fill,
                  palette.raw.stroke,
                  RAISED_PATH_RADIUS_PX,
                  !onTrail,
                  Z_RAISED_PATH,
                  path.line,
                  buffer,
                  offset,
                  this.interactivePlan.buffer);
          this.interactivePlan.paths.push(drawable);
          this.interactivePlan.paths.push({
            ...drawable,
            program: this.renderer.lineCapProgram,
          });
          offset += drawable.geometryByteLength;
        }

        const trail = this.dataService.getTrail(id);
        if (trail) {
          {
            const {byteSize, drawable} =
                this.pinRenderer.planPin(
                    {
                      textSize: [0, 0] as const,
                      fillColor: palette.hex.fill,
                      strokeColor: palette.hex.stroke,
                    },
                    trail.markerPx,
                    Z_RAISED_TRAIL_MARKER,
                    buffer,
                    offset,
                    this.interactivePlan.buffer);
            this.interactivePlan.pinsUnlabeled.push(drawable);
            offset += byteSize;
          }

          {
            const {value, unit} = formatDistance(trail.lengthMeters);
            const text = `${value} ${unit}`;
            const graphemes = toGraphemes(text);
            const textSize = GLYPHER.measurePx(graphemes, TRAIL_MARKER_TEXT_SCALE);
            if (!textSize) {
              continue;
            }

            const pinPlan =
                this.pinRenderer.planPin(
                    {
                      textSize,
                      fillColor: palette.hex.fill,
                      strokeColor: palette.hex.stroke,
                    },
                    trail.markerPx,
                    Z_RAISED_TRAIL_MARKER,
                    buffer,
                    offset,
                    this.interactivePlan.buffer);
            this.interactivePlan.pinsLabeled.push(pinPlan.drawable);
            offset += pinPlan.byteSize;
            const textOffset = pinPlan.textOffset;

            const {byteSize, drawables} =
                GLYPHER.plan(
                    graphemes,
                    trail.markerPx,
                    textOffset,
                    TRAIL_MARKER_TEXT_SCALE,
                    /* angle= */ 0,
                    palette.raw.stroke,
                    palette.raw.fill,
                    Z_RAISED_TRAIL_MARKER + 0.1,
                    buffer,
                    offset,
                    this.interactivePlan.buffer,
                    this.renderer);
            this.interactivePlan.pinsLabeled.push(...drawables);
            offset += byteSize;
          }
        }
      }
    }

    this.renderer.uploadData(buffer, offset, this.interactivePlan.buffer);
    this.generation += 1;
  }

  viewportChanged(bounds: S2LatLngRect, zoom: number): void {
    this.dataService.updateViewport({
      lat: [bounds.lat().lo(), bounds.lat().hi()],
      lng: [bounds.lng().lo(), bounds.lng().hi()],
      zoom,
    });
  }

  loadOverviewCell(id: S2CellNumber, trails: Iterable<Trail>): void {
    const buffer = new ArrayBuffer(1024 * 1024 * 1024);
    const pinsLabeled = [];
    const pinsUnlabeled = [];
    const glBuffer = this.renderer.createDataBuffer(0);
    let offset = 0;

    for (const trail of trails) {
      const {byteSize, drawable} =
          this.pinRenderer.planPin(
              UNLABELED_PIN_REGULAR,
              trail.markerPx,
              Z_TRAIL_MARKER,
              buffer,
              offset,
              glBuffer);
      pinsUnlabeled.push(drawable);
      offset += byteSize;

      this.overviewBounds.insert({
        entity: trail,
        markerPx: trail.markerPx,
        screenPixelBound: this.pinPixelBounds,
      }, trail.mouseBound);
    }

    for (const trail of trails) {
      const {value, unit} = formatDistance(trail.lengthMeters);
      const text = `${value} ${unit}`;
      const graphemes = toGraphemes(text);
      // TODO(april): if the glyphs aren't loaded then we cache a broken tile...
      const textSize = GLYPHER.measurePx(graphemes, TRAIL_MARKER_TEXT_SCALE);
      if (!textSize) {
        continue;
      }

      const pinSize = this.pinRenderer.measureLabeledPin(textSize);

      const pin = {
        textSize,
        fillColor: DEFAULT_HEX_PALETTE.fill,
        strokeColor: '#ffffffff',
      };

      const pinPlan =
          this.pinRenderer.planPin(
              pin,
              trail.markerPx,
              Z_TRAIL_MARKER,
              buffer,
              offset,
              glBuffer);
      pinsLabeled.push(pinPlan.drawable);
      offset += pinPlan.byteSize;
      const textOffset = pinPlan.textOffset;

      {
        const {byteSize, drawables} =
            GLYPHER.plan(
                graphemes,
                trail.markerPx,
                textOffset,
                TRAIL_MARKER_TEXT_SCALE,
                /* angle= */ 0,
                DEFAULT_PALETTE.stroke,
                DEFAULT_PALETTE.fill,
                Z_TRAIL_MARKER + 0.1,
                buffer,
                offset,
                glBuffer,
                this.renderer);
        pinsLabeled.push(...drawables);
        offset += byteSize;
      }

      const halfDetailWidth = pinSize[0] / 2;
      this.coarseBounds.insert({
        entity: trail,
        markerPx: trail.markerPx,
        screenPixelBound: [
          -halfDetailWidth,
          0,
          halfDetailWidth,
          pinSize[1],
        ],
      }, trail.mouseBound);
      this.fineBounds.insert({
        entity: trail,
        markerPx: trail.markerPx,
        screenPixelBound: [
          -halfDetailWidth,
          0,
          halfDetailWidth,
          pinSize[1],
        ],
      }, trail.mouseBound);
    }

    this.renderer.uploadData(buffer, offset, glBuffer);
    this.overviewPlans.set(id, {
      buffer: glBuffer,
      paths: [],
      pinsLabeled,
      pinsUnlabeled,
      points: [],
    });

    this.updateInteractive();
    this.generation += 1;
  }

  loadCoarseCell(id: S2CellNumber, paths: Iterable<Path>): void {
    const buffer = new ArrayBuffer(1024 * 1024 * 1024);
    const drawables = [];
    const glBuffer = this.renderer.createDataBuffer(0);
    let offset = 0;

    for (const path of paths) {
      const onTrail = this.dataService.pathsToTrails.has(path.id);
      if (!onTrail && !isPath(path.type)) {
        continue;
      }

      const drawable =
          this.renderer.lineProgram.plan(
              DEFAULT_PALETTE.fill,
              DEFAULT_PALETTE.stroke,
              PATH_RADIUS_PX,
              /* stipple= */ !onTrail,
              Z_PATH,
              path.line,
              buffer,
              offset,
              glBuffer);
      drawables.push(drawable);
      drawables.push({
        ...drawable,
        program: this.renderer.lineCapProgram,
      });
      offset += drawable.geometryByteLength;

      this.coarseBounds.insert({
        entity: path,
        line: path.line,
      }, path.bound);
    }

    this.renderer.uploadData(buffer, offset, glBuffer);
    this.coarsePlans.set(id, {
      buffer: glBuffer,
      paths: drawables,
      pinsLabeled: [],
      pinsUnlabeled: [],
      points: [],
    });

    this.updateInteractive();
    this.generation += 1;
  }

  loadFineCell(id: S2CellNumber, paths: Iterable<Path>, points: Iterable<Point>): void {
    const buffer = new ArrayBuffer(1024 * 1024 * 1024);
    const pathDrawables = [];
    const pointDrawables = [];
    const glBuffer = this.renderer.createDataBuffer(0);
    let offset = 0;

    for (const path of paths) {
      const onTrail = this.dataService.pathsToTrails.has(path.id);
      if (!onTrail && !isPath(path.type)) {
        continue;
      }

      const drawable =
          this.renderer.lineProgram.plan(
              DEFAULT_PALETTE.fill,
              DEFAULT_PALETTE.stroke,
              PATH_RADIUS_PX,
              !onTrail,
              Z_PATH,
              path.line,
              buffer,
              offset,
              glBuffer);
      pathDrawables.push(drawable);
      pathDrawables.push({
        ...drawable,
        program: this.renderer.lineCapProgram,
      });
      offset += drawable.geometryByteLength;

      this.fineBounds.insert({
        entity: path,
        line: path.line,
      }, path.bound);
    }

    for (const point of points) {
      const icon = POINTS_ATLAS.get(point.type) ?? 0;
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
              glBuffer,
              this.pointsAtlas);
      pointDrawables.push(drawable);
      offset += byteSize;

      this.fineBounds.insert({
        entity: point,
        markerPx: point.markerPx,
      }, point.mouseBound);
    }

    this.renderer.uploadData(buffer, offset, glBuffer);
    this.finePlans.set(id, {
      buffer: glBuffer,
      paths: pathDrawables,
      pinsLabeled: [],
      pinsUnlabeled: [],
      points: pointDrawables,
    });

    this.updateInteractive();
    this.generation += 1;
  }

  loadPinned(): void {
    this.updateInteractive();
    this.generation += 1;
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

  unloadOverviewCell(id: S2CellNumber, trails: Iterable<Trail>): void {
    const plan = this.overviewPlans.get(id);
    if (plan) {
      this.renderer.deleteBuffer(plan.buffer);
      this.overviewPlans.delete(id);
    }

    for (const trail of trails) {
      this.overviewBounds.delete(trail.mouseBound);
      this.coarseBounds.delete(trail.mouseBound);
      this.fineBounds.delete(trail.mouseBound);
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

function isPath(type: number): boolean {
  return (aDescendsB(type, WayCategory.PATH) && !aDescendsB(type, WayCategory.PATH_FOOTWAY))
    || aDescendsB(type, WayCategory.ROAD_TRACK);
}

