import * as corgi from 'js/corgi';

import { MapElement } from './map/map_element';

export function OverviewElement() {
  return <div className="flex h-screen w-screen">
    <div>Sidebar</div>
    <MapElement lat={46.859369} lng={-121.747888} zoom={12} />
  </div>;
};
