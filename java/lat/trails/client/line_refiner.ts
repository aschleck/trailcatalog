import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';

import { MAX_LINES_BY_ID } from 'java/lat/trails/wire/wire';
import { projectE7Deltas } from 'js/map/camera';
import { RawUuid } from 'js/map/common/types';
import { LineRef } from 'js/map/workers/location_querier';

// A batch is one primary key lookup, so a request still open after this is stuck, not slow. It
// fails like any other, which lets a finished line save rather than wait on it forever.
const TIMEOUT_MS = 10_000;

// Holds the unsimplified geometry of the lines a drawing ran along, fetched by id from the
// collections that serve them.
//
// Nothing is evicted or invalidated. Only the OSM paths and the reference collections pass a
// source, and those change only on an import, after which old ids come back missing and drawings
// keep the simplified lines. A collection people edit would need its version in refKey.
export class LineRefiner {

  // Mercator, or null when the collection had no such line
  private readonly lines: Map<string, Float64Array|null>;
  private readonly inFlight: Map<string, Promise<void>>;
  // Lines whose last fetch failed, which count as settled so that a finish waiting on them goes
  // ahead, and which the next load asks for again
  private readonly failed: Set<string>;
  // Bumped whenever lines land, so that a cached refine knows to redo itself
  private _version: number;

  constructor() {
    this.lines = new Map();
    this.inFlight = new Map();
    this.failed = new Set();
    this._version = 0;
  }

  get version(): number {
    return this._version;
  }

  geometry(ref: LineRef): Float64Array|undefined {
    return this.lines.get(refKey(ref)) ?? undefined;
  }

  // Loaded or failed, either of which lets a finish waiting on the line go ahead
  settled(ref: LineRef): boolean {
    const key = refKey(ref);
    return this.lines.has(key) || this.failed.has(key);
  }

  /** Fetches whichever lines aren't held yet, resolving once every one has landed or failed. */
  load(refs: Iterable<LineRef>): Promise<void> {
    const waiting = new Set<Promise<void>>();
    const missing = new Map<string, Map<string, RawUuid>>();
    for (const ref of refs) {
      const key = refKey(ref);
      const pending = this.inFlight.get(key);
      if (pending) {
        waiting.add(pending);
      } else if (!this.lines.has(key)) {
        const ids = missing.get(ref.url) ?? new Map();
        ids.set(key, ref.id);
        missing.set(ref.url, ids);
      }
    }

    for (const [url, ids] of missing) {
      const keys = [...ids.keys()];
      for (let i = 0; i < keys.length; i += MAX_LINES_BY_ID) {
        const batch = keys.slice(i, i + MAX_LINES_BY_ID);
        const fetched = this.fetch(url, batch, batch.map(key => ids.get(key)!));
        for (const key of batch) {
          this.inFlight.set(key, fetched);
        }
        waiting.add(fetched);
      }
    }
    return Promise.all(waiting).then(() => {});
  }

  private fetch(url: string, keys: string[], ids: RawUuid[]): Promise<void> {
    return fetch(
            `${url}/lines?ids=${ids.map(uuidString).join(',')}`,
            {signal: AbortSignal.timeout(TIMEOUT_MS)})
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to fetch lines from ${url}`);
          }
          return response.arrayBuffer();
        })
        .then(data => {
          for (const {id, points} of decodeLines(data)) {
            this.lines.set(refKey({url, id}), points);
          }
          // The collection answered without these, so asking again won't help.
          for (const key of keys) {
            this.failed.delete(key);
            if (!this.lines.has(key)) {
              this.lines.set(key, null);
            }
          }
        })
        .catch(e => {
          console.error(e);
          for (const key of keys) {
            this.failed.add(key);
          }
        })
        .finally(() => {
          this._version += 1;
          for (const key of keys) {
            this.inFlight.delete(key);
          }
        });
  }
}

function refKey(ref: LineRef): string {
  return `${ref.url} ${ref.id.msb} ${ref.id.lsb}`;
}

function uuidString(id: RawUuid): string {
  const hex =
      BigInt.asUintN(64, id.msb).toString(16).padStart(16, '0')
          + BigInt.asUintN(64, id.lsb).toString(16).padStart(16, '0');
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20),
  ].join('-');
}

// count, then id_lsb,id_msb,lat_lng_degrees for each. Keep in sync with
// ApiServer.kt#writeLinesById.
function decodeLines(data: ArrayBuffer): Array<{id: RawUuid; points: Float64Array}> {
  const source = new LittleEndianView(data);
  const count = source.getVarInt32();
  const lines = [];
  for (let i = 0; i < count; ++i) {
    const lsb = source.getBigInt64();
    const msb = source.getBigInt64();
    lines.push({id: {lsb, msb}, points: projectE7Deltas(source)});
  }
  return lines;
}
