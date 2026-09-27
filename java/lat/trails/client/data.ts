import { Message } from '@bufbuild/protobuf';

import { Future, resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import { invalidateCache } from 'external/dev_april_corgi+/js/data/caching';
import {
  CachingMiddleware,
  Middleware,
  Response,
} from 'external/dev_april_corgi+/js/data/middleware';
import { DataRequestor, FqMethods } from 'external/dev_april_corgi+/js/data/requestor';

import { BACKENDS } from './backends';

// Write RPCs that cause cache invalidations
const WRITES: string[] = [
  'lat.trails.DataService/CreateCollection',
  'lat.trails.DataService/Save',
  'lat.trails.DataService/SetSharing',
] satisfies Array<keyof FqMethods<typeof BACKENDS>>;

// Read RPCs that are invalidated when a write comes through
const READS_A_WRITE_CHANGES: string[] = [
  'lat.trails.DataService/GetCollection',
  'lat.trails.DataService/GetSharing',
  'lat.trails.DataService/ListCollections',
] satisfies Array<keyof FqMethods<typeof BACKENDS>>;

class Invalidator implements Middleware {
  onResponse(method: string, request: Message, response: Response<Message>):
      Future<Response<Message>> {
    if (WRITES.indexOf(method) < 0) {
      return resolvedFuture(response);
    }

    // The write drops its own entries too, or else CachingMiddleware, which runs first and caches
    // whatever it sees, answers an identical retry without the server ever hearing about it.
    invalidateCache(m => m === method || READS_A_WRITE_CHANGES.indexOf(m) >= 0);
    return resolvedFuture(response);
  }
}

const requestor = new DataRequestor(BACKENDS);
requestor.addMiddleware(new CachingMiddleware());
requestor.addMiddleware(new Invalidator());

export const requestData = requestor.requestData.bind(requestor);

/** Drops the cached user so the next GetCurrentUser asks the server again. */
export function invalidateCurrentUser(): void {
  invalidateCache(method => method === 'lat.trails.DataService/GetCurrentUser');
}
