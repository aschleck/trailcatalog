import { WorkerPool } from 'external/dev_april_corgi+/js/common/worker_pool';

import { Vec2 } from '../common/types';

import {
  Request,
  Response,
  RouteResponse,
  TraceRequest,
  TraceResponse,
} from './elevation_sampler';
import { GradeLimits } from './terrain_router';

/** Looks up elevations in a worker, which fetches and decodes the DEM tiles it needs. */
export class Elevations {

  private readonly worker: WorkerPool<Request, Response>;
  // Resolvers for the samples in flight, by id
  private readonly pending: Map<number, (meters: Float32Array) => void>;
  private readonly pendingRoutes: Map<number, (response: RouteResponse) => void>;
  private readonly pendingTraces: Map<number, (response: TraceResponse) => void>;
  private requestCount: number;

  constructor() {
    this.worker = new WorkerPool(new URL('elevation_sampler_worker.js', import.meta.url).href, 1);
    this.pending = new Map();
    this.pendingRoutes = new Map();
    this.pendingTraces = new Map();
    this.requestCount = 0;

    this.worker.onresponse = response => {
      if (response.kind === 'rr') {
        const resolve = this.pendingRoutes.get(response.id);
        this.pendingRoutes.delete(response.id);
        resolve?.(response);
      } else if (response.kind === 'tr') {
        const resolve = this.pendingTraces.get(response.id);
        this.pendingTraces.delete(response.id);
        resolve?.(response);
      } else {
        const resolve = this.pending.get(response.id);
        this.pending.delete(response.id);
        resolve?.(response.meters);
      }
    };
    this.worker.broadcast({kind: 'ir'});
  }

  /**
   * Resolves with meters for each interleaved lat, lng pair, read from tiles at zoom or the
   * deepest zoom above it that covers the point. Rejects if the tiles could not be fetched, or if
   * a later call with the same key replaced this one.
   */
  sample(latLngDegrees: Float64Array, zoom: number, key?: string): Promise<Float32Array> {
    const id = this.requestCount;
    this.requestCount += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, meters => {
        if (meters.length === latLngDegrees.length / 2) {
          resolve(meters);
        } else {
          reject(new Error('Unable to sample elevations'));
        }
      });
      this.worker.post({kind: 'sr', id, latLngDegrees, zoom, key});
    });
  }

  /**
   * Resolves with the skyline and viewshed around a point, traced a pixel at a time out from it,
   * see TerrainTracer. Rejects if the tiles could not be fetched.
   */
  trace(request: Omit<TraceRequest, 'kind'|'id'>): Promise<TraceResponse> {
    const id = this.requestCount;
    this.requestCount += 1;
    return new Promise((resolve, reject) => {
      this.pendingTraces.set(id, response => {
        if (response.failed) {
          reject(new Error('Unable to trace the terrain'));
        } else {
          resolve(response);
        }
      });
      this.worker.post({kind: 'tr', id, ...request});
    });
  }

  /**
   * Resolves with the quickest way on foot between two mercator points, excluding both, that stays
   * within the grade limits, or undefined when there is none. Rejects if the tiles could not be
   * fetched.
   */
  route(from: Vec2, to: Vec2, limits: GradeLimits): Promise<Float64Array|undefined> {
    const id = this.requestCount;
    this.requestCount += 1;
    return new Promise((resolve, reject) => {
      this.pendingRoutes.set(id, response => {
        if (response.failed) {
          reject(new Error('Unable to route over terrain'));
        } else {
          resolve(response.via);
        }
      });
      this.worker.post({kind: 'rr', id, from, to, limits});
    });
  }
}
