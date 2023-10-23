import { Long, S2CellId, S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive } from 'js/common/asserts';
import { Debouncer } from 'js/common/debouncer';
import { FetchThrottler } from 'js/common/fetch_throttler';
import { LittleEndianView } from 'js/common/little_endian_view';

import { S2CellToken } from '../common/types';

interface InitializeRequest {
  kind: 'ir';
  covering: string;
  indexBottom: number;
  snap: number|undefined;
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

  private readonly covering: Set<string>;
  private readonly culler: Debouncer;
  private readonly inFlight: Map<S2CellToken, AbortController>;
  private readonly loaded: Set<S2CellToken>;
  private readonly throttler: FetchThrottler;
  private lastViewport: Viewport;

  constructor(
      coveringUrl: string,
      private readonly indexBottom: number,
      private readonly snap: number|undefined,
      private readonly url: string,
      private readonly postMessage: (command: Command, transfer?: Transferable[]) => void,
  ) {
    this.covering = new Set();
    this.culler = new Debouncer(100 /* ms */, () => {
      this.cull();
    });
    this.inFlight = new Map();
    this.loaded = new Set();
    this.throttler = new FetchThrottler();
    this.lastViewport = {
      lat: [1, -1],
      lng: [1, -1],
      zoom: 31,
    };

    fetch(coveringUrl, {mode: 'cors'})
        .then(response => {
          if (response.ok) {
            return response.arrayBuffer();
          } else {
            throw new Error(`Failed to fetch covering from ${coveringUrl}`);
          }
        })
        .then(data => {
          const source = new LittleEndianView(data);
          const version = source.getVarInt32();
          if (version !== 1) {
            throw new Error("Unhandled version");
          }

          const coveringByteLength = source.getVarInt32();
          const coveringVersion = source.getVarInt32();
          if (coveringVersion === 1) {
            const coveringLength = source.getVarInt32();
            for (let i = 0; i < coveringLength; ++i) {
              this.covering.add(
                  new S2CellId(Long.fromBits(source.getInt32(), source.getInt32()))
                      .parentAtLevel(this.indexBottom)
                      .toToken());
            }
          } else {
            throw new Error(`Unhandled covering version ${coveringVersion}`);
          }

          // It's possible we got a viewport before this covering, so force an update just in case.
          this.updateViewport({
            kind: 'uvr',
            viewport: this.lastViewport,
          });
        });
  }

  updateViewport(request: UpdateViewportRequest): void {
    const viewport = request.viewport;
    this.lastViewport = viewport;

    if (this.covering.size === 0) {
      return;
    }

    const low = S2LatLng.fromRadians(viewport.lat[0], viewport.lng[0]);
    const high = S2LatLng.fromRadians(viewport.lat[1], viewport.lng[1]);
    const bounds = S2LatLngRect.fromPointPair(low, high);

    const used = new Set<S2CellToken>();
    const cells = SimpleS2.cover(bounds, this.indexBottom);
    for (let i = 0; i < cells.size(); ++i) {
      const cell = cells.getAtIndex(i);
      const token = cell.toToken() as S2CellToken;
      used.add(token);

      if (this.loaded.has(token) || this.inFlight.has(token)) {
        continue;
      }

      if (!this.covering.has(token)) {
        this.loaded.add(token);
        continue;
      }

      const abort = new AbortController();
      this.inFlight.set(token, abort);

      const url =
          this.snap
              ? `${this.url}/${token}?bottom=${this.indexBottom}&snap=${this.snap}`
              : `${this.url}/${token}?bottom=${this.indexBottom}`;
      this.throttler.fetch(url, { mode: 'cors', signal: abort.signal })
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
            this.culler.trigger();
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
  }

  private cull(): void {
    const viewport = this.lastViewport;
    const low = S2LatLng.fromRadians(viewport.lat[0], viewport.lng[0]);
    const high = S2LatLng.fromRadians(viewport.lat[1], viewport.lng[1]);
    const bounds = S2LatLngRect.fromPointPair(low, high);

    const used = new Set<S2CellToken>();
    const cells = SimpleS2.cover(bounds, this.indexBottom);
    for (let i = 0; i < cells.size(); ++i) {
      const cell = cells.getAtIndex(i);
      const token = cell.toToken() as S2CellToken;
      used.add(token);
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

async function start(ir: InitializeRequest) {
  const fetcher =
      new S2DataFetcher(
          ir.covering,
          ir.indexBottom,
          ir.snap,
          ir.url,
          (self as any).postMessage.bind(self));
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
