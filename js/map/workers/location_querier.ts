import { S2LatLng, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkArgument, checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { WorldBoundsQuadtree } from '../common/bounds_quadtree';
import { LatLng, LatLngRect, RawUuid, Rect, Vec2 } from '../common/types';

interface InitializeRequest {
  kind: 'ir';
}

interface LoadRequest {
  kind: 'lr';
  groupId: string;
  lines: Array<{
    id: RawUuid;
    points: Float64Array;
  }>;
  polygons: Array<{
    id: RawUuid;
    bound: LatLngRect;
    raw: ArrayBuffer;
  }>;
}

interface UnloadRequest {
  kind: 'ur';
  groupIds: string[];
}

interface QueryPointRequest {
  kind: 'qpr';
  generation: number;
  point: LatLng;
}

export type Request = InitializeRequest|LoadRequest|UnloadRequest|QueryPointRequest;

export interface QueryPointResponse {
  kind: 'qpr';
  generation: number;
  ids: RawUuid[];
}

export type Response = QueryPointResponse;

interface Entry {
  id: {lsb: bigint; msb: bigint};
  raw: ArrayBuffer;
  // Decoding runs a byte at a time through the S2 reader, which is far too slow to do for every
  // object in a cell. Only the handful of objects a query lands on pay for it.
  polygon: S2Polygon|undefined;
}

class LocationQuerier {

  private readonly groups: Map<string, Array<Rect>>;
  private readonly tree: WorldBoundsQuadtree<Entry>;

  constructor(
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {
    this.groups = new Map();
    this.tree = new WorldBoundsQuadtree<Entry>();
  }

  load(request: LoadRequest) {
    const bounds = [];
    // TODO(april): also load lines
    for (const polygon of request.polygons) {
      // A polygon that simplified away has an empty bound and can never be hit.
      if (polygon.bound.low[0] > polygon.bound.high[0]) {
        continue;
      }

      const bound = normalize(polygon.bound);
      bounds.push(bound);
      this.tree.insert({id: polygon.id, raw: polygon.raw, polygon: undefined}, bound);
    }
    this.groups.set(request.groupId, bounds);
  }

  unload(request: UnloadRequest) {
    for (const groupId of request.groupIds) {
      const bounds = this.groups.get(groupId);
      for (const bound of bounds ?? []) {
        this.tree.delete(bound);
      }
      this.groups.delete(groupId);
    }
  }

  queryPoint(request: QueryPointRequest) {
    const point = S2LatLng.fromDegrees(request.point[0], request.point[1]).toPoint();
    const output: Entry[] = [];
    this.tree.queryCircle(normalizePoint(request.point), 0.0001, output);
    const ids = new Set();
    for (const entry of output) {
      entry.polygon = entry.polygon ?? SimpleS2.decodePolygon(entry.raw);
      if (entry.polygon.containsPoint(point)) {
        ids.add(entry.id);
      }
    }
    self.postMessage({
      kind: 'qpr',
      generation: request.generation,
      ids: [...ids],
    } as QueryPointResponse);
  }
}

function start(ir: InitializeRequest) {
  const querier = new LocationQuerier((self as any).postMessage.bind(self));
  self.onmessage = e => {
    const request = e.data as Request;
    if (request.kind === 'ir') {
      throw new Error('Already initialized');
    } else if (request.kind === 'lr') {
      querier.load(request);
    } else if (request.kind === 'qpr') {
      querier.queryPoint(request);
    } else if (request.kind === 'ur') {
      querier.unload(request);
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

function normalize(bound: LatLngRect): Rect {
  return {
    low: [bound.low[0] / 90, bound.low[1] / 180],
    high: [bound.high[0] / 90, bound.high[1] / 180],
  } as const as Rect;
}

function normalizePoint(ll: LatLng): Vec2 {
  return [ll[0] / 90, ll[1] / 180];
}
