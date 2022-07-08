import { InitialDataKey, initialData } from './ssr_aware';

type AsObjects<T extends string[]> = {[K in keyof T]: object};
type KeyedTuples<T extends string[]> = {[K in keyof T]: [T[K], object]};

export function fetchDataBatch<T extends string[]>(tuples: KeyedTuples<T>):
    Promise<AsObjects<T>> {
  const missing = [];
  const missingIndices: number[] = [];
  const data: object[] = [];
  for (let i = 0; i < tuples.length; ++i) {
    const [type, request] = tuples[i];
    const initial = initialData({
      ...request,
      type,
    });
    if (initial) {
      data[i] = initial;
    } else {
      missing.push({...request, type});
      missingIndices.push(i);
    }
  }

  if (missing.length === 0) {
    return Promise.resolve(data as AsObjects<T>);
  } else {
    return fetch('/api/data', {
      method: 'POST',
      body: JSON.stringify({keys: missing}),
    })
        .then(response => response.json())
        .then(response => {
          for (let i = 0; i < response.values.length; ++i) {
            data[missingIndices[i]] = response.values[i];
          }
          return data as AsObjects<T>;
        });
  }
}
