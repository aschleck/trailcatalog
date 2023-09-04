import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive } from 'js/common/asserts';
import { FetchThrottler } from 'js/common/fetch_throttler';

import { S2CellToken } from '../common/types';

interface InitializeRequest {
  kind: 'ir';
  url: string;
}

interface Viewport {
  lat: [number, number];
  lng: [number, number];
  zoom: number;
}

interface UpdateViewportRequest {
  kind: 'uvr';
  viewport: Viewport;
}

export type Request = InitializeRequest|UpdateViewportRequest;

export interface LoadCellCommand {
  kind: 'lcc';
  token: S2CellToken;
  data: ArrayBuffer;
}

export interface UnloadCellsCommand {
  kind: 'ucc';
  tokens: S2CellToken[];
}

export type Command = LoadCellCommand|UnloadCellsCommand;

class S2DataFetcher {

  private readonly inFlight: Map<S2CellToken, AbortController>;
  private readonly loaded: Set<S2CellToken>;
  private readonly throttler: FetchThrottler;

  constructor(
      private readonly url: string,
      private readonly postMessage: (command: Command, transfer?: Transferable[]) => void,
  ) {
    this.inFlight = new Map();
    this.loaded = new Set();
    this.throttler = new FetchThrottler();
  }

  updateViewport(request: UpdateViewportRequest) {
    const viewport = request.viewport;
    const low = S2LatLng.fromRadians(viewport.lat[0], viewport.lng[0]);
    const high = S2LatLng.fromRadians(viewport.lat[1], viewport.lng[1]);
    const bounds = S2LatLngRect.fromPointPair(low, high);

    const used = new Set<S2CellToken>();
    // TODO(april): make this a constant!
    // TRAILS_LAT_S2_INDEX_LEVEL
    const cells = SimpleS2.cover(bounds, 6);
    for (let i = 0; i < cells.size(); ++i) {
      const cell = cells.getAtIndex(i);
      const token = cell.toToken() as S2CellToken;
      used.add(token);

      if (this.loaded.has(token) || this.inFlight.has(token)) {
        continue;
      }

      const abort = new AbortController();
      this.inFlight.set(token, abort);

      this.throttler.fetch(
              `${this.url}/${token}`,
              { mode: 'cors', signal: abort.signal })
          .then(response => {
            if (response.ok) {
              return response.arrayBuffer();
            } else {
              throw new Error(`Failed to download ${token} for ${this.url}`);
            }
          })
          .then(data => {
            this.loaded.add(token);
            this.postMessage({
              kind: 'lcc',
              token,
              data,
            }, [data]);
          })
          .catch(e => {
            if (e.name !== 'AbortError') {
              throw e;
            }
          })
          .finally(() => {
            this.inFlight.delete(token);
          });
    }

    for (const [id, abort] of this.inFlight) {
      if (!used.has(id)) {
        abort.abort();
        this.inFlight.delete(id);
      }
    }

    const unload = [];
    for (const id of this.loaded) {
      if (!used.has(id)) {
        this.loaded.delete(id);
        unload.push(id);
      }
    }

    if (unload.length > 0) {
      this.postMessage({
        kind: 'ucc',
        tokens: unload,
      });
    }
  }
}

function start(ir: InitializeRequest) {
  const fetcher = new S2DataFetcher(ir.url, (self as any).postMessage.bind(self));
  self.onmessage = e => {
    const request = e.data as Request;
    if (request.kind === 'ir') {
      throw new Error('Already initialized');
    } else if (request.kind === 'uvr') {
      fetcher.updateViewport(request);
    } else {
      checkExhaustive(request);
    }
  };
}

self.onmessage = e => {
  const request = e.data as Request;
  if (request.kind !== 'ir') {
    throw new Error('Expected an initialization request');
  }

  start(request);
};
