import { aDescendsB, WayCategory } from 'java/org/trailcatalog/models/categories';
import { S2CellId, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive, checkExists } from 'js/common/asserts';

import { BoundsQuadtree, worldBounds } from '../../common/bounds_quadtree';
import { DPI } from '../../common/dpi';
import { LittleEndianView } from '../../common/little_endian_view';
import { degreesE7ToLatLng, metersToMiles, projectLatLng, reinterpretLong } from '../../common/math';
import { LatLng, S2CellNumber, Vec2, Vec4 } from '../../common/types';
import { MapDataService } from '../../data/map_data_service';
import { Path, Trail } from '../../models/types';
import { ACTIVE_PALETTE, ACTIVE_HEX_PALETTE, DEFAULT_PALETTE, DEFAULT_HEX_PALETTE, HOVER_PALETTE, HOVER_HEX_PALETTE } from '../common/colors';
import { Camera, projectLatLngRect } from '../models/camera';
import { Line } from '../rendering/geometry';
import { RenderPlanner } from '../rendering/render_planner';
import { RenderableDiamond, RenderableText, TextRenderer } from '../rendering/text_renderer';
import { COARSE_ZOOM_THRESHOLD, FINE_ZOOM_THRESHOLD, PIN_CELL_ID } from '../../workers/data_constants';

import { Layer } from './layer';

export interface Filters {
  trail?: (id: bigint) => boolean;
}

const Z_PATH = 1;
const Z_RAISED_PATH = 2;
const Z_TRAIL_MARKER = 3;
const Z_RAISED_TRAIL_MARKER = 4;
const PATH_RADIUS_PX = 1;
const RAISED_PATH_RADIUS_PX = 4;

interface PathHandle {
  readonly entity: Path;
  readonly line: Float32Array|Float64Array;
}

interface TrailHandle {
  readonly entity: Trail;
  readonly markerPx: Vec2;
  readonly screenPixelBound: Vec4;
}

type Handle = PathHandle|TrailHandle;

const RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD = 12;

const TRAIL_DIAMOND_REGULAR =
    renderableDiamond(DEFAULT_HEX_PALETTE.fill, DEFAULT_HEX_PALETTE.stroke);

// 35px is a larger than the full height of a trail marker (full not half
// because they are not centered vertically.)
const CLICK_RADIUS_PX = 35 * DPI;

export class MapData extends Layer {

