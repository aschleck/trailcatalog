import { S2CellId, S2LatLng, S2LatLngRect } from '../../s2';
import { SimpleS2 } from '../../s2/SimpleS2';
import { reinterpretLong } from '../models/math';
import { S2CellNumber } from '../models/types';

import { FetchThrottler } from './fetch_throttler';

export interface UpdateViewportRequest {
  lat: [number, number];
  lng: [number, number];
}

export interface LoadCellCommand {
  type: 'lcc';
  cell: S2CellNumber;
  data: ArrayBuffer;
}

export interface UnloadCellsCommand {
  type: 'ucc';
  cells: S2CellNumber[];
}

export type FetcherCommand = LoadCellCommand|UnloadCellsCommand;

class DataFetcher {

  private readonly cells: Map<S2CellNumber, ArrayBuffer>;
  private readonly inFlight: Map<S2CellNumber, AbortController>;
  private readonly throttler: FetchThrottler;

  constructor(
      private readonly mail:
          (response: FetcherCommand, transfer: Transferable[]) => void) {
    this.cells = new Map();
    this.inFlight = new Map();
    this.throttler = new FetchThrottler();
  }

  updateViewport(bounds: S2LatLngRect): void {
    const cellsInArrayList = SimpleS2.cover(bounds);
    const used = new Set();
    for (let i = 0; i < cellsInArrayList.size(); ++i) {
      const cell = cellsInArrayList.getAtIndex(i);
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      used.add(id);

      if (this.cells.has(id) || this.inFlight.has(id)) {
        continue;
      }

      const token = cell.toToken();
      const abort = new AbortController();
      this.inFlight.set(id, abort);
      this.throttler.fetch(`/api/fetch_cell/${token}`, { signal: abort.signal })
          .then(response => {
            if (response.ok) {
              return response.arrayBuffer();
            } else {
              throw new Error(`Failed to download ${token}`);
            }
          })
          .then(data => {
            this.cells.set(id, data);
            this.mail({
              type: 'lcc',
              cell: id,
              data,
            }, [data]);
          })
          .catch(e => {
            if (e.name !== 'AbortError') {
              throw e;
            }
          })
          .finally(() => {
            this.inFlight.delete(id);
          });
    }

    for (const [id, abort] of this.inFlight) {
      if (!used.has(id)) {
        abort.abort();
        this.inFlight.delete(id);
      }
    }

    const unload = [];
    for (const id of this.cells.keys()) {
      if (!used.has(id)) {
        this.cells.delete(id);
        unload.push(id);
      }
    }

    if (unload.length > 0) {
      this.mail({
        type: 'ucc',
        cells: unload,
      }, []);
    }
  }
}

const fetcher = new DataFetcher((self as any).postMessage.bind(self));
self.onmessage = e => {
  const request = e.data as UpdateViewportRequest;
  const low = S2LatLng.fromRadians(request.lat[0], request.lng[0]);
  const high = S2LatLng.fromRadians(request.lat[1], request.lng[1]);
  const bounds = S2LatLngRect.fromPointPair(low, high);
  fetcher.updateViewport(bounds);
};
