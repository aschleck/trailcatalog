import * as corgi from 'js/corgi';
import { bind } from 'js/corgi/events';

import { MAP_MOVED } from './map/events';
import { MapElement } from './map/map_element';

import { OverviewController } from './overview_controller';

export function OverviewElement() {
  return <>
    <div
        jscontroller={OverviewController}
        onEvents={[
          bind(MAP_MOVED, OverviewController.prototype.onMove),
        ]}
        className="flex h-screen w-screen"
    >
      <div>Sidebar</div>
      <MapElement lat={46.859369} lng={-121.747888} zoom={12} />
    </div>
  </>;
};
