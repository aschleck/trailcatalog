import { checkExhaustive, checkExists } from './models/asserts';
import { Camera } from './models/camera';
import { reinterpretLong } from './models/math';
import { PixelRect, S2CellNumber, Vec2, Vec4 } from './models/types';
import { Line, RenderPlanner } from './rendering/render_planner';
import { TextRenderer } from './rendering/text_renderer';
import { S2CellId, S2LatLngRect } from '../s2';
import { SimpleS2 } from '../s2/SimpleS2';
import { FetcherCommand } from './workers/data_fetcher';

import { BoundsQuadtree, worldBounds } from './bounds_quadtree';
import { Layer } from './layer';
import { LittleEndianView } from './little_endian_view';

interface Entity {
  readonly id: bigint;
  readonly line?: Float64Array;
  readonly position?: Vec2;
}

class Path implements Entity {
  constructor(
      readonly id: bigint,
      readonly type: number,
      readonly bound: PixelRect,
      readonly trails: bigint[],
      readonly line: Float64Array,
  ) {}
}

class Trail implements Entity {
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

const TEXT_DECODER = new TextDecoder();

export class MapData implements Layer {

  private readonly bounds: BoundsQuadtree<Entity>;
  private readonly byCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  private readonly paths: Map<bigint, Path>;
  private readonly trails: Map<bigint, Trail>;
  private readonly fetcher: Worker;
  private readonly selected: Set<bigint>;
  private lastChange: number;

  constructor(
      private readonly camera: Camera,
      private readonly textRenderer: TextRenderer,
  ) {
    this.bounds = worldBounds();
    this.byCells = new Map();
    this.paths = new Map();
    this.trails = new Map();
    this.fetcher = new Worker('static/data_fetcher_worker.js');
    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.type === 'lcc') {
        this.loadCell(command.cell, command.data);
      } else if (command.type == 'ucc') {
        for (const cell of command.cells) {
          this.unloadCell(cell);
        }
      } else {
        checkExhaustive(command, 'Unknown type of command');
      }
    };
    this.selected = new Set();
    this.lastChange = Date.now();
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  query(point: Vec2, radius: number): void {
    const near: Entity[] = [];
    this.bounds.query(point, radius, near);

    let best = undefined;
    let bestDistance2 = radius * radius;
    for (const entity of near) {
      let d2;
      if (entity.line) {
        d2 = distanceCheckLine(point, entity.line);
      } else if (entity.position) {
        const p = entity.position;
        const dx = p[0] - point[0];
        const dy = p[0] - point[0];
        const bias = 10 * 10;
        d2 = (dx * dx + dy * dy) / bias;
      } else {
        continue;
      }

      if (d2 < bestDistance2) {
        best = entity;
        bestDistance2 = d2;
      }
    }
    if (best) {
      const ids = [];
      if (best instanceof Path) {
        ids.push(best.id);
      } else if (best instanceof Trail) {
        ids.push(...best.paths);
      }

      if (this.selected.has(ids[0])) {
        for (const id of ids) {
          this.selected.delete(id & ~1n);
        }
      } else {
        for (const id of ids) {
          this.selected.add(id & ~1n);
        }
      }
      this.lastChange = Date.now();
    }
  }

  viewportBoundsChanged(viewportSize: Vec2): void {
    const bounds = this.camera.viewportBounds(viewportSize[0], viewportSize[1]);
    this.fetcher.postMessage({
      lat: [bounds.lat().lo(), bounds.lat().hi()],
      lng: [bounds.lng().lo(), bounds.lng().hi()],
    });
  }

  plan(viewportSize: Vec2, zoom: number, planner: RenderPlanner): void {
    const cells = this.cellsInView(viewportSize);
    const lines: Line[] = [];
    const regularFill: Vec4 = [0, 0, 0, 0];
    const selectedFill: Vec4 = [1, 0.918, 0, 1];
    const stipple: Vec4 = [0.1, 0.1, 0.1, 1];

    for (const cell of cells) {
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      const buffer = this.byCells.get(id);
      if (!buffer) {
        continue;
      }

      const data = new LittleEndianView(buffer);

      const pathCount = data.getInt32();
      if (zoom > 13) {
        for (let i = 0; i < pathCount; ++i) {
          const id = data.getBigInt64();
          const type = data.getInt32();
          const trailCount = data.getInt32();
          data.skip(trailCount * 8);
          const pathVertexBytes = data.getInt32();
          const pathVertexCount = pathVertexBytes / 16;
          data.align(8);
          lines.push({
            colorFill: this.selected.has(id) ? selectedFill : regularFill,
            colorStipple: stipple,
            vertices: data.sliceFloat64(pathVertexCount * 2),
          });
        }
      } else {
        for (let i = 0; i < pathCount; ++i) {
          data.skip(12);
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
        this.textRenderer.plan({
          text: `${metersToMiles(lengthMeters).toFixed(1)} mi`,
          backgroundColor: 'black',
          borderRadius: 3,
          fillColor: 'white',
          fontSize: 14,
          paddingX: 6,
          paddingY: 6,
        }, trail.position, /* z= */ 1, planner);
      }
    }

    planner.addLines(lines);
  }

  private cellsInView(viewportSize: Vec2): S2CellId[] {
    const scale = 1; // 3 ensures no matter how the user pans, they wont run out of mapData
    const viewport =
        this.camera.viewportBounds(scale * viewportSize[0], scale * viewportSize[1]);
    const cellsInArrayList = SimpleS2.cover(viewport);
    const cells = [];
    for (let i = 0; i < cellsInArrayList.size(); ++i) {
      cells.push(cellsInArrayList.getAtIndex(i));
    }
    return cells;
  }

  private loadCell(id: S2CellNumber, buffer: ArrayBuffer): void {
    // Check if the server wrote us a 1 byte response with 0 trails and paths.
    if (buffer.byteLength > 8) {
      this.byCells.set(id, buffer);
      this.loadMetadata(buffer);
      this.lastChange = Date.now();
    } else {
      this.byCells.set(id, undefined);
    }
  }

  private loadMetadata(buffer: ArrayBuffer): void {
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
      this.bounds.insert(built, bound);
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
      const epsilon = 1e-5; // we really struggle bounds checking trails
      const bound: PixelRect = {
        low: [position[0] - epsilon, position[1] - epsilon],
        high: [position[0] + epsilon, position[1] + epsilon],
      };
      const lengthMeters = data.getFloat64();
      const trail = new Trail(id, name, type, bound, trailWays, position, lengthMeters);
      this.bounds.insert(trail, bound);
      this.trails.set(id, trail);
    }
  }

  private unloadCell(id: S2CellNumber): void {
    const buffer = this.byCells.get(id);
    this.byCells.delete(id);
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
        this.bounds.delete(entity, entity.bound);
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
        this.bounds.delete(entity, entity.bound);
        this.trails.delete(id);
      }
    }
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

function metersToMiles(meters: number): number {
  return meters * 0.00062137119224;
}
