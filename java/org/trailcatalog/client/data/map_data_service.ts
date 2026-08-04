import * as arrays from 'external/dev_april_corgi+/js/common/arrays';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { IdentitySetMultiMap } from 'external/dev_april_corgi+/js/common/collections';
import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';
import { Future, asFuture } from 'external/dev_april_corgi+/js/common/futures';
import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { Service, ServiceResponse } from 'external/dev_april_corgi+/js/corgi/service';
import { projectE7Deltas, skipE7Deltas } from 'js/map/camera';
import { LatLng, LatLngRect } from 'js/map/common/types';

import { degreesE7ToLatLng, projectLatLng, reinterpretBigInt } from '../common/math';
import { PixelRect, S2CellNumber } from '../common/types';
import { Path, Point, Trail } from '../models/types';
import { FetcherCommand, Viewport } from '../workers/data_fetcher';

export interface Listener {
  loadOverviewCell(id: S2CellNumber, trails: Iterable<Trail>): void;
  loadCoarseCell(id: S2CellNumber, paths: Iterable<Path>): void;
  loadFineCell(id: S2CellNumber, paths: Iterable<Path>, points: Iterable<Point>): void;
  loadPinned(): void;
  unloadCoarseCell(id: S2CellNumber, paths: Iterable<Path>): void;
  unloadFineCell(id: S2CellNumber, paths: Iterable<Path>, points: Iterable<Point>): void;
  unloadOverviewCell(id: S2CellNumber, trails: Iterable<Trail>): void;
}

const DATA_ZOOM_THRESHOLD = 4;
const EPSILON = 1e-9;
const TEXT_DECODER = new TextDecoder();

export class PinReference extends Disposable {

  constructor(
      readonly trail: Future<Trail>,
      readonly resolve: (trail: Trail) => void) {
    super();
  }
}

interface PinnedTrail {
  paths: Path[];
  references: PinReference[];
  trail: Trail|undefined;
}

export class MapDataService extends Service<EmptyDeps> {

  private readonly fetcher: Worker;
  private readonly pins: Map<bigint, PinnedTrail>;
  private listener: Listener|undefined;

  // A note on the different ArrayBuffers:
  // * overview cells basically only contain trails and go up to cell level 5
  // * coarse cells contain paths attached to trails, and go up to cell level 10
  // * fine cells contain all paths, and go up to cell level 10
  //
  // So when rendering, we always render overview cells. Above a certain zoom we render EITHER
  // coarse or fine.
  readonly overviewCells: Map<S2CellNumber, ArrayBuffer|false>;
  readonly coarseCells: Map<S2CellNumber, ArrayBuffer|false>;
  readonly fineCells: Map<S2CellNumber, ArrayBuffer|false>;
  readonly coarsePaths: Map<bigint, Path>;
  readonly finePaths: Map<bigint, Path>;
  readonly pinnedPaths: Map<bigint, Path>;
  readonly pathsToTrails: IdentitySetMultiMap<bigint, Trail>;
  readonly points: Map<bigint, Point>;
  readonly trails: Map<bigint, Trail>;

