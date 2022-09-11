
import { checkExhaustive } from 'js/common/asserts';
import { EmptyDeps } from 'js/corgi/deps';
import { Service, ServiceResponse } from 'js/corgi/service';

import { IdentitySetMultiMap } from '../common/collections';
import { LittleEndianView } from '../common/little_endian_view';
import { degreesE7ToLatLng, projectLatLng } from '../common/math';
import { LatLng, LatLngRect, PixelRect, S2CellNumber, Vec2 } from '../common/types';
import { Path, Trail } from '../models/types';
import { PIN_CELL_ID } from '../workers/data_constants';
import { FetcherCommand, Viewport } from '../workers/data_fetcher';

interface Filter {
  boundary?: number;
}

interface Listener {
  loadMetadata(trails: Iterable<Trail>): void;
  loadDetail(paths: Iterable<Path>, trails: Iterable<Trail>): void;
  unloadDetail(paths: Iterable<Path>, trails: Iterable<Trail>): void;
  unloadMetadata(trails: Iterable<Trail>): void;
}

const DATA_ZOOM_THRESHOLD = 4;
const TEXT_DECODER = new TextDecoder();

export class MapDataService extends Service<EmptyDeps> {

  private readonly fetcher: Worker;
  private listener: Listener|undefined;
  private viewport: Viewport;
  // When a pin is set but the trail isn't loaded, we need to fetch the trail from the server
  // directly. These promises resolve on that load.
  private readonly pinnedMissingTrails: Map<bigint, {
    resolve: (trail: Trail) => void;
    reject: (v?: unknown) => void;
  }>;
  // We load metadata when loading detail cells, so we need to track which trails have been loaded
  // into details to avoid telling listeners to load them from the metadata into details and then
  // to load them again when we fetch details.
  // There are similar problems with metadata.
  private readonly trailsInDetails: Set<Trail>;
  private readonly trailsInMetadata: Set<Trail>;

  readonly metadataCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  readonly detailCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  readonly paths: Map<bigint, Path>;
  readonly pathsToTrails: IdentitySetMultiMap<bigint, Trail>;
  readonly trails: Map<bigint, Trail>;

