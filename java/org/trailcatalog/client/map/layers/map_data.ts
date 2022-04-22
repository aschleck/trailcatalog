import { S2CellId, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

import { checkExhaustive, checkExists } from '../../common/asserts';
import { BoundsQuadtree, worldBounds } from '../../common/bounds_quadtree';
import { LittleEndianView } from '../../common/little_endian_view';
import { metersToMiles, reinterpretLong } from '../../common/math';
import { PixelRect, S2CellNumber, Vec2, Vec4 } from '../../common/types';
import { Camera, projectLatLngRect } from '../models/camera';
import { Line, RenderPlanner } from '../rendering/render_planner';
import { Iconography, RenderableText, TextRenderer } from '../rendering/text_renderer';
import { DETAIL_ZOOM_THRESHOLD, FetcherCommand } from '../../workers/data_fetcher';

import { Layer } from './layer';

interface Entity {
  readonly id: bigint;
  readonly line?: Float64Array;
  readonly position?: Vec2;
}

export class Path implements Entity {
  constructor(
      readonly id: bigint,
      readonly type: number,
      readonly bound: PixelRect,
      readonly trails: bigint[],
      readonly line: Float64Array,
  ) {}
}

export class Trail implements Entity {
  constructor(
      readonly id: bigint,
      readonly name: string,
      readonly type: number,
      readonly bound: PixelRect,
      readonly paths: bigint[],
      readonly position: Vec2,
      readonly lengthMeters: number,
  ) {}
}

interface Handle {
  readonly entity: Path|Trail;
  readonly line?: Float64Array;
  readonly position?: Vec2;
  readonly screenPixelBound?: Vec4;
}

interface MapDataListener {
  selectedPath(path: Path): void;
  selectedTrail(trail: Trail): void;
}

const RENDER_PATHS_ZOOM_THRESHOLD = 14;
const TEXT_DECODER = new TextDecoder();

export class MapData implements Layer {

  private readonly metadataBounds: BoundsQuadtree<Handle>;
  private readonly metadataCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  private readonly detailBounds: BoundsQuadtree<Handle>;
  private readonly detailCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  private readonly paths: Map<bigint, Path>;
  private readonly trails: Map<bigint, Trail>;
  private readonly fetcher: Worker;
  private readonly highlighted: Set<bigint>;
  private lastChange: number;

  constructor(
      private readonly camera: Camera,
      private readonly listener: MapDataListener,
      private readonly textRenderer: TextRenderer,
  ) {
    this.metadataBounds = worldBounds();
    this.metadataCells = new Map();
    this.detailBounds = worldBounds();
    this.detailCells = new Map();
    this.paths = new Map();
    this.trails = new Map();
    this.fetcher = new Worker('static/data_fetcher_worker.js');
    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.type === 'lcm') {
        this.loadMetadata(command.cell, command.data);
      } else if (command.type === 'lcd') {
        this.loadDetail(command.cell, command.data);
      } else if (command.type == 'ucc') {
        for (const cell of command.cells) {
          this.unloadCell(cell);
        }
      } else {
        checkExhaustive(command, 'Unknown type of command');
      }
    };
    this.highlighted = new Set();
    this.lastChange = Date.now();
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  queryInBounds(bounds: S2LatLngRect): Array<Path|Trail> {
    const near: Handle[] = [];
    this.getActiveBounds().queryRect(projectLatLngRect(bounds), near);
    return near.map(h => h.entity);
  }

  setTrailHighlighted(id: bigint, highlighted: boolean): void {
    const trail = checkExists(this.trails.get(id));
    const ids = trail.paths;
    if (highlighted) {
      for (const id of ids) {
        this.highlighted.add(id & ~1n);
      }
    } else {
      for (const id of ids) {
        this.highlighted.delete(id & ~1n);
      }
    }
    this.lastChange = Date.now();
  }

  selectClosest(point: Vec2): void {
    const near: Handle[] = [];
    // 35px is a larger than the full height of a trail marker (full not half
    // because they are not centered vertically.)
    const screenToWorldPx = this.camera.inverseWorldRadius;
    const radius = 35 * screenToWorldPx;
    this.getActiveBounds().queryCircle(point, radius, near);

    let best = undefined;
    let bestDistance2 = (7 * screenToWorldPx) * (7 * screenToWorldPx);
    for (const entity of near) {
      let d2 = Number.MAX_VALUE;
      if (entity.line && this.camera.zoom >= RENDER_PATHS_ZOOM_THRESHOLD) {
        d2 = distanceCheckLine(point, entity.line);
      } else if (entity.position) {
        const p = entity.position;
        const bound = entity.screenPixelBound;
        if (bound) {
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
            const bias = 10 * 10;
            d2 = (dx * dx + dy * dy) / bias;
          }
        } else {
          const dx = p[0] - point[0];
          const dy = p[0] - point[0];
          const bias = 10 * 10; // we bias towards picking points over lines
          d2 = (dx * dx + dy * dy) / bias;
        }
      } else {
        continue;
      }

      if (d2 < bestDistance2) {
        best = entity;
        bestDistance2 = d2;
      }
    }

    if (best) {
      const entity = best.entity;
      if (entity instanceof Path) {
        this.listener.selectedPath(entity);
      } else if (entity instanceof Trail) {
        this.listener.selectedTrail(entity);
      }
    }
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {
    const bounds = this.camera.viewportBounds(viewportSize[0], viewportSize[1]);
    this.fetcher.postMessage({
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
    const regularFill: Vec4 = [0, 0, 0, 0];
    const highlightedFill: Vec4 = [1, 0.918, 0, 1];
    const stipple: Vec4 = [0.1, 0.1, 0.1, 1];

    for (const cell of cells) {
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      const buffer = this.detailCells.get(id);
      if (!buffer) {
        continue;
      }

      const data = new LittleEndianView(buffer);

      const pathCount = data.getInt32();
      for (let i = 0; i < pathCount; ++i) {
        const id = data.getBigInt64();
        const highlighted = this.highlighted.has(id);

        if (highlighted || zoom >= RENDER_PATHS_ZOOM_THRESHOLD) {
          const type = data.getInt32();
          const trailCount = data.getInt32();
          data.skip(trailCount * 8);
          const pathVertexBytes = data.getInt32();
          const pathVertexCount = pathVertexBytes / 16;
          data.align(8);
          lines.push({
            colorFill: this.highlighted.has(id) ? highlightedFill : regularFill,
            colorStipple: stipple,
            vertices: data.sliceFloat64(pathVertexCount * 2),
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
        const trail = checkExists(this.trails.get(id)) as Trail;
        this.textRenderer.plan(
            renderableTrailPin(lengthMeters), trail.position, /* z= */ 1, planner);
      }
    }

    if (lines.length > 0) {
      planner.addLines(lines, 0);
    }
  }

  private planSparse(viewportSize: Vec2, planner: RenderPlanner): void {
    const cells = this.metadataCellsInView(viewportSize);

    for (const cell of cells) {
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      const buffer = this.metadataCells.get(id);
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
        this.textRenderer.plan(renderableShield(), position, /* z= */ 1, planner);
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

  private loadMetadata(id: S2CellNumber, buffer: ArrayBuffer): void {
    // Check if the server wrote us a 1 byte response with 0 trails and paths.
    if (buffer.byteLength <= 8) {
      this.detailCells.set(id, undefined);
      return;
    }

    const data = new LittleEndianView(buffer);

    const trailCount = data.getInt32();
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getBigInt64();
      const nameLength = data.getInt32();
      const name = TEXT_DECODER.decode(data.sliceInt8(nameLength));
      const type = data.getInt32();
      const position: Vec2 = [data.getFloat64(), data.getFloat64()];
      // We really struggle bounds checking trails, but on the plus side we
      // calculate a radius on click queries. So as long as our query radius
      // includes this point we can do fine-grained checks to determine what is
      // *actually* being clicked.
      const epsilon = 1e-5;
      const bound: PixelRect = {
        low: [position[0] - epsilon, position[1] - epsilon],
        high: [position[0] + epsilon, position[1] + epsilon],
      };
      const lengthMeters = data.getFloat64();
      const sparseScreenPixelSize = this.textRenderer.measure(renderableShield());
      const halfSparseWidth = sparseScreenPixelSize[0] / 2;
      const trail =
          new Trail(
              id,
              name,
              type,
              bound,
              [],
              position,
              lengthMeters);
      this.metadataBounds.insert({
        entity: trail,
        position,
        screenPixelBound: [-halfSparseWidth, 0, halfSparseWidth, sparseScreenPixelSize[1]],
      }, bound);
      if (!this.trails.has(id)) {
        this.trails.set(id, trail);
      }
    }

    this.metadataCells.set(id, buffer);
    this.lastChange = Date.now();
  }

  private loadDetail(id: S2CellNumber, buffer: ArrayBuffer): void {
    // Check if the server wrote us a 1 byte response with 0 trails and paths.
    if (buffer.byteLength <= 8) {
      this.detailCells.set(id, undefined);
      return;
    }

    this.detailCells.set(id, buffer);
    this.lastChange = Date.now();

    const data = new LittleEndianView(buffer);

    const pathCount = data.getInt32();
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getBigInt64();
      const type = data.getInt32();
      const pathTrailCount = data.getInt32();
      const pathTrails = [];
      for (let j = 0; j < pathTrailCount; ++j) {
        pathTrails.push(data.getBigInt64());
      }

      const pathVertexBytes = data.getInt32();
      const pathVertexCount = pathVertexBytes / 16;
      data.align(8);
      const points = data.sliceFloat64(pathVertexCount * 2);
      const bound: PixelRect = {
        low: [1, 1],
        high: [-1, -1],
      };
      for (let i = 0; i < pathVertexCount; ++i) {
        const x = points[i * 2 + 0];
        const y = points[i * 2 + 1];
        bound.low[0] = Math.min(bound.low[0], x);
        bound.low[1] = Math.min(bound.low[1], y);
        bound.high[0] = Math.max(bound.high[0], x);
        bound.high[1] = Math.max(bound.high[1], y);
      }
      const built = new Path(id, type, bound, pathTrails, points);
      this.detailBounds.insert({
        entity: built,
        line: points,
      }, bound);
      this.paths.set(id, built);
    }

    const trailCount = data.getInt32();
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getBigInt64();
      const nameLength = data.getInt32();
      const name = TEXT_DECODER.decode(data.sliceInt8(nameLength));
      const type = data.getInt32();
      const trailWayCount = data.getInt32();
      data.align(8);
      const trailWays = [...data.sliceBigInt64(trailWayCount)];
      const position: Vec2 = [data.getFloat64(), data.getFloat64()];
      // We really struggle bounds checking trails, but on the plus side we
      // calculate a radius on click queries. So as long as our query radius
      // includes this point we can do fine-grained checks to determine what is
      // *actually* being clicked.
      const epsilon = 1e-5;
      const bound: PixelRect = {
        low: [position[0] - epsilon, position[1] - epsilon],
        high: [position[0] + epsilon, position[1] + epsilon],
      };
      const lengthMeters = data.getFloat64();
      const detailScreenPixelSize = this.textRenderer.measure(renderableTrailPin(lengthMeters));
      const halfDetailWidth = detailScreenPixelSize[0] / 2;
      const sparseScreenPixelSize = this.textRenderer.measure(renderableShield());
      const halfSparseWidth = sparseScreenPixelSize[0] / 2;
      const existing = this.trails.get(id);
      let trail;
      if (existing) {
        trail = existing;
        if (trail.paths.length === 0) {
          trail.paths.push(...trailWays);
        }
      } else {
        trail =
            new Trail(
                id,
                name,
                type,
                bound,
                trailWays,
                position,
                lengthMeters);
        this.trails.set(id, trail);
      }
      this.detailBounds.insert({
        entity: trail,
        position,
        screenPixelBound: [-halfDetailWidth, 0, halfDetailWidth, detailScreenPixelSize[1]],
      }, bound);
    }
  }

  private unloadCell(id: S2CellNumber): void {
    const buffer = this.detailCells.get(id);
    this.metadataCells.delete(id);
    this.detailCells.delete(id);
    if (!buffer) {
      return;
    }

    const data = new LittleEndianView(buffer);

    const pathCount = data.getInt32();
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getBigInt64();
      data.skip(4);
      const pathTrailCount = data.getInt32();
      data.skip(pathTrailCount * 8);

      const pathVertexBytes = data.getInt32();
      data.align(8);
      data.skip(pathVertexBytes);
      const entity = this.paths.get(id);
      if (entity) {
        this.detailBounds.delete(entity.bound);
        this.paths.delete(id);
      }
    }

    const trailCount = data.getInt32();
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getBigInt64();
      const nameLength = data.getInt32();
      data.skip(nameLength + 4);
      const trailWayCount = data.getInt32();
      data.align(8);
      data.skip(trailWayCount * 8 + 16 + 8);

      const entity = this.trails.get(id);
      if (entity) {
        this.detailBounds.delete(entity.bound);
        this.metadataBounds.delete(entity.bound);
        this.trails.delete(id);
      }
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

function distanceCheckLine(point: Vec2, line: Float64Array): number {
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

function renderableTrailPin(lengthMeters: number): RenderableText {
  return {
    text: `${metersToMiles(lengthMeters).toFixed(1)} mi`,
    backgroundColor: 'black',
    borderRadius: 3,
    fillColor: 'white',
    fontSize: 14,
    iconography: Iconography.PIN,
    paddingX: 6,
    paddingY: 6,
  };
}

function renderableShield(): RenderableText {
  return {
    text: '',
    backgroundColor: 'black',
    borderRadius: 3,
    fillColor: 'white',
    fontSize: 14,
    iconography: Iconography.PIN,
    paddingX: 0,
    paddingY: 0,
  };
}
