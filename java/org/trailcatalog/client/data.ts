import { fetchDataBatch as fetchDataBatchUnsafe } from './common/data';
import { initialData as initialDataUnsafe } from './common/ssr_aware';

interface DataRequests {
  boundary: {
    id: string;
  };
  boundaries_containing_boundary: {
    child_id: string;
  };
  boundaries_containing_trail: {
    trail_id: string;
  };
  path_profiles_in_trail: {
    trail_id: string;
  };
  search_boundaries: {
    query: string;
  };
  search_trails: {
    query: string;
    limit: number;
  };
  trail: {
    id: string;
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
  path_profiles_in_trail: {
    profiles: Array<{
      id: string;
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

let fetchPromise: Promise<object[]>|undefined;
let fetchQueue: Array<[string, object]>|undefined;

export function fetchData<K extends keyof DataRequests>(type: K, request: DataRequests[K]):
    Promise<DataResponses[K]> {
  if (!fetchPromise || !fetchQueue) {
    fetchQueue = [];
    const captured = fetchQueue;
    fetchPromise =
        Promise.resolve().then(() => {
          fetchPromise = undefined;
          fetchQueue = undefined;
          return fetchDataBatchUnsafe(captured);
        });
  }

  const i = fetchQueue.length;
  fetchQueue.push([type, request]);
  return fetchPromise.then(r => r[i] as DataResponses[K]);
}

export function fetchDataBatch<T extends (keyof DataRequests)[]>(tuples: RequestTuples<T>):
    Promise<ResponseBatch<T>> {
  return fetchDataBatchUnsafe(tuples) as Promise<ResponseBatch<T>>;
}

export function initialData<K extends keyof DataRequests>(type: K, request: DataRequests[K]):
    DataResponses[K]|undefined {
  return initialDataUnsafe({
    ...request,
    type,
  }) as DataResponses[K];
}