  // A note on bounds: we load trails into all quadtrees because trail pins have different sizes at
  // different zooms.
  private readonly overviewBounds: BoundsQuadtree<Handle>;
  private readonly coarseBounds: BoundsQuadtree<Handle>;
  private readonly fineBounds: BoundsQuadtree<Handle>;
  private readonly diamondPixelBounds: Vec4;
  private readonly active: Set<bigint>;
  private readonly hover: Set<bigint>;
  private lastChange: number;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: MapDataService,
      private filters: Filters,
      private readonly textRenderer: TextRenderer,
  ) {
    super();
    this.overviewBounds = worldBounds();
    this.coarseBounds = worldBounds();
    this.fineBounds = worldBounds();

    this.dataService.setListener(this);
    this.registerDisposer(() => {
      this.dataService.clearListener();
    });
    const diamondPixelSize = this.textRenderer.measureDiamond();
    const halfDiamondWidth = diamondPixelSize[0] / 2;
    const halfDiamondHeight = diamondPixelSize[1] / 2;
    this.diamondPixelBounds = [
      -halfDiamondWidth,
      -halfDiamondHeight,
      halfDiamondWidth,
      halfDiamondHeight,
    ];
    this.active = new Set();
    this.hover = new Set();

    this.lastChange = Date.now();
  }

  getTrail(id: bigint): Trail|undefined {
    return this.dataService.trails.get(id);
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  listTrailsOnPath(path: Path): Trail[] {
    return this.dataService.listTrailsOnPath(path);
  }

  queryInBounds(bounds: S2LatLngRect): Array<Path|Trail> {
    const near: Handle[] = [];
    this.getActiveBounds().queryRect(projectLatLngRect(bounds), near);
    return near.map(h => h.entity);
  }

  queryClosest(point: Vec2): Path|Trail|undefined {
    // This method is kind of funny because it tries to be abstract about the types it's processing,
    // but it ends up being type specific implicitly.

    const near: Handle[] = [];
    const screenToWorldPx = this.camera.inverseWorldRadius;
    // We want to select a trail even if 0 distance to a path
    const pathAntibias2 = screenToWorldPx * screenToWorldPx;
    // We really like trails
    const trailBias2 = 10 * 10;
    const radius = CLICK_RADIUS_PX * screenToWorldPx;
    this.getActiveBounds().queryCircle(point, radius, near);

    let best = undefined;
    let bestDistance2 = (7 * screenToWorldPx) * (7 * screenToWorldPx);
    for (const handle of near) {
      let d2 = Number.MAX_VALUE;
      if (handle.entity instanceof Path && this.camera.zoom >= COARSE_ZOOM_THRESHOLD) {
        const path = handle.entity;
        if (this.dataService.pathsToTrails.has(path.id)
            || aDescendsB(path.type, WayCategory.PATH)) {
          const pathHandle = handle as PathHandle;
          d2 = distanceCheckLine(point, pathHandle.line) + pathAntibias2;
        }
      } else if (handle.entity instanceof Trail) {
        if (this.filters.trail && !this.filters.trail(handle.entity.id)) {
          continue;
        }

        const trailHandle = handle as TrailHandle;
        const p = trailHandle.markerPx;
        const bound =
            this.camera.zoom >= RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD
                ? trailHandle.screenPixelBound : this.diamondPixelBounds;
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

  setActive(entity: Path|Trail, state: boolean): void {
    this.setColor(entity, this.active, state);
  }

  setFilters(filters: Filters): void {
    this.filters = filters;
  }

  setHover(entity: Path|Trail, state: boolean): void {
    this.setColor(entity, this.hover, state);
  }

  private setColor(entity: Path|Trail, set: Set<bigint>, state: boolean): void {
    let ids;
    if (entity instanceof Path) {
      ids = [entity.id];
    } else if (entity instanceof Trail) {
      ids = entity.paths.map(id => id & ~1n);
      ids.push(entity.id); // what are the odds that a path and its trail will collide?
    } else {
      throw checkExhaustive(entity);
    }

    if (state) {
      for (const id of ids) {
        set.add(id);
      }
    } else {
      for (const id of ids) {
        set.delete(id);
      }
    }
    this.lastChange = Date.now();
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {
    const bounds = this.camera.viewportBounds(viewportSize[0], viewportSize[1]);
    this.dataService.updateViewport({
      lat: [bounds.lat().lo(), bounds.lat().hi()],
      lng: [bounds.lng().lo(), bounds.lng().hi()],
      zoom,
    });
  }

  plan(viewportSize: Vec2, zoom: number, planner: RenderPlanner): void {
    if (this.showDetail(zoom)) {
      if (this.showFine(zoom)) {
        this.planFine(viewportSize, planner);
      } else {
        this.planCoarse(viewportSize, planner);
      }
    }

    this.planOverview(viewportSize, zoom, planner);
    this.planPins(zoom, planner);
  }

  private planCoarse(viewportSize: Vec2, planner: RenderPlanner): void {
    const cells = this.coarseCellsInView(viewportSize);

    for (const cell of cells) {
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      const buffer = this.dataService.coarseCells.get(id);
      if (buffer !== undefined) {
        if (buffer) {
          this.planCoarseCell(buffer, planner);
        }
      } else {
        const fallback = this.dataService.fineCells.get(id);
        if (fallback) {
          this.planFineCell(fallback, planner);
        }
      }
    }
  }

  private planCoarseCell(buffer: ArrayBuffer, planner: RenderPlanner): void {
    const data = new LittleEndianView(buffer);

    const pathCount = data.getVarInt32();
    const lines: Line[] = [];
    const raised: Line[] = [];
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getVarBigInt64();
      const type = data.getVarInt32();
      const pathVertexCount = data.getVarInt32();
      data.align(4);
      this.pushPath(id, type, data.sliceFloat32(pathVertexCount), lines, raised);
    }

    if (lines.length > 0) {
      planner.addLines(lines, PATH_RADIUS_PX, 0);
    }
    if (raised.length > 0) {
      planner.addLines(raised, RAISED_PATH_RADIUS_PX, 1);
    }
  }

  private planFine(viewportSize: Vec2, planner: RenderPlanner): void {
    const cells = this.fineCellsInView(viewportSize);

    for (const cell of cells) {
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      const buffer = this.dataService.fineCells.get(id);
      if (buffer !== undefined) {
        if (buffer) {
          this.planFineCell(buffer, planner);
        }
      } else {
        const fallback = this.dataService.coarseCells.get(id);
        if (fallback) {
          this.planCoarseCell(fallback, planner);
        }
      }
    }
  }

  private planFineCell(buffer: ArrayBuffer, planner: RenderPlanner): void {
    const data = new LittleEndianView(buffer);

    const pathCount = data.getVarInt32();
    const lines: Line[] = [];
    const raised: Line[] = [];
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getVarBigInt64();
      const type = data.getVarInt32();
      const pathVertexCount = data.getVarInt32();
      data.align(4);
      this.pushPath(id, type, data.sliceFloat32(pathVertexCount), lines, raised);
    }

    if (lines.length > 0) {
      planner.addLines(lines, PATH_RADIUS_PX, 0);
    }
    if (raised.length > 0) {
      planner.addLines(raised, RAISED_PATH_RADIUS_PX, 1);
    }
  }

  private planOverview(viewportSize: Vec2, zoom: number, planner: RenderPlanner): void {
    const cells = this.overviewCellsInView(viewportSize);

    for (const cell of cells) {
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      this.planOverviewCell(id, zoom, planner);
    }
  }

  private planOverviewCell(id: S2CellNumber, zoom: number, planner: RenderPlanner): void {
    const buffer = this.dataService.overviewCells.get(id);
    if (!buffer) {
      return;
    }

    const data = new LittleEndianView(buffer);

    const trailCount = data.getVarInt32();
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getVarBigInt64();
      const nameLength = data.getVarInt32();
      data.skip(nameLength);
      const type = data.getVarInt32();
      const pathCount = data.getVarInt32();
      data.align(8);
      data.skip(8 * pathCount);
      const marker = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const markerPx = projectLatLng(marker);
      data.skip(2 * 4);
      const lengthMeters = data.getFloat32();

      if (this.filters.trail && !this.filters.trail(id)) {
        continue;
      }

      const active = this.active.has(id);
      const hover = this.hover.has(id);
      const z = active || hover ? Z_RAISED_TRAIL_MARKER : Z_TRAIL_MARKER;
      const fill =
          hover ? HOVER_HEX_PALETTE.fill : active ? ACTIVE_HEX_PALETTE.fill : DEFAULT_HEX_PALETTE.fill;
      const stroke =
          hover ? HOVER_HEX_PALETTE.stroke : active ? ACTIVE_HEX_PALETTE.stroke : DEFAULT_HEX_PALETTE.stroke;
      let diamond;
      if (zoom >= RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD) {
        this.textRenderer.planText(
            renderableTrailPin(lengthMeters, fill, stroke), markerPx, z, planner);
      } else if (active || hover) {
        this.textRenderer.planDiamond(renderableDiamond(fill, stroke), markerPx, z, planner);
      } else {
        this.textRenderer.planDiamond(TRAIL_DIAMOND_REGULAR, markerPx, z, planner);
      }
    }
  }

  private planPins(zoom: number, planner: RenderPlanner): void {
    const buffer = this.dataService.coarseCells.get(PIN_CELL_ID);
    if (!buffer) {
      return;
    }

    const lines: Line[] = [];
    const raised: Line[] = [];

    const data = new LittleEndianView(buffer);

    const pathCount = data.getVarInt32();
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getVarBigInt64();
      const type = data.getVarInt32();
      const pathVertexCount = data.getVarInt32();
      data.align(4);
      if (this.dataService.paths.has(id) && zoom >= COARSE_ZOOM_THRESHOLD) {
        data.skip(pathVertexCount * 4);
      } else {
        this.pushPath(id, type, data.sliceFloat32(pathVertexCount), lines, raised);
      }
    }

    if (lines.length > 0) {
      planner.addLines(lines, PATH_RADIUS_PX, 0);
    }
    if (raised.length > 0) {
      planner.addLines(raised, RAISED_PATH_RADIUS_PX, 1);
    }
  }

  private pushPath(
      id: bigint,
      type: number,
      vertices: Float32Array,
      lines: Line[],
      raised: Line[]): void {
    const active = this.active.has(id);
    const hover = this.hover.has(id);
    const onTrail = this.dataService.pathsToTrails.has(id);
    const isPath = aDescendsB(type, WayCategory.PATH);
    if (!onTrail && !isPath) {
      return;
    }

    const buffer = active || hover ? raised : lines;
    const fill =
        hover ? HOVER_PALETTE.fill : active ? ACTIVE_PALETTE.fill : DEFAULT_PALETTE.fill;
    const stroke =
        hover ? HOVER_PALETTE.stroke : active ? ACTIVE_PALETTE.stroke : DEFAULT_PALETTE.stroke;
    buffer.push({
      colorFill: fill,
      colorStroke: stroke,
      stipple: !onTrail,
      vertices: vertices,
    });
  }

  private coarseCellsInView(viewportSize: Vec2): S2CellId[] {
    return this.cellsInView(viewportSize, SimpleS2.HIGHEST_COARSE_INDEX_LEVEL);
  }

  private fineCellsInView(viewportSize: Vec2): S2CellId[] {
    return this.cellsInView(viewportSize, SimpleS2.HIGHEST_FINE_INDEX_LEVEL);
  }

  private overviewCellsInView(viewportSize: Vec2): S2CellId[] {
    return this.cellsInView(viewportSize, SimpleS2.HIGHEST_OVERVIEW_INDEX_LEVEL);
  }

  private cellsInView(viewportSize: Vec2, deepest: number): S2CellId[] {
    const scale = 1; // 3 ensures no matter how the user pans, they wont run out of mapData
    const viewport =
        this.camera.viewportBounds(scale * viewportSize[0], scale * viewportSize[1]);
    const cellsInArrayList = SimpleS2.cover(viewport, deepest);
    const cells = [];
    for (let i = 0; i < cellsInArrayList.size(); ++i) {
      cells.push(cellsInArrayList.getAtIndex(i));
    }
    return cells;
  }

  loadOverviewCell(trails: Iterable<Trail>): void {
    for (const trail of trails) {
      this.overviewBounds.insert({
        entity: trail,
        markerPx: trail.markerPx,
        screenPixelBound: this.diamondPixelBounds,
      }, trail.mouseBound);
    }

    for (const trail of trails) {
      const detailScreenPixelSize =
          this.textRenderer.measureText(renderableTrailPin(trail.lengthMeters, 'unused', 'unused'));
      const halfDetailWidth = detailScreenPixelSize[0] / 2;
      this.coarseBounds.insert({
        entity: trail,
        markerPx: trail.markerPx,
        screenPixelBound: [
          -halfDetailWidth,
          0,
          halfDetailWidth,
          detailScreenPixelSize[1],
        ],
      }, trail.mouseBound);
      this.fineBounds.insert({
        entity: trail,
        markerPx: trail.markerPx,
        screenPixelBound: [
          -halfDetailWidth,
          0,
          halfDetailWidth,
          detailScreenPixelSize[1],
        ],
      }, trail.mouseBound);
    }

    this.lastChange = Date.now();
  }

  loadCoarseCell(paths: Iterable<Path>): void {
    this.lastChange = Date.now();

    for (const path of paths) {
      this.coarseBounds.insert({
        entity: path,
        line: path.line,
      }, path.bound);
    }
  }

  loadFineCell(paths: Iterable<Path>): void {
    this.lastChange = Date.now();

    for (const path of paths) {
      this.fineBounds.insert({
        entity: path,
        line: path.line,
      }, path.bound);
    }
  }

  loadPinned(): void {
    this.lastChange = Date.now();
  }

  unloadCoarseCell(paths: Iterable<Path>): void {
    for (const path of paths) {
      this.coarseBounds.delete(path.bound);
    }
  }

  unloadFineCell(paths: Iterable<Path>): void {
    for (const path of paths) {
      this.fineBounds.delete(path.bound);
    }
  }

  unloadOverviewCell(trails: Iterable<Trail>): void {
    for (const trail of trails) {
      this.overviewBounds.delete(trail.mouseBound);
      this.coarseBounds.delete(trail.mouseBound);
      this.fineBounds.delete(trail.mouseBound);
    }
  }

  private getActiveBounds(): BoundsQuadtree<Handle> {
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

function renderableTrailPin(lengthMeters: number, fill: string, stroke: string): RenderableText {
  return {
    text: `${metersToMiles(lengthMeters).toFixed(1)} mi`,
    fillColor: fill,
    strokeColor: stroke,
    fontSize: 14,
  };
}

function renderableDiamond(fill: string, stroke: string): RenderableDiamond {
  return {
    fillColor: fill,
    strokeColor: stroke,
  };
}
