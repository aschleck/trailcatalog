
import { checkExhaustive } from 'js/common/asserts';
import { EmptyDeps } from 'js/corgi/deps';
import { Service, ServiceResponse } from 'js/corgi/service';

import { IdentitySetMultiMap } from '../common/collections';
import { LittleEndianView } from '../common/little_endian_view';
import { PixelRect, S2CellNumber, Vec2 } from '../common/types';
import { Path, Trail } from '../models/types';
import { FetcherCommand, Viewport } from '../workers/data_fetcher';

interface Filter {
  boundary?: number;
}

interface Listener {
  loadMetadata(paths: Iterable<Path>, trails: Iterable<Trail>): void;
  loadDetail(paths: Iterable<Path>, trails: Iterable<Trail>): void;
  unloadEverywhere(paths: Iterable<Path>, trails: Iterable<Trail>): void;
}

const DATA_ZOOM_THRESHOLD = 4;
const TEXT_DECODER = new TextDecoder();

export class MapDataService extends Service<EmptyDeps> {

  private readonly fetcher: Worker;
  private listener: Listener|undefined;
  private viewport: Viewport;
  // We load metadata when loading detail cells, so we need to track which trails have been loaded
  // into details to avoid telling listeners to load them from the metadata into details and then
  // to load them again when we fetch details.
  private readonly trailsInDetails: Set<Trail>;

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
    this.trailsInDetails = new Set();

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
          this.unloadCell(cell);
        }
      } else {
        checkExhaustive(command, 'Unknown type of command');
      }
    };
  }

  setListener(listener: Listener, filter?: Filter): void {
    this.listener = listener;
    this.fetcher.postMessage({
      ...filter,
      kind: 'sfr',
    });

    this.listener.loadMetadata([], this.trails.values());
    this.listener.loadDetail(this.paths.values(), this.trailsInDetails);
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
      this.detailCells.set(id, undefined);
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
      const position: Vec2 = [data.getFloat64(), data.getFloat64()];
      const lengthMeters = data.getFloat64();
      const existing = this.trails.get(id);
      let trail;
      if (existing) {
        trail = existing;
      } else {
        trail = constructTrail(id, name, type, [], position, lengthMeters);
        this.trails.set(id, trail);
      }
      trails.push(trail);
    }

    this.metadataCells.set(id, buffer);
    this.listener?.loadMetadata([], trails);
  }

  private loadDetail(id: S2CellNumber, buffer: ArrayBuffer): void {
    // Check if the server wrote us a 1 byte response with 0 trails and paths.
    if (buffer.byteLength <= 8) {
      this.detailCells.set(id, undefined);
      return;
    }

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
      const bound: PixelRect = {
        low: [1, 1],
        high: [-1, -1],
      };
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
      const position: Vec2 = [data.getFloat64(), data.getFloat64()];
      const lengthMeters = data.getFloat64();
      const existing = this.trails.get(id);
      let trail;
      if (existing) {
        trail = existing;
        if (trail.paths.length === 0) {
          trail.paths.push(...paths);
        }
      } else {
        trail = constructTrail(id, name, type, paths, position, lengthMeters);
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

  private unloadCell(id: S2CellNumber): void {
    const buffer = this.detailCells.get(id);
    this.metadataCells.delete(id);
    this.detailCells.delete(id);

    if (!buffer) {
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
      data.skip(pathCount * 8 + 16 + 8);

      const entity = this.trails.get(id);
      if (entity) {
        for (const path of entity.paths) {
          this.pathsToTrails.delete(path, entity);
        }
        this.trails.delete(id);
        this.trailsInDetails.delete(entity);
        trails.push(entity);
      }
    }

    this.listener?.unloadEverywhere(paths, trails);
  }
}

function constructTrail(
    id: bigint,
    name: string,
    type: number,
    paths: bigint[],
    position: Vec2,
    lengthMeters: number): Trail {
  // We really struggle bounds checking trails, but on the plus side we
  // calculate a radius on click queries. So as long as our query radius
  // includes this point we can do fine-grained checks to determine what is
  // *actually* being clicked.
  const epsilon = 1e-5;
  const bound: PixelRect = {
    low: [position[0] - epsilon, position[1] - epsilon],
    high: [position[0] + epsilon, position[1] + epsilon],
  };
  return new Trail(
      id,
      name,
      type,
      bound,
      paths,
      position,
      lengthMeters);
}

