import { WorkerPool } from 'external/dev_april_corgi+/js/common/worker_pool';

import { Vec2 } from '../common/types';

import {
  Request,
  Response,
  RouteResponse,
  SampleResponse,
  SunlightRequest,
  SunlightResponse,
  TraceRequest,
  TraceResponse,
} from './elevation_sampler';
import { GradeLimits } from './terrain_router';

/** Looks up elevations in a worker, which fetches and decodes the DEM tiles it needs. */
export class Elevations {

  private readonly worker: WorkerPool<Request, Response>;
  // Resolvers for the requests in flight, by id
  private readonly pending: Map<number, (response: Response) => void>;
  private requestCount: number;

  constructor() {
    this.worker = new WorkerPool(new URL('elevation_sampler_worker.js', import.meta.url).href, 1);
    this.pending = new Map();
    this.requestCount = 0;

    this.worker.onresponse = response => {
      const resolve = this.pending.get(response.id);
      this.pending.delete(response.id);
      resolve?.(response);
    };
    this.worker.broadcast({kind: 'ir'});
  }

  /**
   * Resolves with meters for each interleaved lat, lng pair, read from tiles at zoom or the
   * deepest zoom above it that covers the point. Rejects if the tiles could not be fetched, or if
   * a later call with the same key replaced this one.
   */
  sample(latLngDegrees: Float64Array, zoom: number, key?: string): Promise<Float32Array> {
    return this.request<SampleResponse>(id => ({kind: 'sr', id, latLngDegrees, zoom, key}))
        .then(({meters}) => {
          if (meters.length !== latLngDegrees.length / 2) {
            throw new Error('Unable to sample elevations');
          }
          return meters;
        });
  }

  /**
   * Resolves with the skyline and viewshed around a point, traced a pixel at a time out from it,
   * see TerrainTracer. Rejects if the tiles could not be fetched.
   */
  trace(request: Omit<TraceRequest, 'kind'|'id'>): Promise<TraceResponse> {
    return this.request<TraceResponse>(id => ({kind: 'tr', id, ...request})).then(response => {
      if (response.failed) {
        throw new Error('Unable to trace the terrain');
      }
      return response;
    });
  }

  /**
   * Resolves with how dark the terrain in a mercator box is under the sun, see
   * sunlight.ts#getSunlight. Rejects if the tiles could not be fetched.
   */
  shade(request: Omit<SunlightRequest, 'kind'|'id'>): Promise<SunlightResponse> {
    return this.request<SunlightResponse>(id => ({kind: 'lr', id, ...request})).then(response => {
      if (response.rgba.length === 0) {
        throw new Error('Unable to shade the terrain');
      }
      return response;
    });
  }

  /**
   * Resolves with the quickest way on foot between two mercator points, excluding both, that stays
   * within the grade limits, or undefined when there is none. Rejects if the tiles could not be
   * fetched.
   */
  route(from: Vec2, to: Vec2, limits: GradeLimits): Promise<Float64Array|undefined> {
    return this.request<RouteResponse>(id => ({kind: 'rr', id, from, to, limits}))
        .then(response => {
          if (response.failed) {
            throw new Error('Unable to route over terrain');
          }
          return response.via;
        });
  }

  private request<R extends Response>(request: (id: number) => Request): Promise<R> {
    const id = this.requestCount;
    this.requestCount += 1;
    return new Promise<R>(resolve => {
      // The id says which response this is, so the cast only restates what the caller asked for.
      this.pending.set(id, response => { resolve(response as R); });
      this.worker.post(request(id));
    });
  }
}
