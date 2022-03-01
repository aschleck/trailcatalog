import { checkExhaustive, checkExists } from './models/asserts';
import { reinterpretLong } from './models/math';
import { PixelRect, S2CellNumber, Vec2, Vec4 } from './models/types';
import { S2CellId, S2LatLngRect } from '../s2';
import { SimpleS2 } from '../s2/SimpleS2';
import { FetcherCommand } from './workers/data_fetcher';

import { BoundsQuadtree, worldBounds } from './bounds_quadtree';
import { Camera } from './camera';
import { Layer } from './layer';
import { LittleEndianView } from './little_endian_view';
import { RenderPlanner } from './render_planner';
import { TextRenderer } from './text_renderer';

interface Entity {
  readonly id: bigint;
  readonly line?: Float64Array;
  readonly position?: Vec2;
}

class Highway implements Entity {
  constructor(
      readonly id: bigint,
      readonly type: number,
      readonly bound: PixelRect,
      readonly routes: bigint[],
      readonly line: Float64Array,
  ) {}
}

class Route implements Entity {
  constructor(
      readonly id: bigint,
      readonly name: string,
      readonly type: number,
      readonly highways: bigint[],
      readonly position: Vec2,
  ) {}
}

const TEXT_DECODER = new TextDecoder();

export class MapData implements Layer {

  private readonly bounds: BoundsQuadtree<Entity>;
  private readonly byCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  private readonly entities: Map<bigint, Entity>;
  private readonly fetcher: Worker;
  private readonly selected: Set<bigint>;
  private lastChange: number;

  constructor(
      private readonly camera: Camera,
      private readonly textRenderer: TextRenderer,
  ) {
    this.bounds = worldBounds();
    this.byCells = new Map();
    this.entities = new Map();
    this.fetcher = new Worker('static/data_fetcher_worker.js');
    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.type === 'lcc') {
        this.loadCell(command.cell, command.data);
      } else if (command.type == 'ucc') {
        // TODO: where is the part where we unload anything
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
      if (best instanceof Highway) {
        ids.push(best.id);
      } else if (best instanceof Route) {
        ids.push(...best.highways);
      }

      if (this.selected.has(ids[0])) {
        for (const id of ids) {
          this.selected.delete(id);
        }
      } else {
        for (const id of ids) {
          this.selected.add(id);
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

  private loadMetadata(buffer: ArrayBuffer): void {
    const data = new LittleEndianView(buffer);

    const wayCount = data.getInt32();
    for (let i = 0; i < wayCount; ++i) {
      const id = data.getBigInt64();
      const type = data.getInt32();
      const wayRouteCount = data.getInt32();
      const wayRoutes = [];
      for (let j = 0; j < wayRouteCount; ++j) {
        wayRoutes.push(data.getBigInt64());
      }

      const wayVertexBytes = data.getInt32();
      const wayVertexCount = wayVertexBytes / 16;
      data.align(8);
      const points = data.sliceFloat64(wayVertexCount * 2);
      const bound: PixelRect = {
        low: [1, 1],
        high: [-1, -1],
      };
      for (let i = 0; i < wayVertexCount; ++i) {
        const x = points[i * 2 + 0];
        const y = points[i * 2 + 1];
        bound.low[0] = Math.min(bound.low[0], x);
        bound.low[1] = Math.min(bound.low[1], y);
        bound.high[0] = Math.max(bound.high[0], x);
        bound.high[1] = Math.max(bound.high[1], y);
      }
      const built = new Highway(id, type, bound, wayRoutes, points);
      this.bounds.insert(built, bound);
      this.entities.set(id, built);
    }

    const routeCount = data.getInt32();
    for (let i = 0; i < routeCount; ++i) {
      const id = data.getBigInt64();
      const nameLength = data.getInt32();
      const name = TEXT_DECODER.decode(data.sliceInt8(nameLength));
      const type = data.getInt32();
      const routeWayCount = data.getInt32();
      data.align(8);
      const routeWays = [...data.sliceBigInt64(routeWayCount)];
      const position: Vec2 = [data.getFloat64(), data.getFloat64()];
      const route = new Route(id, name, type, routeWays, position);
      const epsilon = 1e-5; // we really struggle bounds checking routes
      this.bounds.insert(route, {
        low: [position[0] - epsilon, position[1] - epsilon],
        high: [position[0] + epsilon, position[1] + epsilon],
      });
      this.entities.set(id, route);
    }
  }

  plan(viewportSize: Vec2, planner: RenderPlanner): void {
    const cells = this.cellsInView(viewportSize);
    const calls = [];
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

      const wayCount = data.getInt32();
      for (let i = 0; i < wayCount; ++i) {
        const id = data.getBigInt64();
        const type = data.getInt32();
        const routes = data.getInt32();
        data.skip(routes * 8);
        const wayVertexBytes = data.getInt32();
        const wayVertexCount = wayVertexBytes / 16;
        data.align(8);
        calls.push({
          colorFill: this.selected.has(id) ? selectedFill : regularFill,
          colorStipple: stipple,
          vertices: data.sliceFloat64(wayVertexCount * 2),
        });
      }

      const routeCount = data.getInt32();
      for (let i = 0; i < routeCount; ++i) {
        const id = data.getBigInt64();
        const nameLength = data.getInt32();
        data.skip(nameLength);
        const type = data.getInt32();
        const routeWayCount = data.getInt32();
        data.align(8);
        data.skip(routeWayCount * 8 + 16);
        const route = checkExists(this.entities.get(id)) as Route;
        this.textRenderer.plan({
          text: route.name,
          fontSize: 18,
        }, route.position, planner);
      }
    }

    planner.addLines(calls);
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
    // Check if the server wrote us a 1 byte response with 0 routes and highways.
    if (buffer.byteLength > 8) {
      this.byCells.set(id, buffer);
      this.loadMetadata(buffer);
      this.lastChange = Date.now();
    } else {
      this.byCells.set(id, undefined);
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
