import { aDescendsB, RelationCategory } from 'java/org/trailcatalog/models/categories';
import * as corgi from 'external/dev_april_corgi+/js/corgi';

import { Boundary } from './models/types';

interface SimpleBoundary {
  id: bigint|string;
  name: string;
  type: number;
}

export function BoundaryCrumbs({boundaries}: {boundaries: SimpleBoundary[]}) {
  const crumbs =
      [...boundaries]
          .sort((a, b) => crumbRank(a.type) - crumbRank(b.type) || a.type - b.type)
          .map(b => <a href={`/boundary/${b.id}`}>{b.name}</a>)
          .flatMap(l => [
            l,
            ' › ',
          ]);
  crumbs.pop();
  return <>{crumbs}</>;
}

// Category ids count depth in the category tree, not geographic nesting. Administrative levels do
// nest by id (country 4226, state 4228, county 4230), but every other kind of boundary sits at its
// parent id and sorts ahead of all of them: BOUNDARY_PROTECTED_AREA is 69, so a park with no
// protect_class leads the crumbs instead of following the county that contains it.
function crumbRank(type: number): number {
  return aDescendsB(type, RelationCategory.BOUNDARY_ADMINISTRATIVE) ? 0 : 1;
}
