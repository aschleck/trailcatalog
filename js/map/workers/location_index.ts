import { S2LatLng } from 'java/org/trailcatalog/s2';
import { WorkerPool } from 'external/dev_april_corgi+/js/common/worker_pool';

import { LatLng, Vec2 } from '../common/types';

import {
  IndexedLine,
  IndexedPolygon,
  QueryPointResponse,
  QueryRouteResponse,
  Request,
  Response,
  Route,
} from './location_querier';

/**
 * The geometry every layer can be hit tested and routed against, held in one worker.
 *
 * Each producer takes a prefix and loads its geometry under group ids of its own. Every query is
 * answered, even one whose caller has moved on, because the worker has done the work by then and
 * the caller knows better than we do whether it still wants it.
 */
export class LocationIndex {

  private readonly worker: WorkerPool<Request, Response>;
  // Resolvers for the queries in flight, by generation
  private readonly pending: Map<number, (response: Response) => void>;
  private queryCount: number;
  private producerCount: number;

  constructor() {
    this.worker = new WorkerPool('/static/location_querier_worker.js', 1);
    this.pending = new Map();
    this.queryCount = 0;
    this.producerCount = 0;

    this.worker.onresponse = response => {
      const resolve = this.pending.get(response.generation);
      this.pending.delete(response.generation);
      resolve?.(response);
    };
    this.worker.broadcast({kind: 'ir'});
  }

  /**
   * A prefix for one producer's group and object ids, taken once at construction.
   *
   * Two collection layers name their cells by CellKey and their objects by uuid, and neither says
   * which layer it came from, so without a prefix their groups would collide.
   */
  producer(): string {
    this.producerCount += 1;
    return `${this.producerCount}/`;
  }

  /**
   * Replaces everything held under a group id. Tolerance is how far its lines may sit from the
   * geometry they stand for, in mercator, which is how far apart two lines may end and still meet.
   */
  load(
      groupId: string,
      tolerance: number,
      lines: IndexedLine[],
      polygons: IndexedPolygon[]): void {
    this.worker.post({kind: 'lr', groupId, tolerance, lines, polygons});
  }

  unload(groupIds: string[]): void {
    this.worker.post({kind: 'ur', groupIds});
  }

  /** Keeps the router built as geometry lands, for while somebody is drawing. */
  setRouting(routing: boolean): void {
    this.worker.post({kind: 'rr', routing});
  }

  /** The objects under a point, nearest first, lines ahead of the areas they sit on. */
  queryPoint(point: S2LatLng, radius: number): Promise<string[]> {
    return this.query<QueryPointResponse>(generation => ({
      kind: 'qpr',
      generation,
      point: [point.latDegrees(), point.lngDegrees()] as const as LatLng,
      radius,
    })).then(response => response.ids);
  }

  /** The way between two points along the lines, with both ends snapped onto them. */
  queryRoute(from: Vec2, to: Vec2, radius: number, reach: number): Promise<Route> {
    return this.query<QueryRouteResponse>(
        generation => ({kind: 'qrr', generation, from, to, radius, reach}));
  }

  private query<R extends Response>(request: (generation: number) => Request): Promise<R> {
    this.queryCount += 1;
    const generation = this.queryCount;
    return new Promise<R>(resolve => {
      // The generation says which response this is, so the cast only restates what the caller
      // asked for.
      this.pending.set(generation, response => { resolve(response as R); });
      this.worker.post(request(generation));
    });
  }
}
