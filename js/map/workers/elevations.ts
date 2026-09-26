import { WorkerPool } from 'external/dev_april_corgi+/js/common/worker_pool';

import { Request, Response } from './elevation_sampler';

/** Looks up elevations in a worker, which fetches and decodes the DEM tiles it needs. */
export class Elevations {

  private readonly worker: WorkerPool<Request, Response>;
  // Resolvers for the samples in flight, by id
  private readonly pending: Map<number, (meters: Float32Array) => void>;
  private requestCount: number;

  constructor() {
    this.worker = new WorkerPool('/static/elevation_sampler_worker.js', 1);
    this.pending = new Map();
    this.requestCount = 0;

    this.worker.onresponse = response => {
      const resolve = this.pending.get(response.id);
      this.pending.delete(response.id);
      resolve?.(response.meters);
    };
    this.worker.broadcast({kind: 'ir'});
  }

  /**
   * Resolves with meters for each interleaved lat, lng pair, read from tiles at zoom or the
   * deepest zoom above it that covers the point. Rejects if the tiles could not be fetched.
   */
  sample(latLngDegrees: Float64Array, zoom: number): Promise<Float32Array> {
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
      this.worker.post({kind: 'sr', id, latLngDegrees, zoom});
    });
  }
}
