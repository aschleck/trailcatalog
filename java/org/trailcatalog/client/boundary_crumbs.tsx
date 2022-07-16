import * as corgi from 'js/corgi';
import { Link } from 'js/corgi/history/link_element';

import { Boundary } from './models/types';

export function BoundaryCrumbs({boundaries}: {boundaries: Boundary[]}) {
  const crumbs =
      [...boundaries]
          .sort((a, b) => a.type - b.type)
          .map(b => <Link href={`/boundary/${b.id}`}>{b.name}</Link>)
          .flatMap(l => [l, <span className="text-tc-gray-400">{' > '}</span>]);
  crumbs.pop();
  return <>{crumbs}</>;
}
