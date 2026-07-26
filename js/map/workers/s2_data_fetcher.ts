import { Long, S2CellId } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';
import { FetchThrottler } from 'external/dev_april_corgi+/js/common/fetch_throttler';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';

import { S2CellToken } from '../common/types';

// How hard the server may simplify geometry at a given zoom, as the S2 level whose cell diagonal is
// about the error we accept. Undefined is full detail.
export interface Snap {
  minZoom: number;
  snap: number|undefined;
}

// One slice of a collection. A stream carries the objects whose own cell sits in [fromLevel,
// toLevel], which are the objects about the size of those cells, and tiles them at indexBottom.
// Streams split the levels between them so no object is in two of them and no two tiles ever draw
// the same object.
export interface Stream {
  minZoom: number;
  indexBottom: number;
  fromLevel: number;
  toLevel: number|undefined;
}

export type CellKey = string & {brand: 'CellKey'};

export function cellKey(stream: number, token: S2CellToken): CellKey {
  return `${stream}/${token}` as CellKey;
}

interface InitializeRequest {
  kind: 'ir';
  covering: string;
  snaps: Snap[];
  streams: Stream[];
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
  key: CellKey;
  data: ArrayBuffer;
}

export interface UnloadCellsCommand {
  kind: 'ucc';
  keys: CellKey[];
}

export interface UpdateStateCommand {
  kind: 'usc';
  fetching: boolean;
}

export type Command = LoadCellCommand|UnloadCellsCommand|UpdateStateCommand;

interface WantedCell {
  key: CellKey;
  token: S2CellToken;
  stream: Stream;
}

// One past S2's deepest level, so an unsnapped cell outranks every snap level.
const FULL_DETAIL = 31;

// Zoom of the viewport we start with, which is no viewport at all.
const UNSET_ZOOM = 31;

class S2DataFetcher {

  // Cells the collection has objects in, at the levels the server built the covering at.
  private readonly covering: Set<S2CellToken>;
  // The covering reduced to a given level, so that a cell can be tested against it by token.
  private readonly coveringByLevel: Map<number, Set<S2CellToken>>;
  private coveringBottom: number;
  private readonly culler: Debouncer;
  // The snap level each cell we hold was fetched at, or FULL_DETAIL if it was never snapped.
  private readonly held: Map<CellKey, number>;
  private readonly inFlight: Map<CellKey, AbortController>;
  private readonly refresher: Debouncer;
  private readonly snaps: Snap[];
  private readonly streams: Stream[];
  private readonly throttler: FetchThrottler;
  // Cells the viewport wants, so that culling doesn't have to work the covering out again.
  private active: Set<CellKey>;
  private lastViewport: Viewport;

  constructor(
      coveringUrl: string,
      snaps: Snap[],
      streams: Stream[],
      private readonly url: string,
      private readonly postMessage: (command: Command, transfer?: Transferable[]) => void,
  ) {
    this.covering = new Set();
    this.coveringByLevel = new Map();
    this.coveringBottom = 0;
    this.culler = new Debouncer(100 /* ms */, () => {
      this.cull();
    });
    this.held = new Map();
    this.inFlight = new Map();
    this.refresher = new Debouncer(100 /* ms */, () => {
      this.refresh();
    });
    this.snaps = [...snaps].sort((a, b) => a.minZoom - b.minZoom);
    this.streams = streams;
    this.throttler = new FetchThrottler();
    this.active = new Set();
    this.lastViewport = {
      lat: [1, -1],
      lng: [1, -1],
      zoom: UNSET_ZOOM,
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
              const cell = new S2CellId(Long.fromBits(source.getInt32(), source.getInt32()));
              this.covering.add(cell.toToken() as S2CellToken);
              this.coveringBottom = Math.max(this.coveringBottom, cell.level());
            }
          } else {
            throw new Error(`Unhandled covering version ${coveringVersion}`);
          }

