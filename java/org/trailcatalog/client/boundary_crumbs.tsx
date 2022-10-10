import * as corgi from 'js/corgi';
import { Link } from 'js/corgi/history/link_element';
import { FabricIcon } from 'js/dino/fabric';

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
          .map(b => <Link href={`/search?boundary=${b.id}`}>{b.name}</Link>)
          .flatMap(l => [
            l,
            <FabricIcon name="ChevronRight" className="px-1 text-[0.75em]" />,
          ]);
  crumbs.pop();
  return <>{crumbs}</>;
}
