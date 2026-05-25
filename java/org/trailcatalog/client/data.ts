import { deepEqual } from 'external/dev_april_corgi+/js/common/comparisons';
import {
  Future,
  asFuture,
  resolvedFuture,
} from 'external/dev_april_corgi+/js/common/futures';
import {
  DataKey,
  initialData,
  requestDataBatch as ssrRequestDataBatch,
} from 'external/dev_april_corgi+/js/server/ssr_aware';

// Local cache shim — replaces the old corgi js/server/data.ts. We treat values as plain `object`
// and lie at the boundary about the JsonValue/ServerResponse types from the new ssr_aware.
const MAX_CACHE_ENTRIES = process.env.CORGI_FOR_BROWSER ? 10 : 0;
const cache: Array<[key: DataKey, response: object]> = [];
for (const [key, value] of initialData()) {
  if (value.kind === 'result') {
    cache.push([key, value.value as unknown as object]);
  }
}

function fetchDataBatchUnsafe(
    tuples: Array<[string, object]>): Future<object[]> {
  const missing: DataKey[] = [];
  const missingIndices: number[] = [];
  const data: object[] = Array(tuples.length);
  for (let i = 0; i < tuples.length; ++i) {
    const [method, request] = tuples[i];
    const cached = getCache(method, request);
    if (cached) {
      data[i] = cached;
      continue;
    }

    missing.push({method, request: request as never});
    missingIndices.push(i);
  }

  if (missing.length === 0) {
    return resolvedFuture(data);
  }

  return ssrRequestDataBatch(missing).then(responses => {
    for (let i = 0; i < responses.length; ++i) {
      const response = responses[i];
      if (response.kind !== 'result') {
        throw new Error(
            `Request for ${missing[i].method} failed with code ${response.code}`);
      }
      const value = response.value as unknown as object;
      data[missingIndices[i]] = value;
      cache.push([missing[i], value]);
    }
    if (cache.length > MAX_CACHE_ENTRIES) {
      cache.splice(0, cache.length - MAX_CACHE_ENTRIES);
    }
    return data;
  });
}

function getCache(method: string, request: object): object|undefined {
  const key = {method, request: request as never};
  for (let i = cache.length - 1; i >= 0; --i) {
    if (deepEqual(cache[i][0], key)) {
      const entry = cache[i];
      cache.splice(i, 1);
      cache.push(entry);
      return entry[1];
    }
  }
  return undefined;
}

function putCache(method: string, request: object, response: object): void {
  cache.push([{method, request: request as never}, response]);
}

export type TrailId = {numeric: string}|{readable: string};

interface DataRequests {
  boundary: {
    id: string;
  };
  boundaries_containing_boundary: {
    child_id: string;
  };
  boundaries_containing_trail: {
    trail_id: TrailId;
  };
  epoch: {};
  path_profiles_in_trail: {
    trail_id: TrailId;
  };
  search_boundaries: {
    query: string;
  };
  search_trails: {
    query: string;
    limit: number;
  };
  trail: {
    trail_id: TrailId;
  };
  trails_in_boundary: {
    boundary_id: string;
  };
}

export interface DataResponses {
  boundary: {
    id: string;
    name: string;
    type: number;
    s2_polygon: string;
  };
  boundaries_containing_boundary: {
    boundaries: Array<{
      id: string;
      name: string;
      type: number;
    }>;
  };
  boundaries_containing_trail: {
    boundaries: Array<{
      id: string;
      name: string;
      type: number;
    }>;
  };
  epoch: {
    timestampS: number;
  };
  path_profiles_in_trail: {
    profiles: Array<{
      id: string;
      granularity_meters: number;
      samples_meters: string;
    }>;
  };
  search_boundaries: {
    results: Array<{
      id: string;
      name: string;
      type: number;
      boundaries: string[];
    }>;
    boundaries: {
      [id: string]: {
        type: number;
        name: string;
      }
    };
  };
  search_trails: {
    results: Array<{
      id: string;
      name: string;
      boundaries: string[];
      bound: string;
      marker: string;
      elevation_down_meters: number;
      elevation_up_meters: number;
      length_meters: number;
    }>;
    boundaries: {
      [id: string]: {
        type: number;
        name: string;
      }
    };
  };
  trail: {
    id: string;
    readable_id: string;
    name: string;
    type: number;
    path_ids: string;
    bound: string;
    marker: string;
    elevation_down_meters: number;
    elevation_up_meters: number;
    length_meters: number;
  };
  trails_in_boundary: {
    trails: Array<{
      id: string;
      name: string;
      type: number;
      elevation_down_meters: number;
      elevation_up_meters: number;
      length_meters: number;
    }>;
  },
}

type RequestTuples<T extends (keyof DataRequests)[]> = {[K in keyof T]: [T[K], DataRequests[T[K]]]}
type ResponseBatch<T extends (keyof DataRequests)[]> = {[K in keyof T]: DataResponses[T[K]]}

let fetchFuture: Future<Array<object | null>> | undefined;
let fetchQueue: Array<[string, object | null]> | undefined;

export function fetchData<K extends keyof DataRequests>(
  method: K,
  request: DataRequests[K]
): Future<DataResponses[K]> {
  // We wait a tick to gather multiple keys before making the request. But if we're rendering on
  // the server we really just want to send it out now. Yolo.
  if (!process.env.CORGI_FOR_BROWSER) {
    return fetchDataBatch([[method, request]]).then(
      r => r[0] as DataResponses[K]
    );
  }

  const cached = getCache(method, request);
  if (cached) {
    return resolvedFuture(cached as DataResponses[K]);
  }

  if (!fetchFuture || !fetchQueue) {
    fetchQueue = [];
    const captured = fetchQueue as RequestTuples<(keyof DataRequests)[]>;
    fetchFuture = asFuture(Promise.resolve()).then(() => {
      fetchFuture = undefined;
      fetchQueue = undefined;
      return fetchDataBatch(captured);
    });
  }

  const i = fetchQueue.length;
  fetchQueue.push([method, request]);
  return fetchFuture.then(r => r[i] as DataResponses[K]);
}

export function fetchDataBatch<T extends (keyof DataRequests)[]>(
  tuples: RequestTuples<T>
): Future<ResponseBatch<T>> {
  return (fetchDataBatchUnsafe(tuples) as Future<ResponseBatch<T>>).then(responses => {
    for (let i = 0; i < tuples.length; ++i) {
      const [method, request] = tuples[i];
      middleware(method, request, responses[i]);
    }
    return responses;
  });
}

function middleware<K extends keyof DataRequests>(
    method: K, rawRequest: DataRequests[K], rawResponse: DataResponses[K]) {
  if (method === 'trail') {
    const request = rawRequest as DataRequests['trail'];
    const response = rawResponse as DataResponses['trail'];
    if ('numeric' in request.trail_id) {
      putCache(method, {
        ...request,
        trail_id: {readable: response.readable_id},
      }, response);
    }
  }
}
