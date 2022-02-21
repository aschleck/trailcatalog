import { S2CellId } from 'java/org/trailcatalog/s2';

import { BoundsQuadtree, worldBounds } from './bounds_quadtree';
import { Layer } from './layer';
import { RenderPlanner } from './render_planner';
import { PixelRect, reinterpretLong } from './support';

type S2CellNumber = number & {brand: 'S2CellNumber'};

export class MapData implements Layer {

  private readonly bounds: BoundsQuadtree<bigint>;
  private readonly byCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  private readonly inFlight: Set<S2CellNumber>;
  private lastChange: number;

  constructor() {
    this.bounds = worldBounds();
    this.byCells = new Map();
    this.inFlight = new Set();
    this.lastChange = Date.now();
  }

  // TODO: where is the part where we unload anything

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  fetchCells(cells: S2CellId[]): void {
    for (const cell of cells) {
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      if (this.inFlight.has(id) || this.byCells.has(id)) {
        continue;
      }

      this.inFlight.add(id);
      const token = cell.toToken();
      fetch(`/api/fetch_cell/${token}`)
          .then(response => {
            if (response.ok) {
              return response.arrayBuffer();
            } else {
              throw new Error(`Failed to download ${token}`);
            }
          })
          .then(buffer => {
            // Check if the server wrote us a 1 byte response with 0 ways.
            if (buffer.byteLength > 1) {
              this.byCells.set(id, buffer);
              this.loadMetadata(buffer);
              this.lastChange = Date.now();
            } else {
              this.byCells.set(id, undefined);
            }
          })
          .finally(() => {
            this.inFlight.delete(id);
          });
    }
  }

  private loadMetadata(buffer: ArrayBuffer): void {
    const data = new DataView(buffer);

    const wayCount = data.getInt32(0, /* littleEndian= */ true);
    if (wayCount === 0) {
      return;
    }

    const WAY_OFFSET = 4;
    const WAY_STRIDE = 8 + 4 + 4;
    let vertexOffset = WAY_OFFSET + wayCount * WAY_STRIDE;
    for (let i = 0; i < wayCount; ++i) {
      const id = data.getBigInt64(i * WAY_STRIDE + WAY_OFFSET + 0, /* littleEndian= */ true);
      const wayVertexBytes =
          data.getInt32(i * WAY_STRIDE + WAY_OFFSET + 12, /* littleEndian= */ true);
      const wayVertexCount = wayVertexBytes / 16;

      const points =
          new Float64Array(buffer.slice(vertexOffset, vertexOffset + wayVertexBytes));
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
      this.bounds.insert(id, bound);
      vertexOffset += wayVertexBytes;
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

      const data = new DataView(buffer);

      const wayCount = data.getInt32(0, /* littleEndian= */ true);
      if (wayCount === 0) {
        continue;
      }

      const WAY_OFFSET = 4;
      const WAY_STRIDE = 8 + 4 + 4;
      let vertexOffset = WAY_OFFSET + wayCount * WAY_STRIDE;
      for (let i = 0; i < wayCount; ++i) {
        const id = data.getBigInt64(i * WAY_STRIDE + WAY_OFFSET + 0, /* littleEndian= */ true);
        const type = data.getInt32(i * WAY_STRIDE + WAY_OFFSET + 8, /* littleEndian= */ true);
        const wayVertexBytes =
            data.getInt32(i * WAY_STRIDE + WAY_OFFSET + 12, /* littleEndian= */ true);
        const wayVertexCount = wayVertexBytes / 16;

        calls.push(buffer.slice(vertexOffset, vertexOffset + wayVertexBytes));
        vertexOffset += wayVertexBytes;
      }
    }
    planner.addLines(calls);
  }
}

