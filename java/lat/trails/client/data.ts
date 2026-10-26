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

// Write RPCs that cause cache invalidations. Keep in sync with ApiServer.kt#WRITES.
const WRITES: string[] = [
  'lat.trails.DataService/AcceptInvite',
  'lat.trails.DataService/CreateCollection',
  'lat.trails.DataService/CreateInvite',
  'lat.trails.DataService/DeleteAccount',
  'lat.trails.DataService/DeleteCollection',
  'lat.trails.DataService/RevokeInvite',
  'lat.trails.DataService/Save',
  'lat.trails.DataService/SetAnyoneCanView',
  'lat.trails.DataService/SetGrant',
  'lat.trails.DataService/SetViewState',
  'lat.trails.DataService/UpdateCollection',
] satisfies Array<keyof FqMethods<typeof BACKENDS>>;

// Read RPCs that are invalidated when a write comes through or somebody signs in
const USER_DEPENDENT_READS: string[] = [
  'lat.trails.DataService/GetAccount',
  'lat.trails.DataService/GetCollection',
  'lat.trails.DataService/GetInvite',
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
    invalidateCache(m => m === method || USER_DEPENDENT_READS.indexOf(m) >= 0);
    return resolvedFuture(response);
  }
}

const requestor = new DataRequestor(BACKENDS);
requestor.addMiddleware(new CachingMiddleware());
requestor.addMiddleware(new Invalidator());

export const requestData = requestor.requestData.bind(requestor);

/** Drops everything cached for the previous user so the next reads ask the server again. */
export function invalidateCurrentUser(): void {
  invalidateCache(
      method =>
          method === 'lat.trails.DataService/GetCurrentUser'
              || USER_DEPENDENT_READS.indexOf(method) >= 0);
}
