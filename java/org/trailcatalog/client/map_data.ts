import { S2CellId, S2LatLngRect } from '../s2';
import { FetcherCommand } from './workers/fetcher';

import { BoundsQuadtree, worldBounds } from './bounds_quadtree';
import { Layer } from './layer';
import { LittleEndianView } from './little_endian_view';
import { RenderPlanner } from './render_planner';
import { PixelRect, reinterpretLong, Vec2 } from './support';

type S2CellNumber = number & {brand: 'S2CellNumber'};

interface Entity {
  readonly id: bigint;
  readonly line?: Float64Array;
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
  ) {}
}

const TEXT_DECODER = new TextDecoder();

export class MapData implements Layer {

  private readonly bounds: BoundsQuadtree<Entity>;
  private readonly byCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  private readonly entities: Map<bigint, Entity>;
  private readonly fetcher: Worker;
  private lastChange: number;

  constructor() {
    this.bounds = worldBounds();
    this.byCells = new Map();
    this.entities = new Map();
    this.fetcher = new Worker('static/fetcher_worker.js');
    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.type === 'lcc') {
        this.loadCell(command.cell, command.data);
      }
    };
    this.lastChange = Date.now();
  }

  // TODO: where is the part where we unload anything

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  query(point: Vec2, radius: number): void {
    const near: Entity[] = [];
    this.bounds.query(point, radius, near);

    let best = undefined;
    let bestDistance2 = radius * radius;
    for (const entity of near) {
      const line = entity.line;
      if (!line) {
        continue;
      }

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
          best = entity;
          bestDistance2 = d2;
        }
      }
    }

    console.log(best);
    console.log(bestDistance2);
  }

  viewportBoundsChanged(bounds: S2LatLngRect): void {
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
      const wayRoutes = [...new BigInt64Array(data.slice(wayRouteCount * 8))];

      const wayVertexBytes = data.getInt32();
      const wayVertexCount = wayVertexBytes / 16;
      const points = new Float64Array(data.slice(wayVertexBytes));
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
      const name = TEXT_DECODER.decode(data.slice(nameLength));
      const type = data.getInt32();
      const routeWayCount = data.getInt32();
      const routeWays = [...new BigInt64Array(data.slice(routeWayCount * 8))];
      const route = new Route(id, name, type, routeWays);
      this.entities.set(id, route);
    }
  }

  plan(cells: S2CellId[], planner: RenderPlanner): void {
    const calls = [];
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
        calls.push(data.slice(wayVertexBytes));
      }
    }
    planner.addLines(calls);
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

