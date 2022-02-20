import { S2CellId } from 'java/org/trailcatalog/s2';

type S2CellToken = string & {brand: 'S2CellToken'};

export class MapData {

  private byCells: Map<S2CellToken, ArrayBuffer>;
  private inFlight: Set<S2CellToken>;
  private lastChange: number;

  constructor() {
    this.byCells = new Map();
    this.inFlight = new Set();
    this.lastChange = Date.now();
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  fetchCells(cells: S2CellId[]): void {
    for (const cell of cells) {
      const token = cell.toToken() as S2CellToken;
      if (this.inFlight.has(token) || this.byCells.has(token)) {
        continue;
      }

      this.inFlight.add(token);
      fetch(`/api/fetch_cell/${token}`)
          .then(response => response.arrayBuffer())
          .then(buffer => {
            this.byCells.set(token, buffer);
            this.lastChange = Date.now();
          })
          .finally(() => {
            this.inFlight.delete(token);
          });
    }
  }

  plan(cells: S2CellId[]): Array<{
    splitVertices: ArrayBuffer;
  }> {
    const calls = [];
    for (const cell of cells) {
      const buffer = this.byCells.get(cell.toToken() as S2CellToken);
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

        calls.push({
          splitVertices: buffer.slice(vertexOffset, vertexOffset + wayVertexBytes),
        });
        vertexOffset += wayVertexBytes;
      }
    }
    return calls;
  }
}

