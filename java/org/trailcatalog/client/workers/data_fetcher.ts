import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive } from 'js/common/asserts';

import { reinterpretLong } from '../common/math';
import { S2CellNumber } from '../common/types';

import { COARSE_ZOOM_THRESHOLD, FINE_ZOOM_THRESHOLD, PIN_CELL_ID } from './data_constants';
import { FetchThrottler } from './fetch_throttler';

export interface SetPinsRequest {
  kind: 'spr';
  precise: boolean;
  trail?: bigint;
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

type Request = SetPinsRequest|UpdateViewportRequest;

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

export interface UnloadCellsCommand {
  type: 'ucc';
  cells: S2CellNumber[];
}

export type FetcherCommand =
    LoadCellCoarseCommand
        |LoadCellFineCommand
        |LoadCellOverviewCommand
        |UnloadCellsCommand;

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

  flush(): void {
    this.mail({
      type: 'ucc',
      cells: [...this.overview, ...this.coarse, ...this.fine],
    }, []);
    this.overview.clear();
    this.overviewInFlight.clear();
    this.coarse.clear();
    this.coarseInFlight.clear();
    this.fine.clear();
    this.fineInFlight.clear();
  }

  setPins(pins: SetPinsRequest): void {
    const id = PIN_CELL_ID;
    const inFlight = this.overviewInFlight.get(id);
    if (inFlight) {
      inFlight.abort();
    }

    if (!pins.trail) {
      this.overviewInFlight.delete(id);
      this.mail({
        type: 'ucc',
        cells: [id],
      }, []);
      return;
    }

    const abort = new AbortController();
    this.overviewInFlight.set(id, abort);
    this.throttler.fetch(`/api/data-packed`, {
      method: 'POST',
      signal: abort.signal,
      body: JSON.stringify({
        precise: pins.precise,
        trail_id: pins.trail,
      }, (k, v) => typeof v === 'bigint' ? String(v) : v),
    }).then(response => {
      if (response.ok) {
        return response.arrayBuffer();
      } else {
        throw new Error("Failed to download pin data");
      }
    })
    .then(data => {
      this.overviewInFlight.delete(id);
      this.mail({
        type: 'ucc',
        cells: [id],
      }, []);
      // TODO(april): weird we use overview for InFlight but then send this as coarse
      this.mail({
        type: 'lcc',
        cell: id,
        data,
      }, [data]);
    });
  }

  updateViewport(bounds: S2LatLngRect, zoom: number): void {
    const used = new Set([PIN_CELL_ID]); // never cancel our pin request

    const overviewCellsInBound = SimpleS2.cover(bounds, SimpleS2.HIGHEST_OVERVIEW_INDEX_LEVEL);
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

      const detailCellsInBound = SimpleS2.cover(bounds, depth);
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

    // Rough approximation: only consider unloading if zoomed in.
    if (zoom < COARSE_ZOOM_THRESHOLD) {
      return;
    }

    const unload = [];
    for (const id of this.coarse) {
      if (!used.has(id)) {
        this.overview.delete(id);
        this.coarse.delete(id);
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
  const request = e.data as Request;
  if (request.kind === 'spr') {
    fetcher.setPins(request);
  } else if (request.kind === 'uvr') {
    const viewport = request.viewport;
    const low = S2LatLng.fromRadians(viewport.lat[0], viewport.lng[0]);
    const high = S2LatLng.fromRadians(viewport.lat[1], viewport.lng[1]);
    const bounds = S2LatLngRect.fromPointPair(low, high);
    fetcher.updateViewport(bounds, viewport.zoom);
  } else {
    checkExhaustive(request);
  }
};