  constructor(response: ServiceResponse<EmptyDeps>) {
    super(response);
    this.fetcher = new Worker('/static/data_fetcher_worker.js');
    this.pins = new Map();

    this.overviewCells = new Map();
    this.coarseCells = new Map();
    this.fineCells = new Map();
    this.coarsePaths = new Map();
    this.finePaths = new Map();
    this.pinnedPaths = new Map();
    this.pathsToTrails = new IdentitySetMultiMap();
    this.points = new Map();
    this.trails = new Map();

    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.type === 'ftr') {
        this.loadPinnedTrail(command.trail, command.data);
      } else if (command.type === 'lco') {
        this.loadOverviewCell(command.cell, command.data);
      } else if (command.type === 'lcc') {
        this.loadCoarseCell(command.cell, command.data);
      } else if (command.type === 'lcf') {
        this.loadFineCell(command.cell, command.data);
      } else if (command.type == 'ucc') {
        for (const cell of command.cells) {
          if (command.index === 'coarse') {
            this.unloadCoarseCell(cell);
          } else if (command.index === 'fine') {
            this.unloadFineCell(cell);
          } else if (command.index === 'overview') {
            this.unloadOverviewCell(cell);
          } else {
            checkExhaustive(command.index);
          }
        }
      } else {
        checkExhaustive(command, 'Unknown type of command');
      }
    };
  }

  setListener(listener: Listener): void {
    this.listener = listener;

    for (const [id, buffer] of this.overviewCells) {
      if (!buffer) {
        continue;
      }

      const data = new LittleEndianView(buffer);

      const trailCount = data.getVarInt32();
      const trails = [];
      for (let i = 0; i < trailCount; ++i) {
        const id = data.getVarBigInt64();
        const nameLength = data.getVarInt32();
        data.skip(nameLength);
        data.getVarInt32();
        const pathCount = data.getVarInt32();
        data.align(8);
        data.skip(8 * pathCount);
        data.skip(5 * 4);
        const trail = this.trails.get(id);
        if (trail) {
          trails.push(trail);
        }
      }

      listener.loadOverviewCell(id, trails);
    }

    for (const [id, buffer] of this.coarseCells) {
      if (!buffer) {
        continue;
      }

      // Coarse buffers are grouped: a single buffer holds multiple cells and is
      // stored in coarseCells under each group's id. Reparse the groups and
      // replay only the one matching this entry's id (others have their own
      // entries, and a partially unloaded buffer may no longer contain all).
      const data = new LittleEndianView(buffer);
      const groupCount = data.getVarInt32();
      for (let group = 0; group < groupCount; ++group) {
        const groupId = reinterpretBigInt(data.getBigInt64()) as S2CellNumber;
        const pathCount = data.getVarInt32();
        const paths = [];
        for (let i = 0; i < pathCount; ++i) {
          const id = data.getVarBigInt64();
          data.getVarInt32();
          skipE7Deltas(data);
          const path = this.coarsePaths.get(id);
          if (path) {
            paths.push(path);
          }
        }
        if (groupId === id) {
          listener.loadCoarseCell(id, paths);
        }
      }
    }

    for (const [id, buffer] of this.fineCells) {
      if (!buffer) {
        continue;
      }
      const data = new LittleEndianView(buffer);
      const pathCount = data.getVarInt32();
      const paths = [];
      for (let i = 0; i < pathCount; ++i) {
        const id = data.getVarBigInt64();
        data.getVarInt32();
        skipE7Deltas(data);
        const path = this.finePaths.get(id);
        if (path) {
          paths.push(path);
        }
      }
      const pointCount = data.getVarInt32();
      const points = [];
      for (let i = 0; i < pointCount; ++i) {
        const id = data.getVarBigInt64();
        data.getVarInt32();
        const nameLength = data.getVarInt32();
        data.skip(nameLength + 2 * 4);
        const point = this.points.get(id);
        if (point) {
          points.push(point);
        }
      }
      listener.loadFineCell(id, paths, points);
    }

    if (this.pinnedPaths.size > 0) {
      listener.loadPinned();
    }
  }

  addPin({trail}: {trail: bigint}): PinReference {
    let resolve: (trail: Trail) => void = () => {};
    const loaded = asFuture(new Promise<Trail>(r => { resolve = r; }));
    const reference = new PinReference(loaded, resolve);
    reference.registerDisposer(() => {
      const pin = this.pins.get(trail);
      if (!pin) {
        return;
      }
      const index = pin.references.indexOf(reference);
      if (index >= 0) {
        pin.references.splice(index, 1);
      }
      if (pin.references.length === 0) {
        this.pins.delete(trail);
        this.repackPinnedPaths();
        this.listener?.loadPinned();
      }
    });

    const existing = this.pins.get(trail);
    if (existing) {
      existing.references.push(reference);
      if (existing.trail) {
        resolve(existing.trail);
      }
    } else {
      this.pins.set(trail, {
        paths: [],
        references: [reference],
        trail: undefined,
      });
      this.fetcher.postMessage({
        kind: 'ftr',
        trail,
      });
    }
    return reference;
  }

  clearListener(): void {
    this.listener = undefined;
  }

  getPath(id: bigint): Path|undefined {
    return this.finePaths.get(id) ?? this.coarsePaths.get(id);
  }

  getPoint(id: bigint): Point|undefined {
    return this.points.get(id);
  }

  getTrail(id: bigint): Trail|undefined {
    return this.trails.get(id);
  }

  listTrailsOnPath(path: Path): Trail[] {
    return this.pathsToTrails.get(path.id) ?? [];
  }

  updateViewport(viewport: Viewport): void {
    if (viewport.zoom < DATA_ZOOM_THRESHOLD) {
      return;
    }

    this.fetcher.postMessage({
      kind: 'uvr',
      viewport,
    });
  }

  private loadOverviewCell(id: S2CellNumber, buffer: ArrayBuffer): void {
    // Check if the server wrote us a 1 byte response with 0 trails and paths.
    if (buffer.byteLength <= 8) {
      this.overviewCells.set(id, false);
      return;
    }

    const data = new LittleEndianView(buffer);

    const trailCount = data.getVarInt32();
    const trails = [];
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getVarBigInt64();
      const nameLength = data.getVarInt32();
      const name = TEXT_DECODER.decode(data.sliceInt8(nameLength));
      const type = data.getVarInt32();
      const pathCount = data.getVarInt32();
      data.align(8);
      const paths = [...data.sliceBigInt64(pathCount)];
      const marker = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const elevationDownMeters = data.getFloat32();
      const elevationUpMeters = data.getFloat32();
      const lengthMeters = data.getFloat32();
      const existing = this.trails.get(id);
      let trail;
      if (existing) {
        trail = existing;
      } else {
        trail =
            constructTrail(
                id,
                name,
                type,
                paths,
                {low: [0, 0], high: [0, 0]} as const as LatLngRect,
                marker,
                elevationDownMeters,
                elevationUpMeters,
                lengthMeters);
        this.trails.set(id, trail);
        for (const path of paths) {
          this.pathsToTrails.put(path & ~1n, trail);
        }
      }
      trails.push(trail);
    }

    this.overviewCells.set(id, buffer);
    this.listener?.loadOverviewCell(id, trails);
  }

  private loadCoarseCell(id: S2CellNumber, buffer: ArrayBuffer): void {
    // Check if the server wrote us a short response with 0 trails and paths.
    if (buffer.byteLength <= 8) {
      this.coarseCells.set(id, false);
      return;
    }

    this.loadRegularCoarse(buffer);
  }

  private loadPinnedTrail(trail: bigint, buffer: ArrayBuffer): void {
    const pin = this.pins.get(trail);
    if (!pin) {
      return;
    }

    // Interesting choice: we don't load the pin cells. The complication we're avoiding is the case
    // where we have the cell containing a path/trail and that path/trail in the pin cell at the
    // same time. Determining how to unload data in the paths/trails map is complicated. So we take
    // the paths and skip the trails, which costs us the path to trail mapping: a click on a pinned
    // path resolves to its trail only where an overview cell has already claimed the path.
    //
    // The exception is that we do fill in existing data.
    //
    // The other exception is that we will resolve pinned promises so we can pass bounds. Ew.

    const data = new LittleEndianView(buffer);
    const pathCount = data.getVarInt32();
    pin.paths.length = 0;
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getVarBigInt64();
      const type = data.getVarInt32();
      const points = projectE7Deltas(data);
      // A rect per path because we hit test against it and the quadtrees delete by its identity.
      const bound = {
        low: [1, 1],
        high: [-1, -1],
      };
      for (let j = 0; j < points.length; j += 2) {
        const x = points[j + 0];
        const y = points[j + 1];
        bound.low[0] = Math.min(bound.low[0], x);
        bound.low[1] = Math.min(bound.low[1], y);
        bound.high[0] = Math.max(bound.high[0], x);
        bound.high[1] = Math.max(bound.high[1], y);
      }
      pin.paths.push(new Path(id, type, bound as unknown as PixelRect, points));
    }
    this.repackPinnedPaths();

    const trailCount = data.getVarInt32();
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getVarBigInt64();
      const nameLength = data.getVarInt32();
      const name = TEXT_DECODER.decode(data.sliceInt8(nameLength));
      const type = data.getVarInt32();
      const pathCount = data.getVarInt32();
      data.align(8);
      const paths = [...data.sliceBigInt64(pathCount)];
      const boundLow = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const boundHigh = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const bound = {low: boundLow, high: boundHigh, brand: 'LatLngRect'} as const;
      const marker = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const elevationDownMeters = data.getFloat32();
      const elevationUpMeters = data.getFloat32();
      const lengthMeters = data.getFloat32();
      const existing = this.trails.get(id);
      let trail;
      if (existing) {
        if (existing.paths.length === 0) {
          arrays.pushInto(existing.paths, paths);
        }
        existing.bound = bound;
        trail = existing;
      } else {
        trail =
            constructTrail(
                id,
                name,
                type,
                paths,
                bound,
                marker,
                elevationDownMeters,
                elevationUpMeters,
                lengthMeters);
      }

      // This is *crazy* we just assume the server only gives us one trail back despite the format
      // allowing multiple trails.
      pin.trail = trail;
      for (const reference of pin.references) {
        reference.resolve(trail);
      }
    }

    this.listener?.loadPinned();
  }

  // Two pinned trails can share a path, so a dropped pin can't just delete the paths it named.
  private repackPinnedPaths(): void {
    this.pinnedPaths.clear();
    for (const pin of this.pins.values()) {
      for (const path of pin.paths) {
        this.pinnedPaths.set(path.id, path);
      }
    }
  }

  private loadRegularCoarse(buffer: ArrayBuffer): void {
    const data = new LittleEndianView(buffer);

    const groupCount = data.getVarInt32();
    for (let group = 0; group < groupCount; ++group) {
      const id = reinterpretBigInt(data.getBigInt64()) as S2CellNumber;

      const pathCount = data.getVarInt32();
      const paths = [];
      for (let i = 0; i < pathCount; ++i) {
        const id = data.getVarBigInt64();
        const type = data.getVarInt32();
        const points = projectE7Deltas(data);
        const bound = {
          low: [1, 1],
          high: [-1, -1],
        };
        for (let i = 0; i < points.length; i += 2) {
          const x = points[i + 0];
          const y = points[i + 1];
          bound.low[0] = Math.min(bound.low[0], x);
          bound.low[1] = Math.min(bound.low[1], y);
          bound.high[0] = Math.max(bound.high[0], x);
          bound.high[1] = Math.max(bound.high[1], y);
        }
        const built = new Path(id, type, bound as unknown as PixelRect, points);
        this.coarsePaths.set(id, built);
        paths.push(built);
      }

      this.coarseCells.set(id, buffer);
      this.listener?.loadCoarseCell(id, paths);
    }
  }

  private loadFineCell(id: S2CellNumber, buffer: ArrayBuffer): void {
    // Check if the server wrote us a 1 byte response with 0 trails and paths.
    if (buffer.byteLength <= 8) {
      this.fineCells.set(id, false);
      return;
    }

    const data = new LittleEndianView(buffer);

    const pathCount = data.getVarInt32();
    const paths = [];
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getVarBigInt64();
      const type = data.getVarInt32();
      const points = projectE7Deltas(data);
      const bound = {
        low: [1, 1],
        high: [-1, -1],
      };
      for (let i = 0; i < points.length; i += 2) {
        const x = points[i + 0];
        const y = points[i + 1];
        bound.low[0] = Math.min(bound.low[0], x);
        bound.low[1] = Math.min(bound.low[1], y);
        bound.high[0] = Math.max(bound.high[0], x);
        bound.high[1] = Math.max(bound.high[1], y);
      }
      const built = new Path(id, type, bound as unknown as PixelRect, points);
      this.finePaths.set(id, built);
      paths.push(built);
    }

    const pointCount = data.getVarInt32();
    const points = [];
    for (let i = 0; i < pointCount; ++i) {
      const id = data.getVarBigInt64();
      const type = data.getVarInt32();
      const nameLength = data.getVarInt32();
      let name;
      if (nameLength > 0) {
        name = TEXT_DECODER.decode(data.sliceInt8(nameLength));
      } else {
        name = undefined;
      }
      const marker = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const markerPx = projectLatLng(marker);
      const bound = {
        low: [markerPx[0] - EPSILON, markerPx[1] - EPSILON],
        high: [markerPx[0] + EPSILON, markerPx[1] + EPSILON],
      } as const as PixelRect;
      const built = new Point(id, type, name, markerPx, bound);
      this.points.set(id, built);
      points.push(built);
    }

    this.fineCells.set(id, buffer);
    this.listener?.loadFineCell(id, paths, points);
  }

  private unloadCoarseCell(id: S2CellNumber): void {
    const buffer = this.coarseCells.get(id);
    this.coarseCells.delete(id);

    if (!buffer) {
      return;
    }

    const data = new LittleEndianView(buffer);

    // Coarse buffers hold multiple groups; only unload the one matching id.
    const groupCount = data.getVarInt32();
    for (let group = 0; group < groupCount; ++group) {
      const groupId = reinterpretBigInt(data.getBigInt64()) as S2CellNumber;
      const pathCount = data.getVarInt32();
      const paths = [];
      for (let i = 0; i < pathCount; ++i) {
        const pathId = data.getVarBigInt64();
        data.getVarInt32();
        skipE7Deltas(data);
        const entity = this.coarsePaths.get(pathId);
        if (entity) {
          this.coarsePaths.delete(pathId);
          paths.push(entity);
        }
      }
      if (groupId === id) {
        this.listener?.unloadCoarseCell(id, paths);
      }
    }
  }

  private unloadFineCell(id: S2CellNumber): void {
    const buffer = this.fineCells.get(id);
    this.fineCells.delete(id);

    if (!buffer) {
      return;
    }

    const data = new LittleEndianView(buffer);

    const pathCount = data.getVarInt32();
    const paths = [];
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getVarBigInt64();
      data.getVarInt32();
      skipE7Deltas(data);
      const entity = this.finePaths.get(id);
      if (entity) {
        this.finePaths.delete(id);
        paths.push(entity);
      }
    }

    const pointCount = data.getVarInt32();
    const points = [];
    for (let i = 0; i < pointCount; ++i) {
      const id = data.getVarBigInt64();
      data.getVarInt32();
      const nameLength = data.getVarInt32();
      data.skip(nameLength + 2 * 4);
      const point = this.points.get(id);
      if (point) {
        this.points.delete(id);
        points.push(point);
      }
    }

    this.listener?.unloadFineCell(id, paths, points);
  }

  private unloadOverviewCell(id: S2CellNumber): void {
    const buffer = this.overviewCells.get(id);
    this.overviewCells.delete(id);

    if (!buffer) {
      return;
    }

    const data = new LittleEndianView(buffer);

    const trailCount = data.getVarInt32();
    const trails = [];
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getVarBigInt64();
      const nameLength = data.getVarInt32();
      data.skip(nameLength);
      data.getVarInt32();
      const pathCount = data.getVarInt32();
      data.align(8);
      data.skip(8 * pathCount + 2 * 4 + 2 * 4 + 4);

      const entity = this.trails.get(id);
      if (entity) {
        for (const path of entity.paths) {
          this.pathsToTrails.delete(path, entity);
        }
        this.trails.delete(id);
        trails.push(entity);
      }
    }

    this.listener?.unloadOverviewCell(id, trails);
  }
}

function constructTrail(
    id: bigint,
    name: string,
    type: number,
    paths: bigint[],
    bound: LatLngRect,
    marker: LatLng,
    elevationDownMeters: number,
    elevationUpMeters: number,
    lengthMeters: number): Trail {
  // We really struggle bounds checking trails, but on the plus side we
  // calculate a radius on click queries. So as long as our query radius
  // includes this point we can do fine-grained checks to determine what is
  // *actually* being clicked.
  const epsilon = 1e-5;
  const markerPx = projectLatLng(marker);
  const mouseBound = {
    low: [markerPx[0] - epsilon, markerPx[1] - epsilon],
    high: [markerPx[0] + epsilon, markerPx[1] + epsilon],
    brand: 'PixelRect' as const,
  } as PixelRect;
  return new Trail(
      id,
      /* readable_id= */ undefined,
      name,
      type,
      mouseBound,
      paths,
      bound,
      marker,
      markerPx,
      elevationDownMeters,
      elevationUpMeters,
      lengthMeters);
}

