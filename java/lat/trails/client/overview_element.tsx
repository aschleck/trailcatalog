import { resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import { floatCoalesce } from 'external/dev_april_corgi+/js/common/math';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { MAP_MOVED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';

import { State, ViewerController } from './viewer_controller';
import { requestData } from './data';
import {
  FEATURE_CLICKED,
  FEATURE_EDITED,
  FEATURE_HOVERED,
  HOVER_CHANGED,
  LINE_DRAWN,
  POINT_PLACED,
  TOOL_REQUESTED,
} from './events';
import { FeatureProperties, FeatureTree, LayerList, NewFolderButton } from './feature_list';
import { MeasurePanel } from './measure_panel';
import { SidebarElement, SidebarSection } from './sidebar_element';
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
      features: {
        tree: [],
        folders: [],
        selected: undefined,
        selectedDescendants: 0,
        hovered: undefined,
        hoveredAncestors: new Set(),
        hidden: new Set(),
        expanded: new Set(),
      },
      layers: [],
      measure: {
        lengthMeters: 0,
        vertexCount: 0,
        profile: undefined,
        hovered: undefined,
        status: 'idle',
      },
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
              [FEATURE_CLICKED, 'onFeatureClicked'],
              [FEATURE_EDITED, 'onFeatureEdited'],
              [FEATURE_HOVERED, 'onFeatureHovered'],
              [HOVER_CHANGED, 'onHoverChange'],
              [LINE_DRAWN, 'onLineDrawn'],
              [MAP_MOVED, 'onMove'],
              [POINT_PLACED, 'onPointPlaced'],
              [TOOL_REQUESTED, 'onToolRequested'],
            ],
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="flex flex-col h-full relative"
    >
      <Menubar user={state.self.finished ? state.self.value().user : undefined}>
        <MenubarItem label="File" onClick="fileMenuClicked" />
      </Menubar>
      <div className="flex grow min-h-0">
        <div className="grow min-w-0 relative">
          <MapElement
              camera={camera}
              ref="map"
          />
          <Toolbar tool={state.tool} />
          {state.tool === 'measure' ? <MeasurePanel state={state.measure} /> : ''}
        </div>
        <SidebarElement>
          <SidebarSection
              controls={<NewFolderButton />}
              footer={
                state.features.selected
                    ? <FeatureProperties
                          feature={state.features.selected}
                          folders={state.features.folders}
                          descendants={state.features.selectedDescendants}
                      />
                    : ''
              }
              label="Features"
          >
            <FeatureTree state={state.features} />
          </SidebarSection>
          <SidebarSection label="Layers" open={false}>
            <LayerList layers={state.layers} />
          </SidebarSection>
        </SidebarElement>
      </div>
    </div>
  </>;
}
