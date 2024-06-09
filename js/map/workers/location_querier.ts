import { S2LatLng, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkArgument, checkExhaustive, checkExists } from 'external/dev_april_corgi~/js/common/asserts';

import { WorldBoundsQuadtree } from '../common/bounds_quadtree';
import { LatLng, Rect, Vec2 } from '../common/types';

interface InitializeRequest {
  kind: 'ir';
}

interface LoadRequest {
  kind: 'lr';
  groupId: string;
  polygons: Array<{
    s2: ArrayBuffer;
  }>;
}

interface UnloadRequest {
  kind: 'ur';
  groupIds: string[];
}

interface QueryPointRequest {
  kind: 'qpr';
  point: LatLng;
}

export type Request = InitializeRequest|LoadRequest|UnloadRequest|QueryPointRequest;

export interface QueryPointResponse {
  kind: 'qpr';
}

export type Response = QueryPointResponse;

interface Entry {
  polygon: S2Polygon;
}

class LocationQuerier {

  private readonly groups: Map<string, LoadRequest>;
  private readonly tree: WorldBoundsQuadtree<Entry>;

  constructor(
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {
    this.groups = new Map();
    this.tree = new WorldBoundsQuadtree<Entry>();
  }

  load(request: LoadRequest) {
    this.groups.set(request.groupId, request);

    for (const polygon of request.polygons) {
      const s2 = SimpleS2.decodePolygon(polygon.s2);
      const bound = llrBound(s2);
      this.tree.insert({polygon: s2}, bound);
    }
  }

  unload(request: UnloadRequest) {
    for (const groupId of request.groupIds) {
      this.groups.delete(groupId);
    }
  }

  queryPoint(request: QueryPointRequest) {
    const point = S2LatLng.fromDegrees(request.point[0], request.point[1]).toPoint();
    const output: Entry[] = [];
    this.tree.queryCircle(normalize(request.point), 0.0001, output);
    for (const {polygon} of output) {
      if (polygon.containsPoint(point)) {
        console.log(polygon);
      }
    }
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

function llrBound(polygon: S2Polygon): Rect {
  const bound = polygon.getRectBound();
  const low = bound.lo();
  const high = bound.hi();
  return {
    low: [low.latDegrees() / 90, low.lngDegrees() / 180],
    high: [high.latDegrees() / 90, high.lngDegrees() / 180],
  } as const as Rect;
}

function normalize(ll: LatLng): Vec2 {
  return [ll[0] / 90, ll[1] / 180];
}
