import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { FetchThrottler } from 'external/dev_april_corgi+/js/common/fetch_throttler';

import { reinterpretLong } from '../common/math';
import { S2CellNumber } from '../common/types';

import { COARSE_ZOOM_THRESHOLD, FINE_ZOOM_THRESHOLD } from './data_constants';

export interface FetchTrailRequest {
  kind: 'ftr';
  trail: bigint;
}

export interface UpdateViewportRequest {
  kind: 'uvr';
  viewport: Viewport;
}

export interface Viewport {
  lat: [number, number];
  lng: [number, number];
  zoom: number;
}

type Request = FetchTrailRequest|UpdateViewportRequest;

export interface FetchTrailResponse {
  type: 'ftr';
  trail: bigint;
  data: ArrayBuffer;
}

export interface LoadCellCoarseCommand {
  type: 'lcc';
  cell: S2CellNumber;
  data: ArrayBuffer;
}

export interface LoadCellFineCommand {
  type: 'lcf';
  cell: S2CellNumber;
  data: ArrayBuffer;
}

export interface LoadCellOverviewCommand {
  type: 'lco';
  cell: S2CellNumber;
  data: ArrayBuffer;
}

// Which index the cells belong to. A coarse cell and a fine cell can carry the same id, so
// without this the client can't tell which of the two to unload.
export type CellIndex = 'coarse'|'fine'|'overview';

export interface UnloadCellsCommand {
  type: 'ucc';
  index: CellIndex;
  cells: S2CellNumber[];
}

export type FetcherCommand =
  | FetchTrailResponse
  | LoadCellCoarseCommand
  | LoadCellFineCommand
  | LoadCellOverviewCommand
  | UnloadCellsCommand;

class DataFetcher {

  private readonly overview: Set<S2CellNumber>;
  private readonly overviewInFlight: Map<S2CellNumber, AbortController>;
  private readonly coarse: Set<S2CellNumber>;
  private readonly coarseInFlight: Map<S2CellNumber, AbortController>;
  private readonly fine: Set<S2CellNumber>;
  private readonly fineInFlight: Map<S2CellNumber, AbortController>;
  private readonly throttler: FetchThrottler;

  constructor(
      private readonly mail:
          (response: FetcherCommand, transfer: Transferable[]) => void) {
    this.overview = new Set();
    this.overviewInFlight = new Map();
    this.coarse = new Set();
    this.coarseInFlight = new Map();
    this.fine = new Set();
    this.fineInFlight = new Map();
    this.throttler = new FetchThrottler();
  }

  fetchTrail(request: FetchTrailRequest): void {
    const abort = new AbortController();
    this.throttler.fetch(`/api/data-packed`, {
      method: 'POST',
      signal: abort.signal,
      body: JSON.stringify({
        precise: true,
        trail_id: request.trail,
      }, (k, v) => typeof v === 'bigint' ? String(v) : v),
    }).then(response => {
      if (response.ok) {
        return response.arrayBuffer();
      } else {
        throw new Error("Failed to download pin data");
      }
    })
    .then(data => {
      this.mail({
        type: 'ftr',
        trail: request.trail,
        data,
      }, [data]);
    });
  }

  updateViewport(viewport: Viewport): void {
    const zoom = viewport.zoom;
    const used = new Set<S2CellNumber>();

    const overviewCellsInBound =
        SimpleS2.cover(
            viewport.lat[0], viewport.lat[1], viewport.lng[0], viewport.lng[1],
            SimpleS2.HIGHEST_OVERVIEW_INDEX_LEVEL);
    for (let i = 0; i < overviewCellsInBound.size(); ++i) {
      const cell = overviewCellsInBound.getAtIndex(i);
      const id = reinterpretLong(cell.id()) as S2CellNumber;
      used.add(id);

      if (this.overview.has(id) || this.overviewInFlight.has(id)) {
        continue;
      }

      const token = cell.toToken();
      const abort = new AbortController();
      this.overviewInFlight.set(id, abort);

      this.throttler.fetch(`/api/fetch-overview/${token}`, { signal: abort.signal })
          .then(response => {
            if (response.ok) {
              return response.arrayBuffer();
            } else {
              throw new Error(`Failed to download overview for ${token}`);
            }
          })
          .then(data => {
            this.overview.add(id);
            this.mail({
              type: 'lco',
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
            this.overviewInFlight.delete(id);
          });
    }

    if (zoom >= COARSE_ZOOM_THRESHOLD) {
      let command: 'lcc'|'lcf';
      let depth: number;
      let endpoint: string;
      let destination: Set<S2CellNumber>;
      let inFlight: Map<S2CellNumber, AbortController>;
      let outOfFlight: Map<S2CellNumber, AbortController>;
      if (zoom >= FINE_ZOOM_THRESHOLD) {
        command = 'lcf';
        depth = SimpleS2.HIGHEST_FINE_INDEX_LEVEL;
        endpoint = 'fetch-fine';
        destination = this.fine;
        inFlight = this.fineInFlight;
        outOfFlight = this.coarseInFlight;
      } else {
        command = 'lcc';
        depth = SimpleS2.HIGHEST_COARSE_INDEX_LEVEL;
        endpoint = 'fetch-coarse';
        destination = this.coarse;
        inFlight = this.coarseInFlight;
        outOfFlight = this.fineInFlight;
      }

      outOfFlight.forEach(a => { a.abort() });
      outOfFlight.clear();

      const detailCellsInBound =
          SimpleS2.cover(
              viewport.lat[0], viewport.lat[1], viewport.lng[0], viewport.lng[1], depth);
      for (let i = 0; i < detailCellsInBound.size(); ++i) {
        const cell = detailCellsInBound.getAtIndex(i);
        const id = reinterpretLong(cell.id()) as S2CellNumber;
        used.add(id);

        if (destination.has(id) || inFlight.has(id)) {
          continue;
        }

        const token = cell.toToken();
        const abort = new AbortController();
        inFlight.set(id, abort);

        this.throttler.fetch(`/api/${endpoint}/${token}`, { signal: abort.signal })
            .then(response => {
              if (response.ok) {
                return response.arrayBuffer();
              } else {
                throw new Error(`Failed to download ${endpoint} for ${token}`);
              }
            })
            .then(data => {
              destination.add(id);
              this.mail({
                type: command,
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
              inFlight.delete(id);
            });
      }
    } else {
      this.coarseInFlight.forEach(a => { a.abort() });
      this.coarseInFlight.clear();
      this.fineInFlight.forEach(a => { a.abort() });
      this.fineInFlight.clear();
    }

    for (const [id, abort] of this.overviewInFlight) {
      if (!used.has(id)) {
        abort.abort();
        this.overviewInFlight.delete(id);
      }
    }

    this.unloadUnused('coarse', this.coarse, used);
    this.unloadUnused('fine', this.fine, used);
  }

  private unloadUnused(
      index: CellIndex, loaded: Set<S2CellNumber>, used: Set<S2CellNumber>): void {
    const cells = [];
    for (const id of loaded) {
      if (!used.has(id)) {
        loaded.delete(id);
        cells.push(id);
      }
    }

    if (cells.length > 0) {
      this.mail({
        type: 'ucc',
        index,
        cells,
      }, []);
    }
  }
}

const fetcher = new DataFetcher((self as any).postMessage.bind(self));
self.onmessage = e => {
  const request = e.data as Request;
  if (request.kind === 'ftr') {
    fetcher.fetchTrail(request);
  } else if (request.kind === 'uvr') {
    fetcher.updateViewport(request.viewport);
  } else {
    checkExhaustive(request);
  }
};