          // It's possible we got a viewport before this covering
          this.refresh();
        });
  }

  updateViewport(request: UpdateViewportRequest): void {
    this.lastViewport = request.viewport;
    this.refresh();
  }

  private refresh(): void {
    const viewport = this.lastViewport;
    if (this.covering.size === 0 || viewport.zoom === UNSET_ZOOM) {
      return;
    }

    const snap = this.snapFor(viewport.zoom);
    this.active = new Set();
    for (const {key, token, stream} of this.wanted(viewport.zoom)) {
      this.active.add(key);

      // A request already running holds this cell's slot even if it will land coarser than we want.
      // Waiting for it and upgrading afterwards paints something sooner than starting over.
      if ((this.held.get(key) ?? -1) >= (snap ?? FULL_DETAIL) || this.inFlight.has(key)) {
        continue;
      }

      this.fetch(key, stream, token, snap);
    }

    for (const [key, abort] of this.inFlight) {
      if (!this.active.has(key)) {
        abort.abort();
        this.inFlight.delete(key);
      }
    }

    this.postMessage({
      kind: 'usc',
      fetching: this.inFlight.size > 0,
    });
  }

  private fetch(key: CellKey, stream: Stream, token: S2CellToken, snap: number|undefined): void {
    const abort = new AbortController();
    this.inFlight.set(key, abort);

    const query = [`bottom=${stream.indexBottom}`];
    if (snap !== undefined) {
      query.push(`snap=${snap}`);
    }
    if (stream.fromLevel > 0) {
      query.push(`minLevel=${stream.fromLevel}`);
    }
    if (stream.toLevel !== undefined) {
      query.push(`maxLevel=${stream.toLevel}`);
    }

    this.throttler
        .fetch(`${this.url}/${token}?${query.join('&')}`, {mode: 'cors', signal: abort.signal})
        .then(response => {
          if (response.ok) {
            return response.arrayBuffer();
          } else {
            throw new Error(`Failed to download ${token} for ${this.url}`);
          }
        })
        .then(data => {
          this.held.set(key, snap ?? FULL_DETAIL);
          this.postMessage({
            kind: 'lcc',
            key,
            data,
          }, [data]);
          this.culler.trigger();
        })
        .catch(e => {
          if (e.name === 'AbortError') {
            return;
          }

          // A cell we can't download counts as done, or else we ask for it again every time a
          // sibling lands. Panning away and back retries it.
          this.held.set(key, FULL_DETAIL);
          throw e;
        })
        .finally(() => {
          this.inFlight.delete(key);

          if (this.inFlight.size === 0) {
            this.postMessage({
              kind: 'usc',
              fetching: false,
            });
          }

          // The cell may want a finer snap than what just landed.
          this.refresher.trigger();
        });
  }

  private cull(): void {
    const unload = [];
    for (const key of this.held.keys()) {
      if (!this.active.has(key)) {
        this.held.delete(key);
        unload.push(key);
      }
    }

    if (unload.length > 0) {
      this.postMessage({
        kind: 'ucc',
        keys: unload,
      });
    }
  }

  // Every cell the viewport needs, across every stream the zoom has reached. A cover runs from the
  // face cells down to the tiling bottom. The deepest cells reach every object below them, so every
  // stream wants those, but a shallower cell only matches objects assigned to that exact cell, so
  // it belongs to whichever stream carries its level.
  private wanted(zoom: number): WantedCell[] {
    const viewport = this.lastViewport;
    const wanted = [];
    for (const [id, stream] of this.streams.entries()) {
      if (stream.minZoom > zoom) {
        continue;
      }

      const cells =
          SimpleS2.cover(
              viewport.lat[0],
              viewport.lat[1],
              viewport.lng[0],
              viewport.lng[1],
              stream.indexBottom);
      for (let i = 0; i < cells.size(); ++i) {
        const cell = cells.getAtIndex(i);
        const level = cell.level();
        if (level < stream.indexBottom && level < stream.fromLevel) {
          continue;
        }
        if (!this.mayHaveData(cell, stream.indexBottom)) {
          continue;
        }

        const token = cell.toToken() as S2CellToken;
        wanted.push({key: cellKey(id, token), token, stream});
      }
    }
    return wanted;
  }

  private snapFor(zoom: number): number|undefined {
    let best = this.snaps[0];
    for (const candidate of this.snaps) {
      if (candidate.minZoom > zoom) {
        break;
      }
      best = candidate;
    }
    return best.snap;
  }

  // The covering holds the cell each object was assigned to, capped at the level the server built
  // it at, so it can only rule out a request that asks about that level or above. It also says
  // nothing about which stream an object lands in, so a stream that carries only the big ones still
  // asks for cells that hold nothing but small ones.
  private mayHaveData(cell: S2CellId, indexBottom: number): boolean {
    const level = cell.level();
    if (level > this.coveringBottom) {
      return this.covering.has(cell.parentAtLevel(this.coveringBottom).toToken() as S2CellToken);
    } else if (level < indexBottom) {
      // Above the tiling bottom the server matches an object's cell exactly.
      return this.covering.has(cell.toToken() as S2CellToken);
    } else {
      return this.coveringAtLevel(level).has(cell.toToken() as S2CellToken);
    }
  }

  private coveringAtLevel(level: number): Set<S2CellToken> {
    const cached = this.coveringByLevel.get(level);
    if (cached) {
      return cached;
    }

    const reduced = new Set<S2CellToken>();
    for (const token of this.covering) {
      const cell = S2CellId.fromToken(token);
      if (cell.level() >= level) {
        reduced.add(cell.parentAtLevel(level).toToken() as S2CellToken);
      }
    }
    this.coveringByLevel.set(level, reduced);
    return reduced;
  }
}

async function start(ir: InitializeRequest) {
  const fetcher =
      new S2DataFetcher(
          ir.covering,
          ir.snaps,
          ir.streams,
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
