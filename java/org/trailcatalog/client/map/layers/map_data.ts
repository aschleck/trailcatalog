import { S2CellId, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { Disposable } from 'js/common/disposable';

import { checkExhaustive, checkExists } from '../../common/asserts';
import { BoundsQuadtree, worldBounds } from '../../common/bounds_quadtree';
import { DPI } from '../../common/dpi';
import { LittleEndianView } from '../../common/little_endian_view';
import { metersToMiles, reinterpretLong, rgbaToUint32F } from '../../common/math';
import { PixelRect, S2CellNumber, Vec2, Vec4 } from '../../common/types';
import { MapDataService } from '../../data/map_data_service';
import { Path, Trail } from '../../models/types';
import { Camera, projectLatLngRect } from '../models/camera';
import { Line } from '../rendering/geometry';
import { RenderPlanner } from '../rendering/render_planner';
import { DIAMOND_RADIUS_PX, Iconography, RenderableText, TextRenderer } from '../rendering/text_renderer';
import { DETAIL_ZOOM_THRESHOLD, FetcherCommand } from '../../workers/data_fetcher';

import { Layer } from './layer';

const Z_PATH = 1;
const Z_RAISED_PATH = 2;
const Z_TRAIL_MARKER = 3;
const Z_RAISED_TRAIL_MARKER = 4;
const PATH_RADIUS_PX = 1;
const RAISED_PATH_RADIUS_PX = 4;

const PATH_COLORS = {
  fill: rgbaToUint32F(0, 0, 0, 1),
  stroke: rgbaToUint32F(0, 0, 0, 1),
} as const;
const PATH_HIGHLIGHTED_COLORS = {
  fill: rgbaToUint32F(1, 0.918, 0, 1),
  stroke: rgbaToUint32F(0, 0, 0, 1),
} as const;

interface Filter {
  boundary?: number;
}

interface PathHandle {
  readonly entity: Path;
  readonly line: Float32Array|Float64Array;
}

interface TrailHandle {
  readonly entity: Trail;
  readonly position: Vec2;
  readonly screenPixelBound: Vec4;
}

type Handle = PathHandle|TrailHandle;

const HIGHLIGHT_PATH_COLOR = '#ffe600';
const HIGHLIGHT_TRAIL_COLOR = '#f2f2f2';
const RENDER_PATHS_ZOOM_THRESHOLD = 10;
const RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD = 12;

const TRAIL_DIAMOND_REGULAR = renderableDiamond(false);
const TRAIL_DIAMOND_HIGHLIGHTED = renderableDiamond(true);

// 35px is a larger than the full height of a trail marker (full not half
// because they are not centered vertically.)
const CLICK_RADIUS_PX = 35 * DPI;

export class MapData extends Disposable implements Layer {

  private readonly metadataBounds: BoundsQuadtree<Handle>;
  private readonly detailBounds: BoundsQuadtree<Handle>;
  private readonly highlighted: Set<bigint>;
  private readonly diamondPixelBounds: Vec4;
  private lastChange: number;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: MapDataService,
      filter: Filter,
      private readonly textRenderer: TextRenderer,
  ) {
    super();
    this.metadataBounds = worldBounds();
    this.detailBounds = worldBounds();

    this.dataService.setListener(this);
    this.registerDisposer(() => {
      this.dataService.clearListener();
    });
    //this.fetcher.postMessage({
    //  ...filter,
    //  kind: 'sfr',
    //});
    this.highlighted = new Set();
    const diamondPixelSize = this.textRenderer.measure(renderableDiamond(false));
    const halfDiamondWidth = diamondPixelSize[0] / 2;
    const halfDiamondHeight = diamondPixelSize[1] / 2;
    this.diamondPixelBounds = [
      -halfDiamondWidth,
      -halfDiamondHeight,
      halfDiamondWidth,
      halfDiamondHeight,
    ];
    this.lastChange = Date.now();
  }

  getTrail(id: bigint): Trail|undefined {
    return this.dataService.trails.get(id);
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  listTrailsOnPath(path: Path): Trail[] {
    return path.trails.map(t => this.dataService.trails.get(t)).filter(exists);
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
      if (handle.entity instanceof Path && this.camera.zoom >= RENDER_PATHS_ZOOM_THRESHOLD) {
        const pathHandle = handle as PathHandle;
        d2 = distanceCheckLine(point, pathHandle.line) + pathAntibias2;
      } else if (handle.entity instanceof Trail) {
        const trailHandle = handle as TrailHandle;
        const p = trailHandle.position;
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

    return best;
  }

  setHighlighted(entity: Path|Trail, highlighted: boolean): void {
    let ids;
    if (entity instanceof Path) {
      ids = [entity.id];
    } else if (entity instanceof Trail) {
      ids = entity.paths.map(id => id & ~1n);
      ids.push(entity.id); // what are the odds that a path and its trail will collide?
    } else {
      throw checkExhaustive(entity);
    }

    if (highlighted) {
      for (const id of ids) {
        this.highlighted.add(id);
      }
    } else {
      for (const id of ids) {
        this.highlighted.delete(id);
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
      this.planDetailed(viewportSize, zoom, planner);
    } else {
      this.planSparse(viewportSize, planner);
    }
  }

  private planDetailed(viewportSize: Vec2, zoom: number, planner: RenderPlanner): void {
    const cells = this.detailCellsInView(viewportSize);
    const lines: Line[] = [];
    const raised: Line[] = [];

    for (const cell of cells) {
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      const buffer = this.dataService.detailCells.get(id);
      if (!buffer) {
        continue;
      }

      const data = new LittleEndianView(buffer);

      const pathCount = data.getInt32();
      for (let i = 0; i < pathCount; ++i) {
        const id = data.getBigInt64();
        const highlighted = this.highlighted.has(id);

        if (zoom >= RENDER_PATHS_ZOOM_THRESHOLD) {
          const type = data.getInt32();
          const trailCount = data.getInt32();
          data.skip(trailCount * 8);
          const pathVertexBytes = data.getInt32();
          const pathVertexCount = pathVertexBytes / 8;
          data.align(4);
          let color;
          let buffer;
          if (this.highlighted.has(id)) {
            color = PATH_HIGHLIGHTED_COLORS;
            buffer = raised;
          } else {
            color = PATH_COLORS;
            buffer = lines;
          }
          buffer.push({
            colorFill: color.fill,
            colorStroke: color.stroke,
            vertices: data.sliceFloat32(pathVertexCount * 2),
          });
        } else {
          data.skip(4);
          const trailCount = data.getInt32();
          data.skip(trailCount * 8);
          const pathVertexBytes = data.getInt32();
          data.align(8);
          data.skip(pathVertexBytes);
        }
      }

      const trailCount = data.getInt32();
      for (let i = 0; i < trailCount; ++i) {
        const id = data.getBigInt64();
        const nameLength = data.getInt32();
        data.skip(nameLength);
        const type = data.getInt32();
        const trailWayCount = data.getInt32();
        data.align(8);
        data.skip(trailWayCount * 8 + 16);
        const lengthMeters = data.getFloat64();
        const trail = checkExists(this.dataService.trails.get(id)) as Trail;
        let text;
        let z;
        const highlighted = this.highlighted.has(id);
        if (zoom >= RENDER_TRAIL_DETAIL_ZOOM_THRESHOLD) {
          text = renderableTrailPin(lengthMeters, highlighted);
          z = highlighted ? Z_RAISED_TRAIL_MARKER : Z_TRAIL_MARKER;
        } else if (highlighted) {
          text = TRAIL_DIAMOND_HIGHLIGHTED;
          z = Z_RAISED_TRAIL_MARKER;
        } else {
          text = TRAIL_DIAMOND_REGULAR;
          z = Z_TRAIL_MARKER;
        }
        this.textRenderer.plan(text, trail.position, z, planner);
      }
    }

    if (lines.length > 0) {
      planner.addLines(lines, PATH_RADIUS_PX, 0);
    }
    if (raised.length > 0) {
      planner.addLines(raised, RAISED_PATH_RADIUS_PX, 1);
    }
  }

  private planSparse(viewportSize: Vec2, planner: RenderPlanner): void {
    const cells = this.metadataCellsInView(viewportSize);

    for (const cell of cells) {
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      const buffer = this.dataService.metadataCells.get(id);
      if (!buffer) {
        continue;
      }

      const data = new LittleEndianView(buffer);

      const trailCount = data.getInt32();
      for (let i = 0; i < trailCount; ++i) {
        const id = data.getBigInt64();
        const nameLength = data.getInt32();
        data.skip(nameLength);
        const type = data.getInt32();
        const position: Vec2 = [data.getFloat64(), data.getFloat64()];
        const lengthMeters = data.getFloat64();
        let diamond;
        let z;
        if (this.highlighted.has(id)) {
          diamond = TRAIL_DIAMOND_HIGHLIGHTED;
          z = Z_RAISED_TRAIL_MARKER;
        } else {
          diamond = TRAIL_DIAMOND_REGULAR;
          z = Z_TRAIL_MARKER;
        }
        this.textRenderer.plan(diamond, position, z, planner);
      }
    }
  }

  private detailCellsInView(viewportSize: Vec2): S2CellId[] {
    return this.cellsInView(viewportSize, SimpleS2.HIGHEST_DETAIL_INDEX_LEVEL);
  }

  private metadataCellsInView(viewportSize: Vec2): S2CellId[] {
    return this.cellsInView(viewportSize, SimpleS2.HIGHEST_METADATA_INDEX_LEVEL);
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

  loadMetadata(paths: Iterable<Path>, trails: Iterable<Trail>): void {
    for (const trail of trails) {
      this.metadataBounds.insert({
        entity: trail,
        position: trail.position,
        screenPixelBound: this.diamondPixelBounds,
      }, trail.bound);
    }

    this.lastChange = Date.now();
  }

  loadDetail(paths: Iterable<Path>, trails: Iterable<Trail>): void {
    this.lastChange = Date.now();

    for (const path of paths) {
      this.detailBounds.insert({
        entity: path,
        line: path.line,
      }, path.bound);
    }

    for (const trail of trails) {
      const detailScreenPixelSize =
          this.textRenderer.measure(renderableTrailPin(trail.lengthMeters, false));
      const halfDetailWidth = detailScreenPixelSize[0] / 2;
      this.detailBounds.insert({
        entity: trail,
        position: trail.position,
        screenPixelBound: [
          -halfDetailWidth,
          -detailScreenPixelSize[1] + DIAMOND_RADIUS_PX,
          halfDetailWidth,
          DIAMOND_RADIUS_PX,
        ],
      }, trail.bound);
    }
  }

  unloadEverywhere(paths: Iterable<Path>, trails: Iterable<Trail>): void {
    for (const path of paths) {
      this.detailBounds.delete(path.bound);
    }

    for (const trail of trails) {
      this.detailBounds.delete(trail.bound);
      this.metadataBounds.delete(trail.bound);
    }
  }

  private getActiveBounds(): BoundsQuadtree<Handle> {
    if (this.showDetail(this.camera.zoom)) {
      return this.detailBounds;
    } else {
      return this.metadataBounds;
    }
  }

  private showDetail(zoom: number): boolean {
    return zoom >= DETAIL_ZOOM_THRESHOLD;
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

function renderableTrailPin(lengthMeters: number, highlighted: boolean): RenderableText {
  return {
    ...renderableDiamond(highlighted),
    text: `${metersToMiles(lengthMeters).toFixed(1)} mi`,
    paddingX: 6,
    paddingY: 7,
  };
}

function renderableDiamond(highlighted: boolean): RenderableText {
  return {
    text: '',
    backgroundColor: highlighted ? HIGHLIGHT_TRAIL_COLOR : '#3a3a3a',
    fillColor: highlighted ? 'black' : 'white',
    fontSize: 14,
    iconography: Iconography.DIAMOND,
    paddingX: 0,
    paddingY: 0,
  };
}

function exists<T>(v: T|null|undefined): v is T {
  if (v === null || v === undefined) {
    return false;
  } else {
    return true;
  }
}
