import * as corgi from 'js/corgi';

import { Boundary } from './models/types';

export function boundaryCrumbs(boundaries: Boundary[]): corgi.VElementOrPrimitive[] {
  const crumbs =
      [...boundaries]
          .sort((a, b) => a.type - b.type)
          .map(b => <a href={`/boundary/${b.id}`}>{b.name}</a>)
          .flatMap(l => [l, <span className="text-tc-gray-400">{' > '}</span>]);
  crumbs.pop();
  return crumbs;
}
