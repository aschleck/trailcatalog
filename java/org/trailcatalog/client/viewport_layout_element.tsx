import * as corgi from 'js/corgi';

import { MAP_MOVED } from './map/events';
import { MapElement } from './map/map_element';

import { LocationUrlController } from './location_url_controller';
import { SidebarController, State } from './sidebar_controller';

export function ViewportLayoutElement({filter, mapOverlay, sidebarContent}: {
  filter?: {
    boundary?: number;
  };
  mapOverlay?: string;
  sidebarContent: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      open: false,
    };
  }

  const url = new URL(window.location.href);
  const lat = floatCoalesce(url.searchParams.get('lat'), 46.859369);
  const lng = floatCoalesce(url.searchParams.get('lng'), -121.747888);
  const zoom = floatCoalesce(url.searchParams.get('zoom'), 12);

  return <>
    <div className="flex flex-col h-full">
      <div className="align-middle bg-tc-gray-200 leading-none">
        <FabricIcon
            name="List"
            className={
                (state.open ? "bg-white" : "text-white")
                    + " p-2 text-3xl md:hidden"
            }
            js={corgi.bind({
              controller: SidebarController,
              events: {
                click: 'toggleSidebarOpen',
              },
              state: [state, updateState],
            })}
        />
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
            <MapElement camera={{lat, lng, zoom}} filter={filter} />
          </div>
          {mapOverlay ?? <></>}
        </div>
      </div>
    </div>
  </>;
}

function floatCoalesce(...numbers: Array<string|number|null>): number {
  for (const x of numbers) {
    if (x == undefined || x === null) {
      continue;
    }
    const n = Number(x);
    if (!isNaN(n)) {
      return n;
    }
  }
  throw new Error('No valid floats');
}

type FabricIconName = 'List';

function FabricIcon({
  name,
  className,
  ...props
}: {name: FabricIconName} & corgi.Properties<HTMLElement>) {
  return <i className={`ms-Icon ms-Icon--${name} ${className}`} {...props} />;
}
