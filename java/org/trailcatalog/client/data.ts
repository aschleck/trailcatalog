import {
  Future,
  asFuture,
  resolvedFuture,
} from 'external/dev_april_corgi+/js/common/futures';
import {
  fetchDataBatch as fetchDataBatchUnsafe,
  getCache,
  putCache,
} from 'external/dev_april_corgi+/js/server/data';

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
  type: K,
  request: DataRequests[K]
): Future<DataResponses[K]> {
  // We wait a tick to gather multiple keys before making the request. But if we're rendering on
  // the server we really just want to send it out now. Yolo.
  if (!process.env.CORGI_FOR_BROWSER) {
    return fetchDataBatch([[type, request]]).then(
      r => r[0] as DataResponses[K]
    );
  }

  const cached = getCache(type, request);
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
  fetchQueue.push([type, request]);
  return fetchFuture.then(r => r[i] as DataResponses[K]);
}

export function fetchDataBatch<T extends (keyof DataRequests)[]>(
  tuples: RequestTuples<T>
): Future<ResponseBatch<T>> {
  return (fetchDataBatchUnsafe(tuples) as Future<ResponseBatch<T>>).then(responses => {
    for (let i = 0; i < tuples.length; ++i) {
      const [type, request] = tuples[i];
      middleware(type, request, responses[i]);
    }
    return responses;
  });
}

function middleware<K extends keyof DataRequests>(
    type: K, rawRequest: DataRequests[K], rawResponse: DataResponses[K]) {
  if (type === 'trail') {
    const request = rawRequest as DataRequests['trail'];
    const response = rawResponse as DataResponses['trail'];
    if ('numeric' in request.trail_id) {
      putCache(type, {
        ...request,
        trail_id: {readable: response.readable_id},
      }, response);
    }
  }
}
