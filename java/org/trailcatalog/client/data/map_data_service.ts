import { S2CellId, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive, checkExists, exists } from 'js/common/asserts';
import { Disposable } from 'js/common/disposable';
import { EmptyDeps } from 'js/corgi/deps';
import { Service, ServiceResponse } from 'js/corgi/service';

import { LittleEndianView } from '../common/little_endian_view';
import { metersToMiles, reinterpretLong, rgbaToUint32F } from '../common/math';
import { PixelRect, S2CellNumber, Vec2, Vec4 } from '../common/types';
import { Path, Trail } from '../models/types';
import { DETAIL_ZOOM_THRESHOLD, FetcherCommand, Viewport } from '../workers/data_fetcher';

interface Filter {
  boundary?: number;
}

interface Listener {
  loadMetadata(paths: Path[], trails: Trail[]): void;
  loadDetail(paths: Path[], trails: Trail[]): void;
  unloadEverywhere(paths: Path[], trails: Trail[]): void;
}

const DATA_ZOOM_THRESHOLD = 4;
const TEXT_DECODER = new TextDecoder();

export class MapDataService extends Service<EmptyDeps> {

  private readonly fetcher: Worker;
  private readonly listeners: Map<Listener, Viewport>;

  readonly metadataCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  readonly detailCells: Map<S2CellNumber, ArrayBuffer|undefined>;
  readonly paths: Map<bigint, Path>;
  readonly trails: Map<bigint, Trail>;

  constructor(response: ServiceResponse<EmptyDeps>) {
    super(response);
    this.fetcher = new Worker('/static/data_fetcher_worker.js');
    this.listeners = new Map();

    this.metadataCells = new Map();
    this.detailCells = new Map();
    this.paths = new Map();
    this.trails = new Map();

    //this.fetcher.postMessage({
    //  ...filter,
    //  kind: 'sfr',
    //});
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

  addListener(listener: Listener): void {
    this.listeners.set(listener, {lat: [0, 0], lng: [0, 0], zoom: 31});
  }

  removeListener(listener: Listener): void {
    this.listeners.delete(listener);
  }

  getTrail(id: bigint): Trail|undefined {
    return this.trails.get(id);
  }

  listTrailsOnPath(path: Path): Trail[] {
    return path.trails.map(t => this.trails.get(t)).filter(exists);
  }

  updateViewport(listener: Listener, viewport: Viewport): void {
    this.listeners.set(listener, viewport);

    if (viewport.zoom < DATA_ZOOM_THRESHOLD) {
      return;
    }

    this.fetcher.postMessage({
      kind: 'uvr',
      viewports: [...this.listeners.values()],
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
    for (const listener of this.listeners.keys()) {
      listener.loadMetadata([], trails);
    }
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
      const pathTrailCount = data.getInt32();
      const pathTrails = [];
      for (let j = 0; j < pathTrailCount; ++j) {
        pathTrails.push(data.getBigInt64());
      }

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
      const built = new Path(id, type, bound, pathTrails, points);
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
      const trailWayCount = data.getInt32();
      data.align(8);
      const trailWays = [...data.sliceBigInt64(trailWayCount)];
      const position: Vec2 = [data.getFloat64(), data.getFloat64()];
      const lengthMeters = data.getFloat64();
      const existing = this.trails.get(id);
      let trail;
      if (existing) {
        trail = existing;
        if (trail.paths.length === 0) {
          trail.paths.push(...trailWays);
        }
      } else {
        trail = constructTrail(id, name, type, trailWays, position, lengthMeters);
        this.trails.set(id, trail);
      }
      trails.push(trail);
    }

    this.detailCells.set(id, buffer);
    for (const listener of this.listeners.keys()) {
      listener.loadDetail(paths, trails);
    }
  }

  private unloadCell(id: S2CellNumber): void {
    // TODO(april): does this mean we leak metadata cells?
    const buffer = this.detailCells.get(id);
    if (!buffer) {
      return;
    }

    this.metadataCells.delete(id);
    this.detailCells.delete(id);

    const data = new LittleEndianView(buffer);

    const pathCount = data.getInt32();
    const paths = [];
    for (let i = 0; i < pathCount; ++i) {
      const id = data.getBigInt64();
      data.skip(4);
      const pathTrailCount = data.getInt32();
      data.skip(pathTrailCount * 8);

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
      const trailWayCount = data.getInt32();
      data.align(8);
      data.skip(trailWayCount * 8 + 16 + 8);

      const entity = this.trails.get(id);
      if (entity) {
        this.trails.delete(id);
        trails.push(entity);
      }
    }

    for (const listener of this.listeners.keys()) {
      listener.unloadEverywhere(paths, trails);
    }
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

