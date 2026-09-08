import { resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import { floatCoalesce } from 'external/dev_april_corgi+/js/common/math';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { MAP_MOVED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';

import { State, ViewerController } from './viewer_controller';
import { requestData } from './data';
import { HOVER_CHANGED } from './events';
import { Menubar, MenubarItem } from './menubar';
import { Toolbar } from './toolbar';

export function OverviewElement(
  {collection, parameters}: {
    collection: string|undefined;
    parameters: {[key: string]: string};
  },
  inState: State|undefined,
  updateState: (newState: State) => void,
) {
  if (!inState) {
    inState = {
      collection: undefined,
      layers: [],
      self: requestData('lat.trails.DataService/GetCurrentUser', {}),
      tool: 'pointer',
    };
  }
  const state = inState;

  if (!state.self.finished) {
    state.self.then(self => {
      updateState({
        ...state,
        self: resolvedFuture(self),
      });
    });
  }

  let camera = undefined;
  if (!parameters._used) {
    parameters._used = "true";
    camera = {
      lat: floatCoalesce(parameters.lat, 46.859369),
      lng: floatCoalesce(parameters.lng, -121.747888),
      zoom: floatCoalesce(parameters.zoom, 12),
    };
  }

  return <>
    <div
        js={corgi.bind({
          controller: ViewerController,
          args: {collection},
          events: {
            corgi: [
              [HOVER_CHANGED, 'onHoverChange'],
              [MAP_MOVED, 'onMove'],
            ],
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="flex flex-col h-full relative"
    >
      <Menubar user={state.self.finished ? state.self.value().user : undefined}>
        <MenubarItem label="File" onClick="fileMenuClicked" />
        <MenubarItem label="Layers" onClick="layersMenuClicked" />
      </Menubar>
      <div className="grow min-h-0 relative">
        <MapElement
            camera={camera}
            ref="map"
        />
        <Toolbar tool={state.tool} />
      </div>
    </div>
  </>;
}
