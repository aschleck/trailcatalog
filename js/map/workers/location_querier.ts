import { S2LatLng, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkArgument, checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { projectS2LatLng, unprojectS2LatLng } from '../camera';
import { WorldBoundsQuadtree } from '../common/bounds_quadtree';
import { LatLng, LatLngRect, Rect, Vec2 } from '../common/types';

import { Anchor, PathRouter } from './path_router';

interface InitializeRequest {
  kind: 'ir';
}

export interface IndexedLine {
  // With the producer's prefix, since queries answer with it
  id: string;
  // Mercator, matching what LineProgram renders.
  points: Float64Array;
}

export interface IndexedPolygon {
  id: string;
  bound: LatLngRect;
  raw: ArrayBuffer;
}

interface LoadRequest {
  kind: 'lr';
  groupId: string;
  // How far the lines may sit from the geometry they stand for, in mercator.
  tolerance: number;
  lines: IndexedLine[];
  polygons: IndexedPolygon[];
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

interface QueryRouteRequest {
  kind: 'qrr';
  generation: number;
  // mercator
  from: Vec2;
  to: Vec2;
  // How far an end may sit from a line and still land on it, in mercator units.
  radius: number;
  // How far the route may stray from the line between its ends, in mercator units.
  reach: number;
}

// Whether somebody is drawing, and so whether the router should keep up with loads as they land
interface RoutingRequest {
  kind: 'rr';
  routing: boolean;
}

export type Request =
    InitializeRequest|LoadRequest|UnloadRequest|QueryPointRequest|QueryRouteRequest|RoutingRequest;

export interface QueryPointResponse {
  kind: 'qpr';
  generation: number;
  ids: string[];
}

export interface Route {
  // Where each end landed on a line, or the point asked for when no line was within radius.
  from: Vec2;
  to: Vec2;
  // The vertices between from and to along the lines, or undefined when an end missed every line
  // or the network doesn't join them
  via: Float64Array|undefined;
}

export interface QueryRouteResponse extends Route {
  kind: 'qrr';
  generation: number;
}

export type Response = QueryPointResponse|QueryRouteResponse;

interface LineEntry {
  kind: 'line';
  id: string;
  points: Float64Array;
}

interface PolygonEntry {
  kind: 'polygon';
  id: string;
  raw: ArrayBuffer;
  // Decoding runs a byte at a time through the S2 reader, which is far too slow to do for every
  // object in a cell. Only the handful of objects a query lands on pay for it.
  polygon: S2Polygon|undefined;
}

type Entry = LineEntry|PolygonEntry;

// Converts a mercator radius to the normalized lat/lng the tree holds bounds in. Normalized
// longitude is mercator x exactly, but normalized latitude runs lat/90 against mercator y's
// atanh(sin lat)/pi, so a mercator radius covers 2 cos(lat) as much of it, worst 2x at the
// equator.
const NORMALIZED_PER_MERCATOR = 2;

class LocationQuerier {

  private readonly groups: Map<string, Array<Rect>>;
  private readonly tree: WorldBoundsQuadtree<Entry>;
  // A second copy of the lines, because the tree only finds what is near a point and a route needs
  // what connects to what.
  private readonly router: PathRouter;
  private routing: boolean;
  // Set while a prepare is scheduled, so that a burst of loads builds once.
  private preparing: boolean;

  constructor(
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {
    this.groups = new Map();
    this.tree = new WorldBoundsQuadtree<Entry>();
    this.router = new PathRouter();
    this.routing = false;
    this.preparing = false;
  }

  setRouting(request: RoutingRequest) {
    this.routing = request.routing;
    this.prepareSoon();
  }

  load(request: LoadRequest) {
    // Loading a group id already held replaces it, or else the old bounds stay in the tree after
    // groups has forgotten them.
    this.unload({kind: 'ur', groupIds: [request.groupId]});

    const bounds = [];
    const lines = [];
    for (const line of request.lines) {
      const latLng = lineBound(line.points);
      if (!latLng) {
        continue;
      }

      const bound = normalize(latLng);
      bounds.push(bound);
      lines.push(line.points);
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
    this.router.load(request.groupId, lines, request.tolerance);
    this.prepareSoon();
  }

  unload(request: UnloadRequest) {
    for (const groupId of request.groupIds) {
      const bounds = this.groups.get(groupId);
      for (const bound of bounds ?? []) {
        this.tree.delete(bound);
      }
      this.groups.delete(groupId);
      this.router.unload(groupId);
    }
    this.prepareSoon();
  }

  // Builds the router ahead of the first route while the line tool is up, because building
  // everything on screen at once takes seconds and the first segment would sit straight until it
  // finishes.
  private prepareSoon() {
    if (!this.routing || this.preparing) {
      return;
    }

    this.preparing = true;
    setTimeout(() => {
      this.preparing = false;
      if (this.routing) {
        this.router.prepare();
      }
    }, 0);
  }

  queryPoint(request: QueryPointRequest) {
    const ll = S2LatLng.fromDegrees(request.point[0], request.point[1]);
    const point = ll.toPoint();
    const [mercatorX, mercatorY] = projectS2LatLng(ll);
    const output: Entry[] = [];
    this.tree.queryCircle(
        normalizePoint(request.point), NORMALIZED_PER_MERCATOR * request.radius, output);

    const lines: Array<{id: string; distance2: number}> = [];
    const polygons: string[] = [];
    for (const entry of output) {
      if (entry.kind === 'line') {
        const distance2 = nearestOnPolyline(mercatorX, mercatorY, entry.points).distance2;
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
    const ids = new Set<string>();
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

  queryRoute(request: QueryRouteRequest) {
    const from = this.anchor(request.from, request.radius);
    const to = this.anchor(request.to, request.radius);
    let via: Float64Array|undefined = undefined;
    if (from && to) {
      via = this.router.route(from, to, request.reach);
    }

    const response: QueryRouteResponse = {
      kind: 'qrr',
      generation: request.generation,
      from: from?.point ?? request.from,
      to: to?.point ?? request.to,
      via,
    };
    this.postMessage(response, via ? [via.buffer] : []);
  }

  // The closest point on a loaded line, or undefined when none of them comes within radius.
  private anchor(point: Vec2, radius: number): Anchor|undefined {
    const ll = unprojectS2LatLng(point[0], point[1]);
    const output: Entry[] = [];
    this.tree.queryCircle(
        normalizePoint([ll.latDegrees(), ll.lngDegrees()] as const as LatLng),
        NORMALIZED_PER_MERCATOR * radius,
        output);

    let best: Nearest|undefined = undefined;
    let bestLine: Float64Array|undefined = undefined;
    let bestDistance2 = radius * radius;
    for (const entry of output) {
      if (entry.kind !== 'line') {
        continue;
      }

      const nearest = nearestOnPolyline(point[0], point[1], entry.points);
      if (nearest.distance2 <= bestDistance2) {
        best = nearest;
        bestLine = entry.points;
        bestDistance2 = nearest.distance2;
      }
    }

    if (!best || !bestLine) {
      return undefined;
    }

    return {
      point: [best.x, best.y],
      a: [bestLine[best.at], bestLine[best.at + 1]],
      b: [bestLine[best.at + 2], bestLine[best.at + 3]],
    };
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
    } else if (request.kind === 'qrr') {
      querier.queryRoute(request);
    } else if (request.kind === 'rr') {
      querier.setRouting(request);
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

interface Nearest {
  // squared, because callers only threshold and sort
  distance2: number;
  // mercator
  x: number;
  y: number;
  // Index into points of the first vertex of the segment the point landed on
  at: number;
}

// The point on a polyline closest to a point, in mercator.
function nearestOnPolyline(px: number, py: number, points: Float64Array): Nearest {
  const best = {distance2: Number.POSITIVE_INFINITY, x: px, y: py, at: 0};
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
    const distance2 = cx * cx + cy * cy;
    if (distance2 < best.distance2) {
      best.distance2 = distance2;
      // (1 - t) a + t b rather than a + t (b - a), because only the first lands exactly on b at
      // t = 1, and PathRouter and EditLayer match a point on a vertex by exact position.
      best.x = (1 - t) * points[i + 0] + t * points[i + 2];
      best.y = (1 - t) * points[i + 1] + t * points[i + 3];
      best.at = i;
    }
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
