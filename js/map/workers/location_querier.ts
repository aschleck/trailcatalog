import { S2LatLng, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkArgument, checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { projectS2LatLng, unprojectS2LatLng } from '../camera';
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
    // Mercator, matching what LineProgram renders.
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
  // How far a line may sit from the point and still count as hit, in mercator units. Polygons test
  // containment and ignore it.
  radius: number;
}

export type Request = InitializeRequest|LoadRequest|UnloadRequest|QueryPointRequest;

export interface QueryPointResponse {
  kind: 'qpr';
  generation: number;
  ids: RawUuid[];
}

export type Response = QueryPointResponse;

interface LineEntry {
  kind: 'line';
  id: RawUuid;
  points: Float64Array;
}

interface PolygonEntry {
  kind: 'polygon';
  id: RawUuid;
  raw: ArrayBuffer;
  // Decoding runs a byte at a time through the S2 reader, which is far too slow to do for every
  // object in a cell. Only the handful of objects a query lands on pay for it.
  polygon: S2Polygon|undefined;
}

type Entry = LineEntry|PolygonEntry;

// Broad phase radius in normalized lat/lng. Bounds only have to reach the query, the narrow phase
// applies the caller's radius, so this just has to stay above any hit radius we are asked for.
const CANDIDATE_RADIUS = 0.0001;

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
    for (const line of request.lines) {
      const latLng = lineBound(line.points);
      if (!latLng) {
        continue;
      }

      const bound = normalize(latLng);
      bounds.push(bound);
      this.tree.insert({kind: 'line', id: line.id, points: line.points}, bound);
    }
    for (const polygon of request.polygons) {
      // A polygon that simplified away has an empty bound and can never be hit.
      if (polygon.bound.low[0] > polygon.bound.high[0]) {
        continue;
      }

      const bound = normalize(polygon.bound);
      bounds.push(bound);
      this.tree.insert(
          {kind: 'polygon', id: polygon.id, raw: polygon.raw, polygon: undefined}, bound);
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
    const ll = S2LatLng.fromDegrees(request.point[0], request.point[1]);
    const point = ll.toPoint();
    const [mercatorX, mercatorY] = projectS2LatLng(ll);
    const output: Entry[] = [];
    this.tree.queryCircle(normalizePoint(request.point), CANDIDATE_RADIUS, output);

    const lines: Array<{id: RawUuid; distance2: number}> = [];
    const polygons: RawUuid[] = [];
    for (const entry of output) {
      if (entry.kind === 'line') {
        const distance2 = distanceToPolyline2(mercatorX, mercatorY, entry.points);
        if (distance2 <= request.radius * request.radius) {
          lines.push({id: entry.id, distance2});
        }
      } else if (entry.kind === 'polygon') {
        entry.polygon = entry.polygon ?? SimpleS2.decodePolygon(entry.raw);
        if (entry.polygon.containsPoint(point)) {
          polygons.push(entry.id);
        }
      } else {
        throw checkExhaustive(entry);
      }
    }

    // A line is a narrower target than whatever area sits under it, so lines rank ahead of
    // polygons and the nearest line wins among themselves.
    lines.sort((a, b) => a.distance2 - b.distance2);
    const ids = new Set<RawUuid>();
    for (const line of lines) {
      ids.add(line.id);
    }
    for (const polygon of polygons) {
      ids.add(polygon);
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

// The quadtree indexes lat/lng, so a mercator polyline has to hand back the box it occupies there.
// Mercator y rises monotonically with latitude and x is linear in longitude, so the extremes of the
// points are the corners of the bound. Returns undefined for a line with no segments, which can
// never be hit.
function lineBound(points: Float64Array): LatLngRect|undefined {
  if (points.length < 4) {
    return undefined;
  }

  let lowX = points[0];
  let lowY = points[1];
  let highX = points[0];
  let highY = points[1];
  for (let i = 2; i < points.length; i += 2) {
    lowX = Math.min(lowX, points[i + 0]);
    lowY = Math.min(lowY, points[i + 1]);
    highX = Math.max(highX, points[i + 0]);
    highY = Math.max(highY, points[i + 1]);
  }

  const low = unprojectS2LatLng(lowX, lowY);
  const high = unprojectS2LatLng(highX, highY);
  return {
    low: [low.latDegrees(), low.lngDegrees()],
    high: [high.latDegrees(), high.lngDegrees()],
  } as const as LatLngRect;
}

// Squared mercator distance from a point to the nearest segment of a polyline. Squared because
// nothing here needs the real distance: the caller thresholds and sorts, and both survive it.
function distanceToPolyline2(px: number, py: number, points: Float64Array): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 3 < points.length; i += 2) {
    const ax = wrapX(points[i + 0] - px);
    const ay = points[i + 1] - py;
    const bx = wrapX(points[i + 2] - px);
    const by = points[i + 3] - py;
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    // A zero length segment collapses to its own endpoint, so clamping t to 0 gives that point.
    const t = length2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length2)) : 0;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    best = Math.min(best, cx * cx + cy * cy);
  }
  return best;
}

// Mercator x wraps at the antimeridian, so a separation wider than the world is really the short
// way around. Matches the wrap line_program applies to a vertex.
function wrapX(dx: number): number {
  if (dx > 1) {
    return dx - 2;
  } else if (dx < -1) {
    return dx + 2;
  } else {
    return dx;
  }
}
