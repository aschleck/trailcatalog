import * as corgi from 'js/corgi';

import { Boundary } from './models/types';

interface SimpleBoundary {
  id: bigint|string;
  name: string;
  type: number;
}

export function BoundaryCrumbs({boundaries}: {boundaries: SimpleBoundary[]}) {
  const crumbs =
      [...boundaries]
          .sort((a, b) => a.type - b.type)
          .map(b => <a href={`/boundary/${b.id}`}>{b.name}</a>)
          .flatMap(l => [
            l,
            ' › ',
          ]);
  crumbs.pop();
  return <>{crumbs}</>;
}
