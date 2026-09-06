import { invalidateCache } from 'external/dev_april_corgi+/js/data/caching';
import { CachingMiddleware } from 'external/dev_april_corgi+/js/data/middleware';
import { DataRequestor } from 'external/dev_april_corgi+/js/data/requestor';

import { BACKENDS } from './backends';

const requestor = new DataRequestor(BACKENDS);
requestor.addMiddleware(new CachingMiddleware());

export const requestData = requestor.requestData.bind(requestor);

/** Drops the cached user so the next GetCurrentUser asks the server again. */
export function invalidateCurrentUser(): void {
  invalidateCache(method => method === 'lat.trails.DataService/GetCurrentUser');
}
