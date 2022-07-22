import { S2Polygon } from 'java/org/trailcatalog/s2';
import * as corgi from 'js/corgi';
import { FabricIcon } from 'js/dino/fabric';

import { currentUrl } from './common/ssr_aware';
import { MAP_MOVED } from './map/events';
import { MapElement } from './map/map_element';

import { LocationUrlController } from './location_url_controller';
import { SidebarController, State } from './sidebar_controller';

export function ViewportLayoutElement({camera, overlay, sidebarContent}: {
  camera?: {
    lat: number;
    lng: number;
    zoom: number;
  };
  overlay?: {
    content?: string;
    polygon?: S2Polygon;
  };
  sidebarContent: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      open: false,
    };
  }

  const url = currentUrl();
  const lat = floatCoalesce(url.searchParams.get('lat'), camera?.lat, 46.859369);
  const lng = floatCoalesce(url.searchParams.get('lng'), camera?.lng, -121.747888);
  const zoom = floatCoalesce(url.searchParams.get('zoom'), camera?.zoom, 12);

  return <>
    <div className="flex flex-col h-full">
      <div className="align-middle bg-tc-gray-200 flex gap-4 items-center leading-none p-4">
        <FabricIcon
            name="List"
            className={
                (state.open ? "bg-white" : "text-white")
                    + " text-3xl md:hidden"
            }
            js={corgi.bind({
              controller: SidebarController,
              events: {
                click: 'toggleSidebarOpen',
              },
              state: [state, updateState],
            })}
        />
        <img
            alt="Trailcatalog logo"
            src="/static/images/logo.svg"
            className="h-6"
        />
        <div className="flex grow justify-end">
          <a href="https://github.com/aschleck/trailcatalog" target="_blank">
            <img
                alt="Trailcatalog on GitHub"
                src="/static/images/github.png"
                className="h-6"
            />
          </a>
        </div>
      </div>
      <div className="flex grow overflow-hidden relative">
        <div className={
            (state.open ? "" : "hidden md:block ")
                + "absolute bg-white inset-0 max-h-full overflow-y-scroll z-10 md:relative md:w-80"
        }>
          {sidebarContent}
        </div>
        <div className="grow h-full relative">
          <div
              js={corgi.bind({
                controller: LocationUrlController,
                events: {
                  corgi: [
                    [MAP_MOVED, 'onMove'],
                  ],
                },
                state: [{}, () => {}],
              })}
              className="h-full"
          >
            <MapElement
                camera={{lat, lng, zoom}}
                overlay={overlay}
            />
          </div>
          {overlay?.content ?? <></>}
        </div>
      </div>
    </div>
  </>;
}

function floatCoalesce(...numbers: Array<string|number|null|undefined>): number {
  for (const x of numbers) {
    if (x === undefined || x === null) {
      continue;
    }
    const n = Number(x);
    if (!isNaN(n)) {
      return n;
    }
  }
  throw new Error('No valid floats');
}