  constructor(response: ServiceResponse<EmptyDeps>) {
    super(response);
    this.fetcher = new Worker('/static/data_fetcher_worker.js');
    this.viewport = {
      lat: [0, 0],
      lng: [0, 0],
      zoom: 31,
    };
    this.pinnedMissingTrails = new Map();
    this.trailsInDetails = new Set();
    this.trailsInMetadata = new Set();

    this.metadataCells = new Map();
    this.detailCells = new Map();
    this.paths = new Map();
    this.pathsToTrails = new IdentitySetMultiMap();
    this.trails = new Map();

    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.type === 'lcm') {
        this.loadMetadata(command.cell, command.data);
      } else if (command.type === 'lcd') {
        this.loadDetail(command.cell, command.data);
      } else if (command.type == 'ucc') {
        for (const cell of command.cells) {
          this.unloadDetailCell(cell);
          this.unloadMetadataCell(cell);
        }
      } else {
        checkExhaustive(command, 'Unknown type of command');
      }
    };
  }

  setListener(listener: Listener, filter?: Filter): void {
    this.listener = listener;
    this.fetcher.postMessage({
      kind: 'sfr',
      ...filter,
    });

    this.listener.loadMetadata(this.trailsInMetadata);
    this.listener.loadDetail(this.paths.values(), this.trailsInDetails);
  }

  clearPins(): void {
    this.fetcher.postMessage({
      kind: 'spr',
    });

    for (const {reject} of this.pinnedMissingTrails.values()) {
      reject();
    }
    this.pinnedMissingTrails.clear();
  }

  setPins({trail}: {trail: bigint}): Promise<Trail> {
    this.fetcher.postMessage({
      kind: 'spr',
      trail,
    });

    for (const {reject} of this.pinnedMissingTrails.values()) {
      reject();
    }
    this.pinnedMissingTrails.clear();

    const existing = this.trails.get(trail);
    if (existing && this.trailsInDetails.has(existing)) {
      return Promise.resolve(existing);
    } else {
      return new Promise((resolve, reject) => {
        this.pinnedMissingTrails.set(trail, {
          resolve,
          reject,
        });
      });
    }
  }

  clearListener(): void {
    this.listener = undefined;
  }

  getTrail(id: bigint): Trail|undefined {
    return this.trails.get(id);
  }

  listTrailsOnPath(path: Path): Trail[] {
    return this.pathsToTrails.get(path.id) ?? [];
  }

  updateViewport(viewport: Viewport): void {
    this.viewport = viewport;
    if (viewport.zoom < DATA_ZOOM_THRESHOLD) {
      return;
    }

    this.fetcher.postMessage({
      kind: 'uvr',
      viewport,
    });
  }

  private loadMetadata(id: S2CellNumber, buffer: ArrayBuffer): void {
    // Check if the server wrote us a 1 byte response with 0 trails and paths.
    if (buffer.byteLength <= 8) {
      this.metadataCells.set(id, undefined);
      return;
    }

    const data = new LittleEndianView(buffer);

    const trailCount = data.getInt32();
    const trails = [];
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getBigInt64();
      const nameLength = data.getInt32();
      const name = TEXT_DECODER.decode(data.sliceInt8(nameLength));
      const type = data.getInt32();
      const marker = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const lengthMeters = data.getFloat64();
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
                [],
                {low: [0, 0], high: [0, 0]} as LatLngRect,
                marker,
                lengthMeters);
        this.trails.set(id, trail);
      }
      this.trailsInMetadata.add(trail);
      trails.push(trail);
    }

    this.metadataCells.set(id, buffer);
    this.listener?.loadMetadata(trails);
  }

  private loadDetail(id: S2CellNumber, buffer: ArrayBuffer): void {
    // Check if the server wrote us a 1 byte response with 0 trails and paths.
    if (buffer.byteLength <= 8) {
      this.detailCells.set(id, undefined);
      return;
    }

    if (id === PIN_CELL_ID) {
      this.loadPinnedDetail(buffer);
    } else {
      this.loadRegularDetail(id, buffer);
    }

    // It's possible that we load the pinned data from a detail cell before the pin cell returns,
    // so let's just do it here just for fun.
    for (const [trailId, {resolve}] of this.pinnedMissingTrails) {
      const trail = this.trails.get(trailId);
      if (trail && this.trailsInDetails.has(trail)) {
        resolve(trail);
        this.pinnedMissingTrails.delete(trailId);
      }
    }
  }

  private loadPinnedDetail(buffer: ArrayBuffer): void {
    // Interesting choice: we don't load the pin cell. The complication we're avoiding is the case
    // where we have the cell containing a path/trail and that path/trail in the pin cell at the
    // same time. Determining how to unload data in the paths/trails map is complicated. The main
    // problem with skipping this is that we could render things but they wouldn't be
    // interactive, As it turns out, our usecase is to always render pinned paths regardless of zoom
    // level. We can therefore just only render pinned paths and skip trails, and we sacrafice
    // interactivity for them. This also allows us to downsample packed path geometry without visual
    // artifacting (because when the user is zoomed in they will load the real paths spatially.)
    //
    // The exception is that we do fill in existing data.
    //
    // The other exception is that we will resolve pinned promises so we can pass bounds. Ew.
    this.detailCells.set(PIN_CELL_ID, buffer);

    const data = new LittleEndianView(buffer);
    const pathCount = data.getInt32();
    for (let i = 0; i < pathCount; ++i) {
      data.skip(8 + 4);
      const pathVertexBytes = data.getInt32();
      data.align(4);
      data.skip(pathVertexBytes);
    }

    const trailCount = data.getInt32();
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getBigInt64();
      const nameLength = data.getInt32();
      const name = TEXT_DECODER.decode(data.sliceInt8(nameLength));
      const type = data.getInt32();
      const pathCount = data.getInt32();
      data.align(8);
      const paths = [...data.sliceBigInt64(pathCount)];
      const boundLow = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const boundHigh = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const bound = {low: boundLow, high: boundHigh, brand: 'LatLngRect'} as const;
      const marker = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const lengthMeters = data.getFloat64();
      const existing = this.trails.get(id);
      let trail;
      if (existing) {
        if (existing.paths.length === 0) {
          existing.paths.push(...paths);
        }
        existing.bound = bound;
        trail = existing;
      } else {
        trail = constructTrail(id, name, type, paths, bound, marker, lengthMeters);
      }

      // If we don't do this here, then when the user loads the page zoomed out detail will never
      // load and then we will never do this elsewhere.
      const missing = this.pinnedMissingTrails.get(id);
      if (missing) {
        missing.resolve(trail);
        this.pinnedMissingTrails.delete(id);
      }
    }
  }

  private loadRegularDetail(id: S2CellNumber, buffer: ArrayBuffer): void {
    const data = new LittleEndianView(buffer);

    const pathCount = data.getInt32();
    const paths = [];
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getBigInt64();
      const type = data.getInt32();
      const pathVertexBytes = data.getInt32();
      const pathVertexCount = pathVertexBytes / 8;
      data.align(4);
      const points = data.sliceFloat32(pathVertexCount * 2);
      const bound = {
        low: [1, 1],
        high: [-1, -1],
      } as PixelRect;
      for (let i = 0; i < pathVertexCount; ++i) {
        const x = points[i * 2 + 0];
        const y = points[i * 2 + 1];
        bound.low[0] = Math.min(bound.low[0], x);
        bound.low[1] = Math.min(bound.low[1], y);
        bound.high[0] = Math.max(bound.high[0], x);
        bound.high[1] = Math.max(bound.high[1], y);
      }
      const built = new Path(id, type, bound, points);
      this.paths.set(id, built);
      paths.push(built);
    }

    const trailCount = data.getInt32();
    const trails = [];
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getBigInt64();
      const nameLength = data.getInt32();
      const name = TEXT_DECODER.decode(data.sliceInt8(nameLength));
      const type = data.getInt32();
      const pathCount = data.getInt32();
      data.align(8);
      const paths = [...data.sliceBigInt64(pathCount)];
      const boundLow = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const boundHigh = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const bound = {low: boundLow, high: boundHigh, brand: 'LatLngRect'} as const;
      const marker = degreesE7ToLatLng(data.getInt32(), data.getInt32());
      const lengthMeters = data.getFloat64();
      const existing = this.trails.get(id);
      let trail;
      if (existing) {
        trail = existing;
        if (trail.paths.length === 0) {
          trail.paths.push(...paths);
        }
        trail.bound = bound;
      } else {
        trail = constructTrail(id, name, type, paths, bound, marker, lengthMeters);
        this.trails.set(id, trail);
      }
      this.trailsInDetails.add(trail);
      trails.push(trail);
      for (const path of paths) {
        this.pathsToTrails.put(path & ~1n, trail);
      }
    }

    this.detailCells.set(id, buffer);
    this.listener?.loadDetail(paths, trails);
  }

  private unloadDetailCell(id: S2CellNumber): void {
    const buffer = this.detailCells.get(id);
    this.detailCells.delete(id);

    if (!buffer || id === PIN_CELL_ID) {
      return;
    }

    const data = new LittleEndianView(buffer);

    const pathCount = data.getInt32();
    const paths = [];
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getBigInt64();
      data.skip(4);
      const pathVertexBytes = data.getInt32();
      data.align(4);
      data.skip(pathVertexBytes);
      const entity = this.paths.get(id);
      if (entity) {
        this.paths.delete(id);
        paths.push(entity);
      }
    }

    const trailCount = data.getInt32();
    const trails = [];
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getBigInt64();
      const nameLength = data.getInt32();
      data.skip(nameLength + 4);
      const pathCount = data.getInt32();
      data.align(8);
      data.skip(pathCount * 8 + 4 * 4 + 2 * 4 + 8);

      const entity = this.trails.get(id);
      if (entity) {
        for (const path of entity.paths) {
          this.pathsToTrails.delete(path, entity);
        }
        this.trailsInDetails.delete(entity);
        trails.push(entity);
      }
    }

    this.listener?.unloadDetail(paths, trails);
  }

  private unloadMetadataCell(id: S2CellNumber): void {
    const buffer = this.metadataCells.get(id);
    this.metadataCells.delete(id);

    if (!buffer || id === PIN_CELL_ID) {
      return;
    }

    const data = new LittleEndianView(buffer);

    const trailCount = data.getInt32();
    const trails = [];
    for (let i = 0; i < trailCount; ++i) {
      const id = data.getBigInt64();
      const nameLength = data.getInt32();
      data.skip(nameLength + 4 + 2 * 4 + 8);

      const entity = this.trails.get(id);
      if (entity) {
        for (const path of entity.paths) {
          this.pathsToTrails.delete(path, entity);
        }
        this.trails.delete(id);
        this.trailsInMetadata.delete(entity);
        trails.push(entity);
      }
    }

    this.listener?.unloadMetadata(trails);
  }
}

function constructTrail(
    id: bigint,
    name: string,
    type: number,
    paths: bigint[],
    bound: LatLngRect,
    marker: LatLng,
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
      name,
      type,
      mouseBound,
      paths,
      bound,
      marker,
      markerPx,
      lengthMeters);
}

