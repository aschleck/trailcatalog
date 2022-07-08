import { fetchDataBatch as fetchDataBatchUnsafe } from './common/data';
import { initialData as initialDataUnsafe } from './common/ssr_aware';

interface DataRequests {
  boundary: {
    id: string;
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
  trail: {
    name: string;
    type: number;
    path_ids: string;
    bound: string;
    marker: string;
    length_meters: number;
  };
  trails_in_boundary: Array<{
    id: string;
    name: string;
    type: number;
    length_meters: number;
  }>;
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

