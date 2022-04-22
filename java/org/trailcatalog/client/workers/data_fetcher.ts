import { S2CellId, S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

import { reinterpretLong } from '../common/math';
import { S2CellNumber } from '../common/types';

import { FetchThrottler } from './fetch_throttler';

export interface UpdateViewportRequest {
  lat: [number, number];
  lng: [number, number];
  zoom: number;
}

export interface LoadCellDetailCommand {
  type: 'lcd';
  cell: S2CellNumber;
  data: ArrayBuffer;
}

export interface LoadCellMetadataCommand {
  type: 'lcm';
  cell: S2CellNumber;
  data: ArrayBuffer;
}

export interface UnloadCellsCommand {
  type: 'ucc';
  cells: S2CellNumber[];
}

export type FetcherCommand = LoadCellDetailCommand|LoadCellMetadataCommand|UnloadCellsCommand;

export const DETAIL_ZOOM_THRESHOLD = 11.5;

class DataFetcher {

  private readonly metadata: Set<S2CellNumber>;
  private readonly metadataInFlight: Map<S2CellNumber, AbortController>;
  private readonly detail: Set<S2CellNumber>;
  private readonly detailInFlight: Map<S2CellNumber, AbortController>;
  private readonly throttler: FetchThrottler;

  constructor(
      private readonly mail:
          (response: FetcherCommand, transfer: Transferable[]) => void) {
    this.metadata = new Set();
    this.metadataInFlight = new Map();
    this.detail = new Set();
    this.detailInFlight = new Map();
    this.throttler = new FetchThrottler();
  }

  updateViewport(bounds: S2LatLngRect, zoom: number): void {
    const used = new Set();

    const metadataCellsInBound = SimpleS2.cover(bounds, SimpleS2.HIGHEST_METADATA_INDEX_LEVEL);
    for (let i = 0; i < metadataCellsInBound.size(); ++i) {
      const cell = metadataCellsInBound.getAtIndex(i);
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      used.add(id);

      if (this.metadata.has(id) || this.metadataInFlight.has(id)) {
        continue;
      }

      const token = cell.toToken();
      const abort = new AbortController();
      this.metadataInFlight.set(id, abort);

      this.throttler.fetch(`/api/fetch_metadata/${token}`, { signal: abort.signal })
          .then(response => {
            if (response.ok) {
              return response.arrayBuffer();
            } else {
              throw new Error(`Failed to download metadata for ${token}`);
            }
          })
          .then(data => {
            this.metadata.add(id);
            this.mail({
              type: 'lcm',
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
            this.metadataInFlight.delete(id);
          });
    }

    if (zoom >= DETAIL_ZOOM_THRESHOLD) {
      const detailCellsInBound = SimpleS2.cover(bounds, SimpleS2.HIGHEST_DETAIL_INDEX_LEVEL);
      for (let i = 0; i < detailCellsInBound.size(); ++i) {
        const cell = detailCellsInBound.getAtIndex(i);
        const id = reinterpretLong(cell.id()) as S2CellNumber;
        used.add(id);

        if (this.detail.has(id) || this.detailInFlight.has(id)) {
          continue;
        }

        const token = cell.toToken();
        const abort = new AbortController();
        this.detailInFlight.set(id, abort);

        this.throttler.fetch(`/api/fetch_detail/${token}`, { signal: abort.signal })
            .then(response => {
              if (response.ok) {
                return response.arrayBuffer();
              } else {
                throw new Error(`Failed to download detail for ${token}`);
              }
            })
            .then(data => {
              this.detail.add(id);
              this.mail({
                type: 'lcd',
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
              this.detailInFlight.delete(id);
            });
      }
    }

    for (const [id, abort] of this.metadataInFlight) {
      if (!used.has(id)) {
        abort.abort();
        this.metadataInFlight.delete(id);
      }
    }

    for (const [id, abort] of this.detailInFlight) {
      if (!used.has(id)) {
        abort.abort();
        this.detailInFlight.delete(id);
      }
    }

		// Rough approximation: only consider unloading if zoomed in.
		if (zoom < DETAIL_ZOOM_THRESHOLD) {
			return;
		}

    const unload = [];
    for (const id of this.detail) {
      if (!used.has(id)) {
        this.metadata.delete(id);
        this.detail.delete(id);
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
  fetcher.updateViewport(bounds, request.zoom);
};
