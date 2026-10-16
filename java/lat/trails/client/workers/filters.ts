import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { aDescendsB } from 'java/org/trailcatalog/models/categories';

// Kept apart from collection_loader.ts because importing that runs a worker.

export interface AlwaysMatch {
  match: 'always';
}

export interface StringEqualsMatch {
  match: 'string_equals';
  key: string;
  value: string;
}

// Categories are a tree packed into an int, so naming a parent takes everything under it. See
// Categories.kt.
export interface CategoryInMatch {
  match: 'category_in';
  key: string;
  value: number[];
}

export type Match = AlwaysMatch|CategoryInMatch|StringEqualsMatch;

export function matches(data: {[key: string]: unknown}, filters: Match[]): boolean {
  for (const filter of filters) {
    if (!matchesOne(data, filter)) {
      return false;
    }
  }
  return true;
}

function matchesOne(data: {[key: string]: unknown}, filter: Match): boolean {
  switch (filter.match) {
    case 'always':
      return true;
    case 'category_in':
      const category = data[filter.key];
      if (typeof category !== 'number') {
        return false;
      }
      return filter.value.some(parent => aDescendsB(category, parent));
    case 'string_equals':
      return data[filter.key] === filter.value;
    default:
      throw checkExhaustive(filter);
  }
}
