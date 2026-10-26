import { Future, resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import { floatCoalesce } from 'external/dev_april_corgi+/js/common/math';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import {
  setCanonicalPath,
  setDescription,
  setIndexable,
  setTitle,
} from 'external/dev_april_corgi+/js/server/ssr_aware';
import { LatLngRect, LatLngZoom } from 'js/map/common/types';
import { MAP_MOVED, UNCLAIMED_CLICKED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';
import { GetCollectionResponse } from 'trails_lat/proto/data_pb';

import { canEdit, descriptionOf } from './data/collection_data';
import { requestData } from './data/data';
import { startsCompact } from './layout';
import {
  COLLECTION_CREATED,
  COLLECTION_LOADED,
  COLLECTION_LOADING,
  CollectionModel,
  FEATURES_CHANGED,
  SAVE_FAILED,
} from './model/collection_model';
import {
  FEATURE_CLICKED,
  FEATURE_CONTEXT_MENU,
  FEATURE_EDITED,
  FEATURE_HOVERED,
  FEATURE_SAVED,
  LINE_DRAWN,
  MARKER_DRAWN,
  POINT_PLACED,
  POLYGON_DRAWN,
  SKY_PINS_MOVED,
  TOOL_REQUESTED,
} from './model/events';
import { EditableFeature, featuresFromProto } from './model/features';
import { parseCollectionSchema, getTitle } from './model/schema';
import { formatDistance } from './tools/measurements';
import {
  buildTree,
  FeatureTree,
  foldersOf,
  NewFolderButton,
  Properties,
  topLevelFolderIds,
} from './ui/feature_list';
import { layerEntries, LayerTree } from './ui/layer_tree';
import { AreaPanel, MeasurePanel } from './ui/measure_panel';
import { Menubar, MenubarItem } from './ui/menubar';
import {
  BottomSheet,
  CollectionChip,
  LayersSheet,
  LibraryPage,
  MapButtons,
  NavigationBar,
  SearchPage,
} from './ui/mobile_shell';
import { EMPTY_SEARCH, SearchBox } from './ui/search_box';
import { SidebarElement, SidebarSection } from './ui/sidebar_element';
import { Timeline } from './ui/timeline';
import { Toolbar } from './ui/toolbar';
import { State, ViewerController } from './viewer_controller';
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
  if (!inState) {
    // Settled on the server's later render passes, and in the browser from the data the server
    // rendered with. ViewerController loads the geometry.
    const outline: Future<GetCollectionResponse>|undefined =
        collection
            ? requestData(
                'lat.trails.DataService/GetCollection', {id: collection, omitGeometry: true})
            : undefined;
    const loaded = outline?.finished && outline.ok ? outline.value() : undefined;
    const all = featuresFromProto(loaded);
    const hidden = new Set(loaded?.hiddenFeatureIds);
    const schema = parseCollectionSchema(loaded?.schema ?? '');
    inState = {
      collection: loaded?.collection,
      // The outline leaves out geometry, which ViewerController loads next.
      collectionStatus:
          !collection ? 'loaded' : outline?.finished && !outline.ok ? 'failed' : 'loading',
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
      drawnArea: undefined,
      drawnLength: undefined,
      fileDragged: false,
      inspected: undefined,
      joining: undefined,
      layers: {nodes: [], expanded: new Set()},
      lineProfile: undefined,
      measure: {
        lengthMeters: 0,
        vertexCount: 0,
        profile: undefined,
        route: undefined,
      },
      notSaved: false,
      grades: {climbPercent: 25, descentPercent: 25},
      mobile: {
        compact: startsCompact(),
        tab: 'map',
        layersOpen: false,
        layersSegment: 'layers',
        toolsOpen: false,
        library: undefined,
      },
      search: EMPTY_SEARCH,
      self: requestData('lat.trails.DataService/GetCurrentUser', {}),
      // ViewerController fills in the clock and what the forecast reaches.
      time: {at: undefined, now: 0, start: 0, end: 0, playing: false, zone: undefined},
      tool: 'pointer',
    };
  }
  const state = inState;
  // The routed collection, which is undefined while it loads after the route changed
  const open = state.collection?.id === collection ? state.collection : undefined;
  // Loading replaces the store, so nothing is editable until the collection has loaded.
  const readOnly =
      collection !== undefined && (state.collectionStatus !== 'loaded' || !canEdit(open));
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

  // The URL's camera, or else the collection's bound once we know it. Panning rewrites the URL
  // without a route change, so the camera stays equal across renders and corgi doesn't hand it to
  // the map again.
  let camera: LatLngRect|LatLngZoom|undefined = undefined;
  if (parameters.lat && parameters.lng) {
    camera = {
      lat: Number(parameters.lat),
      lng: Number(parameters.lng),
      zoom: floatCoalesce(parameters.zoom, 12),
    };
  } else if (open?.bound) {
    const bound = open.bound;
    camera = {
      low: [bound.lowLatDegrees, bound.lowLngDegrees],
      high: [bound.highLatDegrees, bound.highLngDegrees],
      brand: 'LatLngRect',
    };
  }

  const measure =
      state.tool === 'measure'
              || state.tool === 'terrain'
              || (state.tool === 'line' && state.measure.vertexCount > 0)
          ? <MeasurePanel
                grades={state.grades}
                readOnly={readOnly}
                state={state.measure}
                tool={state.tool}
            />
          : state.drawnArea
              ? <AreaPanel ring={state.drawnArea} />
              : undefined;
  const details =
      state.features.selected
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
                    subject={{source: 'object', object: state.inspected, savable: !readOnly}}
                />
              : undefined;
  const features =
      <FeatureTree
          readOnly={readOnly}
          state={state.features}
          status={state.collectionStatus}
          tree={tree}
      />;
  const layers = <LayerTree state={state.layers} />;
  const user = state.self.finished ? state.self.value().user : undefined;
  const {compact, tab} = state.mobile;

  // The map stays first in the same parent in both layouts, or else switching between them would
  // replace the map and the controller ViewerController holds with it.
  return <>
    <div
        js={corgi.bind({
          controller: ViewerController,
          args: {collection},
          events: {
            corgi: [
              [COLLECTION_CREATED, 'onCollectionCreated'],
              [COLLECTION_LOADED, 'onCollectionLoaded'],
              [COLLECTION_LOADING, 'onCollectionLoading'],
              [FEATURE_CLICKED, 'onFeatureClicked'],
              [FEATURE_CONTEXT_MENU, 'onFeatureContextMenu'],
              [FEATURE_EDITED, 'onFeatureEdited'],
              [FEATURE_HOVERED, 'onFeatureHovered'],
              [FEATURE_SAVED, 'onFeatureSaved'],
              [FEATURES_CHANGED, 'onFeaturesChanged'],
              [LINE_DRAWN, 'onLineDrawn'],
              [MARKER_DRAWN, 'onMarkerDrawn'],
              [MAP_MOVED, 'onMove'],
              [POINT_PLACED, 'onPointPlaced'],
              [POLYGON_DRAWN, 'onPolygonDrawn'],
              [SAVE_FAILED, 'onSaveFailed'],
              [SKY_PINS_MOVED, 'onSkyPinsMoved'],
              [TOOL_REQUESTED, 'onToolRequested'],
              [UNCLAIMED_CLICKED, 'onUnclaimedClicked'],
            ],
            dragleave: 'filesDragLeft',
            dragover: 'filesDraggedOver',
            drop: 'filesDropped',
            render: 'wakeup',
          },
          model: CollectionModel,
          state: [state, updateState],
        })}
        className={
          'flex flex-col h-full relative' + (compact ? ' font-[system-ui,sans-serif]' : '')
        }
        // In the phone layout the map reaches under the status bar and the buttons inset themselves
        style={compact ? '' : 'padding-top: var(--inset-top)'}
    >
      {state.fileDragged ? <FileDropOverlay /> : ''}
      {compact
          ? ''
          : <Menubar
                center={<SearchBox state={state.search} />}
                notSaved={state.notSaved}
                user={user}
            >
              <MenubarItem label="File" menu="file" onClick="menubarMenuClicked" />
              <MenubarItem label="Edit" menu="edit" onClick="menubarMenuClicked" />
              <MenubarItem label="View" menu="view" onClick="menubarMenuClicked" />
              <MenubarItem label="Help" menu="help" onClick="menubarMenuClicked" />
            </Menubar>
      }
      <div className="flex flex-col grow min-h-0 md:flex-row relative">
        <div className="grow min-h-0 min-w-0 relative">
          <MapElement
              camera={camera}
              compactCopyright={compact}
              ref="map"
          />
          {compact
              ? <MapButtons
                    layersOpen={state.mobile.layersOpen}
                    readOnly={readOnly}
                    tool={state.tool}
                    toolsOpen={state.mobile.toolsOpen}
                    user={user}
                />
              : <Toolbar readOnly={readOnly} tool={state.tool} />
          }
          {layerEntries(state.layers.nodes)
                  .some(({entry, shown}) => shown && entry.timed !== undefined)
              ? <Timeline state={state.time} />
              : ''
          }
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
          {compact
              ? <>
                  {state.collection
                      ? <CollectionChip name={state.collection.name || 'Untitled collection'} />
                      : ''
                  }
                  {details ? <BottomSheet initial="half">{details}</BottomSheet> : ''}
                  {measure ? <BottomSheet initial="peek">{measure}</BottomSheet> : ''}
                  {state.mobile.layersOpen
                      ? <LayersSheet
                            collection={state.collection ? features : undefined}
                            layers={layers}
                            segment={state.mobile.layersSegment}
                        />
                      : ''
                  }
                  {tab === 'search' ? <SearchPage state={state.search} /> : ''}
                  {tab === 'library'
                      ? <LibraryPage library={state.mobile.library} user={user} />
                      : ''
                  }
                </>
              : <>
                  {/*
                    Spans the map's height so a tall dialog scrolls, and passes clicks to the map.
                    On a narrow screen it spans the width instead and sits in the bottom part,
                    below the toolbar. z-30 puts it over the map's copyright notice, which is z-20.
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
                    {measure ?? ''}
                    {details ?? ''}
                  </div>
                </>
          }
        </div>
        {compact
            ? ''
            : <SidebarElement>
                <SidebarSection
                    controls={readOnly ? undefined : <NewFolderButton />}
                    label="Features"
                >
                  {features}
                </SidebarSection>
                <SidebarSection label="Layers" open={false} persist="layers">
                  {layers}
                </SidebarSection>
              </SidebarElement>
        }
      </div>
      {compact ? <NavigationBar tab={tab} /> : ''}
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

// Lets the drop land on whatever is under it, so the viewer's own drop handler still runs.
function FileDropOverlay() {
  return (
    <div className="
        absolute
        bg-blue-500/10
        border-2
        border-blue-500
        border-dashed
        flex
        inset-0
        items-center
        justify-center
        pointer-events-none
        z-50
    ">
      <div className="bg-white px-4 py-2 rounded shadow-lg text-gray-900">
        Drop photos, GPX, or GeoJSON to import
      </div>
    </div>
  );
}
