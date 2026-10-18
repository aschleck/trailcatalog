import { Future, resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import { floatCoalesce } from 'external/dev_april_corgi+/js/common/math';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import {
  setCanonicalPath,
  setDescription,
  setIndexable,
  setTitle,
} from 'external/dev_april_corgi+/js/server/ssr_aware';
import { MAP_MOVED, UNCLAIMED_CLICKED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';
import { GetCollectionResponse, Role } from 'trails_lat/proto/data_pb';

import { State, ViewerController } from './viewer_controller';
import { descriptionOf } from './collection_data';
import { requestData } from './data';
import { EditableFeature, folderFromProto, lineFromProto, pointFromProto } from './features';
import {
  FEATURE_CLICKED,
  FEATURE_CONTEXT_MENU,
  FEATURE_EDITED,
  FEATURE_HOVERED,
  LINE_DRAWN,
  MARKER_DRAWN,
  POINT_PLACED,
  TOOL_REQUESTED,
} from './events';
import {
  buildTree,
  FeatureTree,
  foldersOf,
  NewFolderButton,
  Properties,
  topLevelFolderIds,
} from './feature_list';
import { LayerTree } from './layer_tree';
import { formatDistance } from './measurements';
import { MeasurePanel } from './measure_panel';
import { parseCollectionSchema, getTitle } from './schema';
import { SidebarElement, SidebarSection } from './sidebar_element';
import { Menubar, MenubarItem } from './menubar';
import { EMPTY_SEARCH, SearchBox } from './search_box';
import { Toolbar } from './toolbar';
import { CollectionSchema } from './workers/collection_schema';

export const DEFAULT_DESCRIPTION = 'Mapping software for backcountry trip planning';

// Search results cut a description off at around this many characters.
const DESCRIPTION_CHARS = 155;

export function OverviewElement(
  {collection, parameters}: {
    collection: string|undefined;
    parameters: {[key: string]: string};
  },
  inState: State|undefined,
  updateState: (newState: State) => void,
) {
  const initial = !inState;
  if (!inState) {
    // Settled on the server's later render passes, and in the browser from the data the server
    // rendered with. ViewerController loads the geometry.
    const outline: Future<GetCollectionResponse>|undefined =
        collection
            ? requestData(
                'lat.trails.DataService/GetCollection', {id: collection, omitGeometry: true})
            : undefined;
    const loaded = outline?.finished && outline.ok ? outline.value() : undefined;
    const all = [
      ...(loaded?.folders ?? []).map(folderFromProto),
      ...(loaded?.lines ?? []).map(lineFromProto),
      ...(loaded?.points ?? []).map(pointFromProto),
    ];
    const hidden = new Set(loaded?.hiddenFeatureIds);
    const schema = parseCollectionSchema(loaded?.schema ?? '');
    inState = {
      collection: loaded?.collection,
      collectionStatus:
          !collection
              ? 'loaded'
              : !outline?.finished ? 'loading' : outline.ok ? 'loaded' : 'failed',
      features: {
        all,
        schema,
        selected: undefined,
        selectedDescendants: 0,
        hovered: undefined,
        hoveredAncestors: new Set(),
        hidden,
        expanded: new Set(topLevelFolderIds(all, schema, hidden)),
        dropTarget: undefined,
      },
      drawnLength: undefined,
      inspected: undefined,
      joining: false,
      layers: {nodes: [], expanded: new Set()},
      lineProfile: undefined,
      measure: {
        lengthMeters: 0,
        vertexCount: 0,
        profile: undefined,
        hovered: undefined,
        status: 'idle',
        route: undefined,
      },
      grades: {climbPercent: 25, descentPercent: 25},
      search: EMPTY_SEARCH,
      self: requestData('lat.trails.DataService/GetCurrentUser', {}),
      tool: 'pointer',
    };
  }
  const state = inState;
  const readOnly = state.collection?.role === Role.READ;
  const tree = buildTree(state.features.all, state.features.schema);
  setTitle(state.collection?.name ? `${state.collection.name} - trails.lat` : 'trails.lat');
  setDescription(
      descriptionOf(state.collection)
          || describe(state.collection?.name, state.features.all, state.features.schema));
  // The camera parameters would otherwise make every view of a collection its own page.
  setCanonicalPath(collection ? `/collection/${collection}` : '/');
  // A collection that failed to load is usually one a logged out crawler can't read.
  setIndexable(state.collectionStatus !== 'failed');

  if (!state.self.finished) {
    state.self.then(self => {
      updateState({
        ...state,
        self: resolvedFuture(self),
      });
    });
  }

  // A route without a camera, like a collection just opened, keeps the map where it is until the
  // collection loads and fits it.
  const fitCollection = !parameters.lat || !parameters.lng;
  let camera = undefined;
  if (!parameters._used && (initial || !fitCollection)) {
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
          args: {collection, fitCollection},
          events: {
            corgi: [
              [FEATURE_CLICKED, 'onFeatureClicked'],
              [FEATURE_CONTEXT_MENU, 'onFeatureContextMenu'],
              [FEATURE_EDITED, 'onFeatureEdited'],
              [FEATURE_HOVERED, 'onFeatureHovered'],
              [LINE_DRAWN, 'onLineDrawn'],
              [MARKER_DRAWN, 'onMarkerDrawn'],
              [MAP_MOVED, 'onMove'],
              [POINT_PLACED, 'onPointPlaced'],
              [TOOL_REQUESTED, 'onToolRequested'],
              [UNCLAIMED_CLICKED, 'onUnclaimedClicked'],
            ],
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="flex flex-col h-full relative"
    >
      <Menubar
          center={<SearchBox state={state.search} />}
          user={state.self.finished ? state.self.value().user : undefined}
      >
        <MenubarItem label="File" menu="file" onClick="menubarMenuClicked" />
        <MenubarItem label="Edit" menu="edit" onClick="menubarMenuClicked" />
        <MenubarItem label="View" menu="view" onClick="menubarMenuClicked" />
        <MenubarItem label="Help" menu="help" onClick="menubarMenuClicked" />
      </Menubar>
      <div className="flex flex-col grow min-h-0 md:flex-row">
        <div className="grow min-h-0 min-w-0 relative">
          <MapElement
              camera={camera}
              ref="map"
          />
          <Toolbar readOnly={readOnly} tool={state.tool} />
          {state.joining
              ? <div className="
                    -translate-x-1/2
                    absolute
                    bg-gray-900
                    left-1/2
                    pointer-events-none
                    px-3
                    py-1
                    rounded
                    shadow-lg
                    text-sm
                    text-white
                    top-2
                    z-10
                ">
                  Click another line to join it, or press Escape to cancel
                </div>
              : ''
          }
          {/*
            Spans the map's height so a tall dialog scrolls, and passes clicks to the map. On a
            narrow screen it spans the width instead and sits in the bottom part, below the
            toolbar. z-30 puts it over the map's copyright notice, which is z-20.
          */}
          <div className="
              absolute
              bottom-2
              flex
              flex-col
              gap-2
              justify-end
              left-2
              md:justify-start
              md:left-auto
              md:top-2
              md:w-80
              pointer-events-none
              right-2
              top-[40%]
              z-30
          ">
            {state.tool === 'measure' || state.tool === 'terrain'
                ? <MeasurePanel
                      grades={state.tool === 'terrain' ? state.grades : undefined}
                      state={state.measure}
                  />
                : ''
            }
            {state.features.selected
                ? <Properties
                      profile={state.lineProfile}
                      subject={{
                        source: 'feature',
                        feature: state.features.selected,
                        schema: state.features.schema,
                        editing: readOnly
                            ? undefined
                            : {
                              descendants: state.features.selectedDescendants,
                              // A folder cannot move into itself or anything under it
                              folders: foldersOf(tree, state.features.selected.id),
                            },
                      }}
                  />
                : state.inspected
                    ? <Properties
                          profile={state.lineProfile}
                          subject={{source: 'object', object: state.inspected}}
                      />
                    : ''
            }
          </div>
        </div>
        <SidebarElement>
          <SidebarSection controls={readOnly ? undefined : <NewFolderButton />} label="Features">
            <FeatureTree
                readOnly={readOnly}
                state={state.features}
                status={state.collectionStatus}
                tree={tree}
            />
          </SidebarSection>
          <SidebarSection label="Layers" open={false} persist="layers">
            <LayerTree state={state.layers} />
          </SidebarSection>
        </SidebarElement>
      </div>
      {state.drawnLength
          ? <div
                className="
                    absolute
                    bg-yellow-100
                    pointer-events-none
                    px-2
                    py-1
                    rounded
                    shadow
                    text-gray-900
                    text-sm
                    whitespace-nowrap
                    z-20
                "
                style={`left: ${state.drawnLength.x + 16}px; top: ${state.drawnLength.y + 16}px`}
            >
              {formatDistance(state.drawnLength.meters)}
            </div>
          : ''
      }
    </div>
  </>;
}

function describe(
    name: string|undefined, features: EditableFeature[], schema: CollectionSchema): string {
  if (!name) {
    return DEFAULT_DESCRIPTION;
  }

  let description = name;
  let separator = ': ';
  for (const feature of features) {
    const featureName = getTitle(schema, feature)?.trim();
    if (!featureName) {
      continue;
    }
    if (description.length + separator.length + featureName.length > DESCRIPTION_CHARS) {
      break;
    }
    description += separator + featureName;
    separator = ', ';
  }
  return description;
}
