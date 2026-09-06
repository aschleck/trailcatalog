import { deepEqual } from 'external/dev_april_corgi+/js/common/comparisons';
import { Future, resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import {
  DataKey,
  initialData,
  requestDataBatch,
} from 'external/dev_april_corgi+/js/server/ssr_aware';

export interface User {
  id: string;
  display_name: string;
  picture_url: string|null;
}

interface DataRequests {
  self: {};
}

interface DataResponses {
  self: {user: User|null};
}

// The server side render writes everything it fetched into the page, so hydration answers out of
// here instead of asking again. Only the browser caches: the module outlives a request on the
// server, and one signed in user's data must not answer the next user's render. The server side
// render dedupes within a request anyway, see corgi's js/server/server.ts#requestDataBatch.
const cache: Array<[key: DataKey, value: object]> = [];
if (process.env.CORGI_FOR_BROWSER) {
  for (const [key, value] of initialData()) {
    if (value.kind === 'result') {
      cache.push([key, value.value as unknown as object]);
    }
  }
}

/** Asks the server again, dropping whatever the cache holds for the method. */
export function refetchData<K extends keyof DataRequests>(
    method: K, request: DataRequests[K]): Future<DataResponses[K]> {
  const key = {method, request: request as never};
  for (let i = cache.length - 1; i >= 0; --i) {
    if (deepEqual(key, cache[i][0])) {
      cache.splice(i, 1);
    }
  }
  return fetchData(method, request);
}

export function fetchData<K extends keyof DataRequests>(
    method: K, request: DataRequests[K]): Future<DataResponses[K]> {
  const key = {method, request: request as never};
  if (process.env.CORGI_FOR_BROWSER) {
    for (const [candidate, value] of cache) {
      if (deepEqual(key, candidate)) {
        return resolvedFuture(value as DataResponses[K]);
      }
    }
  }

  return requestDataBatch([key]).then(responses => {
    const response = responses[0];
    if (response.kind !== 'result') {
      throw new Error(`Request for ${method} failed with code ${response.code}`);
    }

    const value = response.value as unknown as DataResponses[K];
    if (process.env.CORGI_FOR_BROWSER) {
      cache.push([key, value as unknown as object]);
    }
    return value;
  });
}
