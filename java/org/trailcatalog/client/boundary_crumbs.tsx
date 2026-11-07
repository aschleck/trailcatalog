import { aDescendsB, RelationCategory } from 'java/org/trailcatalog/models/categories';
import * as corgi from 'external/dev_april_corgi+/js/corgi';

import { BoundaryLink } from './models/types';

export function BoundaryCrumbs({boundaries, name}: {boundaries: BoundaryLink[]; name: string}) {
  const crumbs =
      getCrumbBoundaries(boundaries, name)
          .map(b => <a href={`/boundary/${b.readableId}`} translate="no">{b.name}</a>)
          .flatMap(l => [
            l,
            ' › ',
          ]);
  crumbs.pop();
  return <>{crumbs}</>;
}

export function getMostSpecificCrumb(
    boundaries: BoundaryLink[], name: string): BoundaryLink|undefined {
  return getCrumbBoundaries(boundaries, name).at(-1);
}

// Orders the boundaries from the most general to the most specific.
function getCrumbBoundaries(boundaries: BoundaryLink[], name: string): BoundaryLink[] {
  return boundaries
      // a crag or climbing area isn't a place to file a trail or park under
      .filter(b => !aDescendsB(b.type, RelationCategory.BOUNDARY_CLIMBING))
      // a park drawn around the trail it's named for, like Bellingham's Railroad Trail
      .filter(b => b.name !== name)
      .sort((a, b) => crumbRank(a.type) - crumbRank(b.type) || a.type - b.type);
}

// Category ids count depth in the category tree, not geographic nesting. Administrative levels do
// nest by id (country 4226, state 4228, county 4230), but every other kind of boundary sits at its
// parent id and sorts ahead of all of them: BOUNDARY_PROTECTED_AREA is 69, so a park with no
// protect_class leads the crumbs instead of following the county that contains it.
function crumbRank(type: number): number {
  return aDescendsB(type, RelationCategory.BOUNDARY_ADMINISTRATIVE) ? 0 : 1;
}
