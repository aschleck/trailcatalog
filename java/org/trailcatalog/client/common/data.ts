import { deepEqual } from 'js/common/comparisons';

import { InitialDataKey, initialData } from './ssr_aware';

type AsObjects<T extends string[]> = {[K in keyof T]: object};
type KeyedTuples<T extends string[]> = {[K in keyof T]: [T[K], object]};

const MAX_CACHE_ENTRIES = 10;
const cache: Array<[object, object]> = [];

export function fetchDataBatch<T extends string[]>(tuples: KeyedTuples<T>):
    Promise<AsObjects<T>> {
  const missing: object[] = [];
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
      continue;
    }

    const withType = {...request, type};

    let cached = -1;
    for (let i = cache.length - 1; i >= 0; --i) {
      if (deepEqual(cache[i][0], withType)) {
        cached = i;
        break;
      }
    }

    if (cached >= 0) {
      const entry = cache[cached];
      data[i] = entry[1];
      cache.splice(cached, 1);
      cache.push(entry);
      continue;
    }

    missing.push(withType);
    missingIndices.push(i);
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
            const value = response.values[i];
            data[missingIndices[i]] = value;
            cache.push([missing[i], value]);
          }
          if (cache.length > MAX_CACHE_ENTRIES) {
            cache.splice(0, cache.length - MAX_CACHE_ENTRIES);
          }
          return data as AsObjects<T>;
        });
  }
}
