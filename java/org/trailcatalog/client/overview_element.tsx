import * as corgi from 'js/corgi';
import { bind } from 'js/corgi/events';

import { MAP_MOVED } from './map/events';
import { MapElement } from './map/map_element';

import { OverviewController } from './overview_controller';

export function OverviewElement() {
  const url = new URL(window.location.href);
  const lat = floatCoalesce(url.searchParams.get('lat'), 46.859369);
  const lng = floatCoalesce(url.searchParams.get('lng'), -121.747888);
  const zoom = floatCoalesce(url.searchParams.get('zoom'), 12);

  return <>
    <div
        jscontroller={OverviewController}
        onEvents={[
          bind(MAP_MOVED, OverviewController.prototype.onMove),
        ]}
        className="flex h-screen w-screen"
    >
      <div>Sidebar</div>
      <MapElement lat={lat} lng={lng} zoom={zoom} />
    </div>
  </>;
};

function floatCoalesce(...numbers: Array<string|number|null>): number {
  for (const x of numbers) {
    const n = Number(x);
    if (!isNaN(n)) {
      return n;
    }
  }
  throw new Error('No valid floats');
}
