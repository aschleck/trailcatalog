import { checkExhaustive, checkExists, exists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';
import { Timer } from 'external/dev_april_corgi+/js/common/timer';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { CorgiEvent, DOM_MOUSE, DOM_POINTER } from 'external/dev_april_corgi+/js/corgi/events';
import { HistoryService } from 'external/dev_april_corgi+/js/corgi/history/history_service';
import { DialogService } from 'external/dev_april_corgi+/js/emu/dialog';
import { ACTION, CHANGED } from 'external/dev_april_corgi+/js/emu/events';
import { MenuEntries } from 'external/dev_april_corgi+/js/emu/menu/menu_controller';
import { MenuService } from 'external/dev_april_corgi+/js/emu/menu/menu_service';

import { S2LatLng } from 'java/org/trailcatalog/s2';
import { projectS2LatLng, unprojectS2LatLng } from 'js/map/camera';
import { RgbaU32, Vec2 } from 'js/map/common/types';
import { CLICKED, MAP_MOVED } from 'js/map/events';
import { Layer } from 'js/map/layer';
import { SkyboxLayer } from 'js/map/layers/skybox_layer';
import { MapController } from 'js/map/map_controller';
import { EarthSearchLayer } from 'js/map/layers/earth_search_layer';
import { MbtileLayer, CONTOURS_FEET, CONTOURS_METERS } from 'js/map/layers/mbtile_layer';
import { RasterTileLayer } from 'js/map/layers/raster_tile_layer';
import { Search } from 'js/map/workers/earth_search_loader';
import { Elevations } from 'js/map/workers/elevations';
import { Style } from 'js/map/workers/mbtile_loader';
import { LocationIndex } from 'js/map/workers/location_index';
import { Z_BASE_SATELLITE, Z_BASE_TERRAIN, Z_BOTTOM, Z_OVERLAY_TERRAIN } from 'js/map/z';
import { getUnitSystem, setUnitSystem, UnitSystem } from 'js/units/formatters';
import {
  Collection,
  CreateCollectionResponse,
  DeleteCollectionResponse,
  GetCollectionResponse,
  GetCurrentUserResponse,
  GetOsmTagsResponse,
  ListCollectionsResponse,
  Role,
  SaveResponse,
  SetViewStateResponse,
  OsmElementType,
} from 'trails_lat/proto/data_pb';

import { CollectionLayer } from './collection_layer';
import {
  BASEMAP_LABEL_KINDS,
  basemapOf,
  NATURE_PROTOMAPS,
  NODE_KINDS,
  OSM_WAYS,
  osmWaysOf,
  PUBLIC_LAND,
  WAY_KINDS,
} from './styles';
import { invalidateCurrentUser, requestData } from './data';
import {
  ConfirmDeleteCollectionDialog,
  ConfirmDeleteDialog,
  ImportFailedDialog,
  SaveFailedDialog,
} from './dialogs';
import { DrawingLayer, toE7Array } from './drawing_layer';
import {
  FEATURE_CLICKED,
  FEATURE_CONTEXT_MENU,
  FEATURE_EDITED,
  FEATURE_HOVERED,
  LayerObject,
  LINE_DRAWN,
  LineSpot,
  MARKER_DRAWN,
  OBJECT_OPENED,
  POINT_PLACED,
  Tool,
  TOOL_REQUESTED,
} from './events';
import { toGeoJson, toGpx } from './exporter';
import { FeatureLayer } from './feature_layer';
import {
  CollectionStatus,
  FeatureListState,
  InspectedObject,
  topLevelFolderIds,
} from './feature_list';
import { Change, FeatureStore } from './feature_store';
import {
  DEFAULT_POINT_COLOR,
  EditableFeature,
  EditableLine,
  FeatureData,
  folderFromProto,
  importableIcon,
  isMarker,
  lineFromProto,
  pointFromProto,
  snapshot,
  toWrite,
} from './features';
import { parseImport } from './importer';
import {
  ControlValues,
  findLayerNode,
  LayerEntry,
  layerEntries,
  LayerNode,
  LayerTreeState,
  sortLayerNodes,
  updateLayerNode,
} from './layer_tree';
import { insertVertex, joinLines, removeVertex, reverseLine, splitLine } from './line_edits';
import { IconPickerDialog } from './icon_picker';
import { GradeLimitState, MeasureState } from './measure_panel';
import { PointCollectionLayer } from './point_collection_layer';
import { PointToolLayer } from './point_tool_layer';
import { OSM_NODES_SCHEMA, OSM_WAYS_SCHEMA, PUBLIC_LAND_SCHEMA, Schema } from './schema';
import {
  cumulativeMeters,
  pathLengthMeters,
  profileSamples,
  ProfileSamples,
  profileStats,
  slopeMeters,
} from './measurements';
import { MarkerToolLayer } from './marker_tool_layer';
import { MENU_CLASSES } from './menubar';
import { LineProfileState } from './profile_chart';
import { SaveEntry, SaveQueue } from './save_queue';
import { RenameDialog } from './rename_dialog';
import { ShareDialog } from './share_dialog';

const MAPTERHORN_COPYRIGHT = {
  long: 'Mapterhorn',
  short: 'Mapterhorn',
  url: 'https://mapterhorn.com/attribution',
};
// No short form, so that it shows in the full list and leaves the credit bar to Mapterhorn
const COPERNICUS_COPYRIGHT = {
  long: 'Contains modified Copernicus Sentinel data 2021',
};
// The zoom where the contours and the trails around a point come in at full detail
const POINT_ZOOM = 14;
// Where trailcatalog starts drawing its points, see trail_layer.ts#RENDER_POINT_ZOOM_THRESHOLD
const POINT_ICON_ZOOM = 14;

// Flattens the points and line vertices of some features into lat,lng pairs in degrees.
function featureLatLngDegrees(features: Iterable<EditableFeature>): number[] {
  const latLngDegrees = [];
  for (const feature of features) {
    if (feature.kind === 'point') {
      latLngDegrees.push(feature.latE7 / 1e7, feature.lngE7 / 1e7);
    } else if (feature.kind === 'line') {
      for (let i = 0; i < feature.latLngE7.length; i += 2) {
        latLngDegrees.push(feature.latLngE7[i] / 1e7, feature.latLngE7[i + 1] / 1e7);
      }
    }
  }
  return latLngDegrees;
}

export interface Args {
  // The id of the open collection or none
  collection: string|undefined;
  // Whether to move the camera onto the collection once it loads, which a camera in the URL
  // overrides
  fitCollection: boolean;
}

export interface State {
  collection: Collection|undefined;
  collectionStatus: CollectionStatus;
  features: FeatureListState;
  // The map layer object open in the dialog, when no feature is selected
  inspected: InspectedObject|undefined;
  // How far the line or measurement under construction reaches, shown beside the pointer. In
  // pixels from the viewer's top left.
  drawnLength: {x: number; y: number; meters: number}|undefined;
  // Set while the next line clicked joins the one Join with started from
  joining: boolean;
  layers: LayerTreeState;
  // The profile of the selected feature or the inspected object, when that is a line
  lineProfile: LineProfileState|undefined;
  measure: MeasureState;
  // What the terrain tool routes within
  grades: GradeLimitState;
  self: Future<GetCurrentUserResponse>;
  tool: Tool;
}

type Deps = typeof ViewerController.deps;

export class ViewerController extends Controller<Args, Deps, HTMLElement, State> {

  static deps() {
    return {
      controllers: {
        map: MapController,
      },
      services: {
        dialog: DialogService,
        history: HistoryService,
        menu: MenuService,
      },
    };
  }

  private readonly mapController: MapController;
  private readonly dialog: DialogService;
  private readonly history: HistoryService;
  private readonly menu: MenuService;
  private readonly featureLayer: FeatureLayer;
  private readonly lineLayer: DrawingLayer;
  private readonly measureLayer: DrawingLayer;
  private readonly terrainLayer: DrawingLayer;
  private readonly pointLayer: PointToolLayer;
  private readonly markerLayer: MarkerToolLayer;
  private readonly skyboxLayer: SkyboxLayer;
  private readonly contours: Record<UnitSystem, MbtileLayer>;
  private readonly store: FeatureStore;
  private readonly elevations: Elevations;
  // Waits for the pointer to settle before sampling, because the measure tool redraws its cursor
  // segment on every move and each profile fetches tiles.
  private readonly profileDebouncer: Debouncer;
  // The samples behind the profile on screen, so hovering it can find the spot on the map
  private measureSamples: ProfileSamples|undefined;
  // Moves with every profile asked for, so that a slow answer for an old drawing is dropped
  private profileGeneration: number;
  // The placed path the length and profile describe
  private measuredPath: Float64Array|undefined;
  // The selected line's arrays as of its profile, which an edit replaces with new ones
  private lineProfileSource: {
    latLngE7: Int32Array;
    elevationCentimeters: Int32Array|undefined;
  }|undefined;
  // The samples behind the line profile on screen, like measureSamples
  private lineSamples: {latLngDegrees: Float64Array; distanceMeters: Float64Array}|undefined;
  // Moves with every line profile asked for, so that a slow answer for another line is dropped
  private lineProfileGeneration: number;
  private selected: string|undefined;
  // Kept for centering on, which needs the geometry the dialog's state leaves out
  private inspected: LayerObject|undefined;
  // Moves with every object opened or closed, so that tags arriving for an earlier one are dropped
  private inspectGeneration: number;
  // Moves with every collection opened or created, so that a slow load of an earlier one is dropped
  private collectionGeneration: number;
  // The feature being dragged in the list, and the folder it would drop into, where undefined is
  // the root
  private draggedFeature: string|undefined;
  private dropTarget: {folder: string|undefined}|undefined;
  // The line Join with started from
  private joining: string|undefined;
  // Where the pointer last was, in pixels from the viewer's top left
  private pointer: [number, number]|undefined;
  // Logins run in a popup on Google's origin, so a caller waiting on one waits on this.
  private login: {
    popup: Window;
    promise: Promise<void>;
    resolve: () => void;
    reject: (e: unknown) => void;
  }|undefined;
  private readonly loginWatcher: Timer;
  private readonly saves: SaveQueue;
  // Serialized so that an older view state cannot land after a newer one
  private viewStateWrites: Promise<void>;
  // The menubar item whose menu is open or loading. A File menu still waiting on ListCollections
  // when another menu takes over sees it change and stays closed.
  private menuTrigger: Element|undefined;
  // What MenuService#open appended, so the menubar can close it
  private menuOverlay: Element|undefined;
  // A failure the dialog is already up for stays quiet, or else every retry that fails for the
  // same reason stacks another one on the page.
  private warnedUnsaved: boolean;
  lastChange: number;

  constructor(response: Response<ViewerController>) {
    super(response);
    this.mapController = response.deps.controllers.map;
    this.dialog = response.deps.services.dialog;
    this.history = response.deps.services.history;
    this.menu = response.deps.services.menu;
    this.saves = new SaveQueue(entries => this.save(entries), e => {
      console.error(e);
      this.warnUnsaved();
    });
    this.store = new FeatureStore(this.saves);
    this.viewStateWrites = Promise.resolve();
    this.elevations = new Elevations();
    this.profileDebouncer = new Debouncer(/* delayMs= */ 150, () => {
      this.sampleProfile();
    });
    this.measureSamples = undefined;
    this.profileGeneration = 0;
    this.measuredPath = undefined;
    this.lineProfileSource = undefined;
    this.lineSamples = undefined;
    this.lineProfileGeneration = 0;
    this.selected = undefined;
    this.inspected = undefined;
    this.inspectGeneration = 0;
    this.collectionGeneration = 0;
    this.draggedFeature = undefined;
    this.dropTarget = undefined;
    this.joining = undefined;
    this.pointer = undefined;
    this.store.listen(() => {
      this.refreshFeatureList();
    });
    this.warnedUnsaved = false;
    this.menuTrigger = undefined;
    this.menuOverlay = undefined;
    this.lastChange = Date.now();

    // The popup runs on another origin, so the only thing we can see about it is that it closed.
    this.loginWatcher = new Timer(250 /* ms */, () => {
      const login = this.login;
      if (login && !login.popup.closed) {
        return;
      }

      this.loginWatcher.stop();
      this.login = undefined;
      invalidateCurrentUser();
      const self: Future<GetCurrentUserResponse> =
          requestData('lat.trails.DataService/GetCurrentUser', {});
      this.updateState({
        ...this.state,
        self,
      });
      if (login) {
        // Callers wait on login.promise, so it has to settle even when the user fetch fails, or
        // else the write queue behind it never runs again.
        self.then(response => {
          if (response.user) {
            login.resolve();
            this.saves.flush();
          } else {
            login.reject(new Error('Nobody signed in'));
          }
        }).catch(e => {
          login.reject(e);
        });
      }
    });
    this.registerDisposable(this.loginWatcher);

    // One index for every layer, so that the drawing tools snap onto and route across drawn
    // lines and paths alike.
    const locations = new LocationIndex();
    const camera = this.mapController.camera;
    const renderer = this.mapController.renderer;
    this.featureLayer = new FeatureLayer(this.store, locations, camera, renderer);
    this.registerDisposable(this.featureLayer);
    this.featureLayer.setHidden(this.state.features.hidden);
    this.lineLayer =
        new DrawingLayer(
            'line',
            locations,
            camera,
            renderer,
            () => {
              this.drawnLengthChanged();
            });
    this.registerDisposable(this.lineLayer);
    this.measureLayer =
        new DrawingLayer(
            'measure',
            locations,
            camera,
            renderer,
            () => {
              this.measureChanged();
              this.drawnLengthChanged();
            },
            [MAPTERHORN_COPYRIGHT]);
    this.registerDisposable(this.measureLayer);
    // A line mode, because finishing a route is how to keep it
    this.terrainLayer =
        new DrawingLayer(
            'line',
            locations,
            camera,
            renderer,
            () => {
              this.measureChanged();
              this.drawnLengthChanged();
            },
            [MAPTERHORN_COPYRIGHT],
            (from, to) => {
              const {climbPercent, descentPercent} = this.state.grades;
              return this.elevations.route(
                  from, to, {climb: climbPercent / 100, descent: descentPercent / 100});
            });
    this.registerDisposable(this.terrainLayer);
    this.pointLayer = new PointToolLayer();
    this.registerDisposable(this.pointLayer);
    this.markerLayer = new MarkerToolLayer(camera, renderer);
    this.registerDisposable(this.markerLayer);

    this.registerListener(window, 'keydown', e => {
      this.keyPressed(e);
    });
    // On the root, which hears a move before the map's own listener on document does, so the
    // drawing's change sees where the pointer is now.
    this.registerListener(this.root, 'pointermove', e => {
      const bounds = this.root.getBoundingClientRect();
      this.pointer = [e.clientX - bounds.left, e.clientY - bounds.top];
    });

    this.skyboxLayer = new SkyboxLayer(Z_BOTTOM, this.mapController.renderer);
    this.registerDisposable(this.skyboxLayer);

    this.contours = {
      imperial: this.newContourLayer(CONTOURS_FEET),
      metric: this.newContourLayer(CONTOURS_METERS),
    };

    const ways =
        new CollectionLayer(
            '/api/collections/00000000-0000-0000-0000-000000000001',
            OSM_WAYS,
            [
              // Snap to about a pixel at each zoom, which is level z + 6. A level L cell's half
              // diagonal is 0.388 * 2^-L in Mercator units and a pixel at zoom z is 2^-(z+7).
              //
              // This is where most of the geometry goes: consecutive OSM nodes on a path sit about
              // 15 m apart, against 38 m to the pixel at zoom 12.
              //
              // One band per zoom is cheap because zooming out reuses what is already held. Only
              // zooming in asks for a finer snap, and a finer snap is a different URL.
              {minZoom: 0, snap: 16},
              {minZoom: 11, snap: 17},
              {minZoom: 12, snap: 18},
              {minZoom: 13, snap: 19},
              {minZoom: 14, snap: 20},
              {minZoom: 15, snap: undefined},
            ],
            [
              // Tile at zoom - 2, which holds requests near 50 and offscreen reach near 5x at every
              // zoom. Requests go as the viewport divided by the tile and reach goes as the tile
              // divided by the viewport, so a fixed bottom loses at one end or the other: bottom 11
              // costs 903 requests at zoom 10 and reaches 30x at zoom 15.
              //
              // Only the tiling moves between bands. They all carry levels 11 and deeper, so
              // crossing a zoom boundary can never leave a level uncovered.
              //
              // Level 9 is the coarsest safe tiling. The worst level 9 cell on the planet is
              // central Berlin at 221k paths for 3.7 MB, against 94k at level 10 and 34k at level
              // 11.
              {minZoom: 10, maxZoom: 12, indexBottom: 9, fromLevel: 11, toLevel: undefined},
              {minZoom: 12, maxZoom: 14, indexBottom: 10, fromLevel: 11, toLevel: undefined},
              {minZoom: 14, maxZoom: undefined, indexBottom: 11, fromLevel: 11, toLevel: undefined},
              // Carry the long ways separately, or a river keeps its short ways and loses the long
              // stretches of its mainstem. A way is assigned to the smallest cell containing it and
              // a range query only reaches cells at or below its own level, so nothing above can
              // pick these up. 153k paths sit above level 10, 42% of them waterways, and the share
              // climbs with length: 87 of the 101 paths at level 4.
              //
              // Tile the two ends differently because they cost differently. Levels 0 to 8 are
              // rare enough for level 4, where the worst tile on the planet holds 188 and a real
              // one runs about 25 kb. Levels 9 and 10 are 25x more numerous, so they need level 7
              // for 9 to 42 kb against the 1.5 MB a level 4 tile of them costs.
              //
              // fromLevel 0 buys the 18 ways above level 4 for 8 to 19 ancestor requests a
              // viewport. They are ferry routes and a rail line, and a layer that draws every way
              // draws those.
              {minZoom: 10, maxZoom: undefined, indexBottom: 4, fromLevel: 0, toLevel: 8},
              {minZoom: 10, maxZoom: undefined, indexBottom: 7, fromLevel: 9, toLevel: 10},
            ],
            locations,
            this.mapController.camera,
            this.mapController.renderer,
        );
    const osmNodes =
        new PointCollectionLayer(
            '/api/collections/00000000-0000-0000-0000-000000000002',
            [
              // Every point sits in a level 13 cell, see DumpPoints.kt. Level 11 tiles hold a
              // viewport at zoom 14 in a handful of requests.
              {minZoom: POINT_ICON_ZOOM, maxZoom: undefined, indexBottom: 11, fromLevel: 13,
                toLevel: 13},
            ],
            NODE_KINDS.map(({category}) => category),
            POINT_ICON_ZOOM,
            this.mapController.camera,
            this.mapController.renderer,
        );
    const protomaps =
        new MbtileLayer(
            [
              {
                long: 'Base political and transportation data provided by the OpenStreetMap project',
                short: 'OpenStreetMap contributors',
                url: 'https://www.openstreetmap.org/copyright',
              },
            ],
            'https://api.protomaps.com/tiles/v4/${id.zoom}/${id.x}/${id.y}.mvt?key=b6ce0acec3807d5c',
            NATURE_PROTOMAPS,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            /* maxZoom= */ 15,
            this.mapController.renderer,
        );
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const sentinelValues = {from: isoDay(yearAgo), to: isoDay(new Date()), cloud: 5};
    const sentinel =
        new EarthSearchLayer(
            'sentinel-2-l2a',
            sentinelSearch(sentinelValues),
            Z_BASE_SATELLITE,
            this.mapController.renderer);

    const nodes = sortLayerNodes([{
      kind: 'group',
      id: 'osm',
      name: 'OpenStreetMap',
      enabled: true,
      children: [{
        kind: 'layer',
        id: 'osm/ways',
        name: 'Ways',
        // On by default because NATURE_WITHOUT_DETAILED_WAYS hands it the ways.
        enabled: true,
        schema: OSM_WAYS_SCHEMA,
        layer: ways,
        controls: WAY_KINDS.map(({key, label}) => ({kind: 'checkbox', key, label})),
        values: Object.fromEntries(WAY_KINDS.map(({key}) => [key, true])),
        configure: values => {
          ways.setStyle(
              osmWaysOf(WAY_KINDS.filter(({key}) => values[key]).map(({category}) => category)));
        },
      }, {
        kind: 'layer',
        id: 'osm/nodes',
        name: 'Nodes',
        enabled: true,
        schema: OSM_NODES_SCHEMA,
        layer: osmNodes,
        controls: NODE_KINDS.map(({key, label}) => ({kind: 'checkbox', key, label})),
        values: Object.fromEntries(NODE_KINDS.map(({key}) => [key, true])),
        configure: values => {
          osmNodes.setCategories(
              NODE_KINDS.filter(({key}) => values[key]).map(({category}) => category));
        },
      }, {
        kind: 'layer',
        id: 'osm/protomaps',
        name: 'Basemap (Protomaps)',
        enabled: true,
        layer: protomaps,
        controls: [
          {kind: 'checkbox', key: 'boundaries', label: 'Boundaries'},
          ...BASEMAP_LABEL_KINDS.map(({key, label}) => ({kind: 'checkbox' as const, key, label})),
        ],
        values: {
          boundaries: true,
          ...Object.fromEntries(BASEMAP_LABEL_KINDS.map(({key}) => [key, true])),
        },
        configure: values => {
          protomaps.setStyle(
              basemapOf(
                  values.boundaries === true,
                  new Set(
                      BASEMAP_LABEL_KINDS
                          .filter(({key}) => values[key])
                          .flatMap(({layerNames}) => layerNames))));
        },
      }],
    }, {
      kind: 'group',
      id: 'us',
      name: 'United States',
      enabled: true,
      children: [{
        kind: 'layer',
        id: 'us/public_land',
        name: 'Public land',
        enabled: false,
        schema: PUBLIC_LAND_SCHEMA,
        layer: new CollectionLayer(
            '/api/collections/22b0cb56-dc1f-4546-8615-3382dc3eb44a',
            PUBLIC_LAND,
            // Snapping to a level whose cells are a few pixels across is invisible and saves most
            // of the geometry, but past zoom 10 we want the real boundaries.
            [
              {minZoom: 0, snap: 11},
              {minZoom: 7, snap: 14},
              {minZoom: 10, snap: undefined},
            ],
            [
              // Anything wider than a level 10 cell, so about 7 km up. That reaches the national
              // parks, which sit at levels 6 to 9, and it is everything the coarsest snap can draw:
              // snapping to level 11 erases whatever is smaller than a level 11 cell anyway.
              //
              // Tiled at level 5 rather than 4 because a tile carries its objects across its whole
              // cell, so a coarser tiling means pulling parks hundreds of km offscreen once zoomed
              // in. Level 5 costs 205 requests for a view of the western US instead of 68, and 2.9
              // MB instead of 4.5 MB at zoom 11.
              {minZoom: 0, maxZoom: undefined, indexBottom: 5, fromLevel: 0, toLevel: 10},
              // Everything smaller. A level 6 cell holds up to 11k of these, which is why they wait
              // until the viewport is small enough to be worth it.
              {minZoom: 7, maxZoom: undefined, indexBottom: 6, fromLevel: 11, toLevel: undefined},
            ],
            locations,
            this.mapController.camera,
            this.mapController.renderer,
        ),
        controls: [],
        values: {},
      }, {
        kind: 'layer',
        id: 'us/topo',
        name: 'US Topo',
        enabled: false,
        layer: new RasterTileLayer(
            [{
              long: 'Topographic base map from The National Map, US Geological Survey',
              short: 'USGS',
              url: 'https://www.usgs.gov/programs/national-geospatial-program/national-map',
            }],
            'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile'
                + '/${id.zoom}/${id.y}/${id.x}',
            /* tint= */ 0xFFFFFFFF as RgbaU32,
            /* z= */ Z_BASE_SATELLITE,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            // USGS caches tiles through zoom 15 and 404s past it.
            /* maxZoom= */ 15,
            this.mapController.renderer,
        ),
        controls: [],
        values: {},
      }],
    }, {
      kind: 'group',
      id: 'satellite',
      name: 'Satellite',
      enabled: true,
      children: [{
        kind: 'group',
        id: 'satellite/goes',
        name: 'GOES',
        enabled: true,
        children: [
          this.newGoesEntry('East', 'GeoColor', 'GeoColor'),
          this.newGoesEntry('East', 'FireTemp', 'fire temperature'),
          this.newGoesEntry('West', 'GeoColor', 'GeoColor'),
          this.newGoesEntry('West', 'FireTemp', 'fire temperature'),
        ],
      }, {
        kind: 'layer',
        id: 'satellite/sentinel',
        name: 'Sentinel L2A',
        enabled: false,
        layer: sentinel,
        controls: [
          {kind: 'date', key: 'from', label: 'From'},
          {kind: 'date', key: 'to', label: 'To'},
          {kind: 'percent', key: 'cloud', label: 'Max cloud cover'},
        ],
        values: sentinelValues,
        configure: values => {
          sentinel.setSearch(sentinelSearch(values));
        },
      }, {
        kind: 'layer',
        id: 'satellite/maptiler',
        name: 'MapTiler',
        enabled: false,
        layer: new RasterTileLayer(
            [
              {
                long: 'Satellite imagery packaged and served by MapTiler',
                short: 'MapTiler',
                url: 'https://www.maptiler.com/copyright/',
              },
              {
                long: 'Base political and transportation data provided by the OpenStreetMap project',
                short: 'OpenStreetMap contributors',
                url: 'https://www.openstreetmap.org/copyright',
              },
            ],
            'https://api.maptiler.com/tiles/satellite-mediumres-2021/${id.zoom}/${id.x}/${id.y}.jpg?key=UGTHB0b969Xa1xpZvnvB',
            /* tint= */ 0xFFFFFFFF as RgbaU32,
            /* z= */ Z_BASE_SATELLITE,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            /* maxZoom= */ 14,
            this.mapController.renderer,
        ),
        controls: [],
        values: {},
      }],
    }, {
      kind: 'group',
      id: 'topography',
      name: 'Topography',
      enabled: true,
      children: [{
        kind: 'layer',
        id: 'topography/contours',
        name: 'Contours',
        enabled: true,
        layer: this.contours[getUnitSystem()],
        controls: [],
        values: {},
      }, {
        kind: 'layer',
        id: 'topography/hillshades',
        name: 'Hillshades',
        enabled: true,
        layer: new RasterTileLayer(
            [MAPTERHORN_COPYRIGHT, COPERNICUS_COPYRIGHT, {
              long: 'Contains modified NASADEM data 2000',
            }],
            'https://tiles.trailcatalog.org/hillshades/${id.zoom}/${id.x}/${id.y}.webp',
            /* tint= */ 0xFFFFFF30 as RgbaU32,
            /* z= */ Z_BASE_TERRAIN,
            /* extraZoom= */ 0,
            /* minZoom= */ 0,
            /* maxZoom= */ 12,
            this.mapController.renderer,
        ),
        controls: [],
        values: {},
      }],
    }]);
    const owned =
        new Set([
          ...layerEntries(nodes).map(({entry}) => entry.layer),
          ...Object.values(this.contours),
        ]);
    for (const layer of owned) {
      this.registerDisposable(layer);
    }
    this.updateState({
      ...this.state,
      layers: {nodes, expanded: new Set(['osm', 'satellite', 'topography', 'us'])},
    });
    this.setMapLayers(nodes);

    const collection = response.args.collection;
    // The server render already answered with the outline's failure, and a reload is the retry.
    if (collection && this.state.collectionStatus !== 'failed') {
      this.loadCollection(collection, response.args.fitCollection);
    }
  }

  // Selects the new line, like onPointPlaced, so that the panel is open to name it.
  onLineDrawn(e: CorgiEvent<typeof LINE_DRAWN>): void {
    this.addLine(e.detail.latLngE7);
  }

  // Selects the new stroke, like onPointPlaced, so that the panel is open to name it.
  onMarkerDrawn(e: CorgiEvent<typeof MARKER_DRAWN>): void {
    const line: EditableLine = {
      kind: 'line',
      id: crypto.randomUUID(),
      version: 0n,
      data: {marker_zoom: e.detail.zoom},
      latLngE7: e.detail.latLngE7,
      elevationCentimeters: undefined,
      timeSeconds: undefined,
    };
    this.store.apply([{id: line.id, before: undefined, after: line}]);
    this.select(line.id);
  }

  // Selects the new point so that the panel is open to name it, and stays in the tool so that
  // several can go down in a row.
  onPointPlaced(e: CorgiEvent<typeof POINT_PLACED>): void {
    const parent = this.newFeatureParent();
    const point: EditableFeature = {
      kind: 'point',
      id: crypto.randomUUID(),
      version: 0n,
      data: parent !== undefined ? {folder_id: parent} : {},
      latE7: e.detail.latE7,
      lngE7: e.detail.lngE7,
      elevationCentimeters: undefined,
    };
    if (parent !== undefined) {
      this.expand([parent]);
    }
    this.store.apply([{id: point.id, before: undefined, after: point}]);
    this.select(point.id);
  }

  onToolRequested(e: CorgiEvent<typeof TOOL_REQUESTED>): void {
    this.setTool(e.detail.tool);
  }

  // Joins the line clicked while Join with is waiting on one. Anything else cancels the join and
  // selects as usual.
  onFeatureClicked(e: CorgiEvent<typeof FEATURE_CLICKED>): void {
    const id = e.detail.id;
    const from = this.joining;
    this.stopJoining();
    const a = from !== undefined ? this.store.get(from) : undefined;
    const b = id !== undefined ? this.store.get(id) : undefined;
    if (a?.kind === 'line' && b?.kind === 'line' && a.id !== b.id) {
      this.store.apply([
        {id: a.id, before: snapshot(a), after: joinLines(a, b)},
        {id: b.id, before: snapshot(b), after: undefined},
      ]);
      this.select(a.id);
      return;
    }

    this.reveal(id);
  }

  // Opens the folders above what the map selected and scrolls to it, so that the list shows it.
  private reveal(id: string|undefined): void {
    this.expand(this.ancestorsOf(id));
    this.select(id);
    if (id !== undefined) {
      // After the render that puts the row in the list
      requestAnimationFrame(() => {
        this.root.querySelector(`div[data-id="${id}"]`)?.scrollIntoView({block: 'nearest'});
      });
    }
  }

  // Only the pointer tool opens objects, or else finishing a line with a double click would too.
  onObjectOpened(e: CorgiEvent<typeof OBJECT_OPENED>): void {
    if (this.state.tool !== 'pointer') {
      return;
    }

    const {layer, object} = e.detail;
    this.select(undefined);
    this.inspected = object;
    const data = object.value.data;
    const schema =
        checkExists(
            layerEntries(this.state.layers.nodes).find(({entry}) => entry.layer === layer)
                ?.entry.schema);
    const titleValue = data[schema.title.key];
    const element =
        typeof titleValue !== 'number' ? undefined
            : schema.title.kind === 'osm_point' ? osmElementOf(titleValue)
            : schema.title.kind === 'osm_way' ? {type: 'way' as const, id: titleValue}
            : undefined;
    const osm = element ? {...element, tags: 'loading' as const} : undefined;
    const common = {data, schema, osm};
    if (object.kind === 'line') {
      const path = toDegrees(object.value.points);
      this.updateState({
        ...this.state,
        inspected: {
          ...common,
          kind: 'line',
          lengthMeters: pathLengthMeters(path),
          climb: undefined,
        },
      });
      this.loadClimb(path);
    } else if (object.kind === 'point') {
      const ll = unprojectS2LatLng(object.value.position[0], object.value.position[1]);
      this.updateState({
        ...this.state,
        inspected: {
          ...common,
          kind: 'point',
          latDegrees: ll.latDegrees(),
          lngDegrees: ll.lngDegrees(),
        },
      });
    } else {
      this.updateState({...this.state, inspected: {...common, kind: 'polygon'}});
    }
    if (osm) {
      this.loadOsmTags(osm.type, osm.id);
    }
  }

  onFeatureEdited(e: CorgiEvent<typeof FEATURE_EDITED>): void {
    const {before, after, vertex} = e.detail;
    const changes = [{id: after.id, before, after}];
    if (vertex === undefined) {
      this.store.apply(changes);
    } else {
      this.applyPlacingVertices(changes, [{id: after.id, index: vertex}]);
    }
  }

  onFeatureContextMenu(e: CorgiEvent<typeof FEATURE_CONTEXT_MENU>): void {
    const {id, spot, px} = e.detail;
    this.stopJoining();
    this.reveal(id);
    const feature = id !== undefined ? this.store.get(id) : undefined;
    const editable = feature !== undefined && !this.store.isReadOnly();
    const items: MenuEntries = [];
    if (editable && feature.kind === 'line' && spot) {
      const count = feature.latLngE7.length / 2;
      items.push({
        kind: 'menu_item',
        label: 'Split here',
        disabled: spot.kind === 'vertex' && (spot.index === 0 || spot.index === count - 1),
        action: () => {
          this.splitLineAt(feature.id, spot);
        },
      });
      items.push({
        kind: 'menu_item',
        label: 'Reverse direction',
        action: () => {
          this.editLine(feature.id, reverseLine);
        },
      });
      items.push({
        kind: 'menu_item',
        label: 'Join with…',
        disabled: this.store.lines().length < 2,
        action: () => {
          this.joining = feature.id;
          this.updateState({...this.state, joining: true});
        },
      });
      if (spot.kind === 'vertex' && spot.handle) {
        items.push({
          kind: 'menu_item',
          label: 'Delete vertex',
          disabled: count <= 2,
          action: () => {
            this.editLine(feature.id, line => removeVertex(line, spot.index));
          },
        });
      }
    }
    if (editable) {
      items.push({
        kind: 'menu_item',
        label: 'Duplicate',
        action: () => {
          this.duplicateFeature(feature.id);
        },
      });
    }
    const [latE7, lngE7] = coordinatesOf(feature, spot, e.detail.latE7, e.detail.lngE7);
    items.push({
      kind: 'menu_item',
      label: 'Copy coordinates',
      action: () => {
        const text = `${(latE7 / 1e7).toFixed(6)}, ${(lngE7 / 1e7).toFixed(6)}`;
        navigator.clipboard.writeText(text).catch(e => {
          console.error(e);
        });
      },
    });
    if (editable) {
      items.push({kind: 'divider'});
      items.push({
        kind: 'menu_item',
        label: 'Delete',
        action: () => {
          const live = this.store.get(feature.id);
          if (live) {
            this.deleteFeatures([live]);
          }
        },
      });
    }

    const canvas = checkExists(this.root.querySelector('canvas')).getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    this.openContextMenu(
        items, canvas.left - root.left + px[0], canvas.top - root.top + px[1]);
  }

  onFeatureHovered(e: CorgiEvent<typeof FEATURE_HOVERED>): void {
    this.setHovered(e.detail.id);
  }

  featureClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    // The chevron and the eye sit inside the row and have their own handlers.
    if (e.detail.target instanceof Element && e.detail.target.closest('[data-role="toggle"]')) {
      return;
    }

    this.select(checkExists(e.actionElement.data('id')).string());
  }

  featureDragStarted(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    this.draggedFeature = id;
    const transfer = (e.detail as DragEvent).dataTransfer;
    if (transfer) {
      // Firefox refuses to start a drag that carries no data.
      transfer.setData('text/plain', id);
      transfer.effectAllowed = 'move';
    }
  }

  featureDraggedOver(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.dragOver(e.detail as DragEvent, this.dropFolderFor(e));
  }

  featureTreeDraggedOver(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.dragOver(e.detail as DragEvent, undefined);
  }

  // Clears the target once the drag leaves the tree. Moving between rows leaves one row for
  // another inside it, which keeps the target.
  featureTreeDragLeft(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const related = e.detail.relatedTarget;
    if (!(related instanceof Node) || !e.actionElement.element().contains(related)) {
      this.setDropTarget(undefined);
    }
  }

  featureDropped(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.drop(e.detail as DragEvent, this.dropFolderFor(e));
  }

  featureTreeDropped(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.drop(e.detail as DragEvent, undefined);
  }

  featureDragEnded(): void {
    this.draggedFeature = undefined;
    this.setDropTarget(undefined);
  }

  folderToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    const expanded = new Set(this.state.features.expanded);
    if (!expanded.delete(id)) {
      expanded.add(id);
    }
    this.updateState({...this.state, features: {...this.state.features, expanded}});
  }

  featureRowEntered(e: CorgiEvent<typeof DOM_POINTER>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    this.featureLayer.setHovered(id);
    this.setHovered(id);
  }

  featureRowLeft(): void {
    this.featureLayer.setHovered(undefined);
    this.setHovered(undefined);
  }

  measureClosed(): void {
    this.setTool('pointer');
  }

  measureUndoClicked(): void {
    this.measuringLayer().popVertex();
  }

  maxClimbChanged(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.setGrade(e, 'climbPercent');
  }

  maxDescentChanged(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.setGrade(e, 'descentPercent');
  }

  profileHovered(e: CorgiEvent<typeof DOM_POINTER>): void {
    const source = checkExists(e.actionElement.data('source')).string();
    const samples = source === 'line' ? this.lineSamples : this.measureSamples;
    if (!samples || samples.distanceMeters.length === 0) {
      return;
    }

    // The chart scales its viewBox to its width, so the pointer's share of the plot is its share
    // of the distance.
    const svg = e.actionElement.element();
    const bounds = svg.getBoundingClientRect();
    const width = checkExists(e.actionElement.data('width')).number();
    const left = checkExists(e.actionElement.data('left')).number() * bounds.width / width;
    const right = checkExists(e.actionElement.data('right')).number() * bounds.width / width;
    const fraction =
        Math.min(1, Math.max(0, (e.detail.clientX - bounds.left - left) / (right - left)));
    const distances = samples.distanceMeters;
    const target = fraction * distances[distances.length - 1];
    let index = 0;
    while (index + 1 < distances.length && distances[index + 1] <= target) {
      index += 1;
    }
    const ll =
        S2LatLng.fromDegrees(
            samples.latLngDegrees[2 * index], samples.latLngDegrees[2 * index + 1]);
    const line = this.state.lineProfile;
    if (source !== 'line') {
      this.measuringLayer().setMarker(projectS2LatLng(ll));
      this.updateState({...this.state, measure: {...this.state.measure, hovered: index}});
    } else if (line?.status === 'loaded') {
      this.featureLayer.setMarker(projectS2LatLng(ll));
      this.updateState({...this.state, lineProfile: {...line, hovered: index}});
    }
  }

  profileLeft(): void {
    this.measureLayer.setMarker(undefined);
    this.terrainLayer.setMarker(undefined);
    this.featureLayer.setMarker(undefined);
    const line = this.state.lineProfile;
    this.updateState({
      ...this.state,
      lineProfile: line?.status === 'loaded' ? {...line, hovered: undefined} : line,
      measure: {...this.state.measure, hovered: undefined},
    });
  }

  saveMeasurementClicked(): void {
    const latLngE7 = toE7Array(this.measuringLayer().points());
    if (latLngE7.length < 4) {
      return;
    }

    this.setTool('pointer');
    this.addLine(latLngE7);
  }

  visibilityToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    const hidden = new Set(this.state.features.hidden);
    if (!hidden.delete(id)) {
      hidden.add(id);
    }
    this.setHidden(hidden);
    this.saveViewState();
  }

  newFolderClicked(): void {
    const parent = this.newFeatureParent();
    const folder: EditableFeature = {
      kind: 'folder',
      id: crypto.randomUUID(),
      version: 0n,
      data: parent !== undefined ? {folder_id: parent} : {},
    };
    if (parent !== undefined) {
      this.expand([parent]);
    }
    this.store.apply([{id: folder.id, before: undefined, after: folder}]);
    this.select(folder.id);
  }

  nameChanged(e: CorgiEvent<typeof CHANGED>): void {
    const name = e.detail.value;
    this.editSelectedData(data => ({...data, name: name || undefined}), 'name');
  }

  descriptionChanged(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const description = (e.actionElement.element() as HTMLTextAreaElement).value;
    this.editSelectedData(
        data => ({...data, description: description || undefined}), 'description');
  }

  colorChanged(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const color = (e.actionElement.element() as HTMLInputElement).value;
    const key = this.store.get(this.selected ?? '')?.kind === 'line' ? 'stroke' : 'fill';
    this.editSelectedData(data => ({...data, [key]: color}), 'color');
  }

  // A folder centers on everything inside it.
  centerClicked(): void {
    const selected = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    const features =
        !selected
            ? []
            : selected.kind === 'folder' ? this.store.descendants(selected.id) : [selected];
    const latLngDegrees = featureLatLngDegrees(features);
    const inspected = this.inspected;
    if (inspected?.kind === 'polygon') {
      const bound = inspected.value.bound;
      latLngDegrees.push(bound.low[0], bound.low[1], bound.high[0], bound.high[1]);
    } else if (inspected?.kind === 'point') {
      const ll = unprojectS2LatLng(inspected.value.position[0], inspected.value.position[1]);
      latLngDegrees.push(ll.latDegrees(), ll.lngDegrees());
    } else if (inspected?.kind === 'line') {
      const points = inspected.value.points;
      for (let i = 0; i < points.length; i += 2) {
        const ll = unprojectS2LatLng(points[i], points[i + 1]);
        latLngDegrees.push(ll.latDegrees(), ll.lngDegrees());
      }
    }
    this.fitCamera(latLngDegrees);
  }

  // Moves the camera to show every point in a flat lat,lng array, or nowhere when it's empty.
  private fitCamera(latLngDegrees: number[]): void {
    if (latLngDegrees.length === 0) {
      return;
    }

    let low = [Infinity, Infinity] as Vec2;
    let high = [-Infinity, -Infinity] as Vec2;
    for (let i = 0; i < latLngDegrees.length; i += 2) {
      const lat = latLngDegrees[i];
      const lng = latLngDegrees[i + 1];
      low = [Math.min(low[0], lat), Math.min(low[1], lng)] as Vec2;
      high = [Math.max(high[0], lat), Math.max(high[1], lng)] as Vec2;
    }

    if (low[0] === high[0] && low[1] === high[1]) {
      // A lone point has no extent to fit, so we zoom in until its surroundings are readable.
      this.mapController.setCamera({
        lat: low[0],
        lng: low[1],
        zoom: Math.max(this.mapController.camera.zoom, POINT_ZOOM),
      });
    } else {
      // setCamera tells a rect from a center by the brand, so it has to exist at runtime.
      this.mapController.setCamera({low, high, brand: 'LatLngRect'});
    }
  }

  deselectClicked(): void {
    this.select(undefined);
  }

  iconButtonClicked(): void {
    const selected = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    if (selected?.kind !== 'point') {
      return;
    }

    const counts = new Map<string, number>();
    for (const point of this.store.points()) {
      const icon = importableIcon(point.data.icon);
      if (icon) {
        counts.set(icon, (counts.get(icon) ?? 0) + 1);
      }
    }

    this.dialog.display(IconPickerDialog({
      color: selected.data.fill ?? DEFAULT_POINT_COLOR,
      current: selected.data.icon,
      onChosen: icon => {
        this.editSelectedData(data => ({...data, icon}));
      },
      used: [...counts].sort((a, b) => b[1] - a[1]).map(([icon]) => icon),
    })).catch(() => {});
  }

  widthChanged(e: CorgiEvent<typeof CHANGED>): void {
    const width = Number(e.detail.value);
    this.editSelectedData(data => ({...data, width_px: width}));
  }

  folderChanged(e: CorgiEvent<typeof CHANGED>): void {
    const folder = e.detail.value;
    if (folder) {
      this.expand([folder]);
    }
    this.editSelectedData(data => ({...data, folder_id: folder || undefined}));
  }

  deleteClicked(): void {
    const feature = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    if (!feature) {
      return;
    }

    const doomed =
        feature.kind === 'folder' ? [...this.store.descendants(feature.id), feature] : [feature];
    const confirmed =
        doomed.length > 1
            ? this.dialog.display(ConfirmDeleteDialog({count: doomed.length - 1}))
            : Promise.resolve();
    confirmed.then(() => {
      this.deleteFeatures(doomed);
    }, () => {});
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    this.history.silentlyReplaceUrl(url.toString());
  }

  // A group's row opens it and a layer's row shows it, since a group has nothing else to click for.
  layerRowClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    // The chevron and the eye sit inside the row and have their own handlers.
    if (e.detail.target instanceof Element && e.detail.target.closest('[data-role="toggle"]')) {
      return;
    }

    const node = this.layerNodeOf(e);
    if (node.kind === 'group') {
      this.toggleLayerExpanded(node.id);
    } else {
      this.setLayerEnabled(node.id, !node.enabled);
    }
  }

  layerExpandToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.toggleLayerExpanded(this.layerNodeOf(e).id);
  }

  layerVisibilityToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const node = this.layerNodeOf(e);
    this.setLayerEnabled(node.id, !node.enabled);
  }

  layerControlChanged(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const entry = this.layerNodeOf(e);
    if (entry.kind !== 'layer') {
      throw new Error(`Group ${entry.id} has no controls`);
    }

    const key = checkExists(e.actionElement.data('key')).string();
    const control = checkExists(entry.controls.find(c => c.key === key));
    const input = e.actionElement.element() as HTMLInputElement;
    let value;
    if (control.kind === 'checkbox') {
      value = input.checked;
    } else if (control.kind === 'date') {
      value = input.value;
    } else if (control.kind === 'percent') {
      value = input.valueAsNumber;
      if (!(value >= 0 && value <= 100)) {
        return;
      }
    } else {
      throw checkExhaustive(control);
    }

    const values = {...entry.values, [key]: value};
    this.updateState({
      ...this.state,
      layers: {
        ...this.state.layers,
        nodes: updateLayerNode(this.state.layers.nodes, entry.id, () => ({...entry, values})),
      },
    });
    entry.configure?.(values);
  }

  fileMenuClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.fileMenu(e.actionElement.element());
  }

  editMenuClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.editMenu(e.actionElement.element());
  }

  viewMenuClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.viewMenu(e.actionElement.element());
  }

  userMenuClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.userMenu(e.actionElement.element());
  }

  menubarMenuEntered(e: CorgiEvent<typeof DOM_POINTER>): void {
    const trigger = e.actionElement.element();
    if (!this.menuOverlay?.isConnected || this.menuTrigger === trigger) {
      return;
    }

    const menu = checkExists(e.actionElement.data('menu')).string();
    if (menu === 'file') {
      this.fileMenu(trigger);
    } else if (menu === 'edit') {
      this.editMenu(trigger);
    } else if (menu === 'view') {
      this.viewMenu(trigger);
    } else if (menu === 'user') {
      this.userMenu(trigger);
    }
  }

  // Clicks on the bar's empty space close the open menu, because the bar covers that part of the
  // menu's overlay.
  menubarClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    if (e.targetElement.element() === e.actionElement.element()) {
      this.closeMenu();
    }
  }

  toolClicked(e: CorgiEvent<typeof ACTION>): void {
    this.setTool(checkExists(e.actionElement.data('tool')).string() as Tool);
  }

  loginClicked(): void {
    this.requireLogin().catch(e => {
      console.error(e);
    });
  }

  private fileMenu(trigger: Element): void {
    if (!this.claimMenu(trigger)) {
      return;
    }

    const collections: Future<ListCollectionsResponse> =
        requestData('lat.trails.DataService/ListCollections', {});
    collections.then(response => {
      const items: MenuEntries = [{
        kind: 'menu_item',
        label: 'New',
        action: () => {
          this.newCollection();
        },
      }];
      for (const [label, collections] of [
        ['Open', response.collections],
        ['Open shared', response.shared],
      ] as const) {
        if (collections.length > 0) {
          items.push({
            kind: 'menu',
            label,
            items: collections.map(collection => ({
              kind: 'menu_item' as const,
              label: collection.name,
              action: () => {
                this.openCollection(collection);
              },
            })),
          });
        } else if (label === 'Open') {
          items.push({kind: 'menu_item', label, disabled: true, action: () => {}});
        }
      }
      const open = this.state.collection;
      items.push({
        kind: 'menu_item',
        label: 'Share',
        disabled: open?.role !== Role.OWNER,
        action: () => {
          if (open) {
            this.dialog.display(ShareDialog({collection: open})).catch(() => {});
          }
        },
      });
      items.push({
        kind: 'menu_item',
        label: 'Rename',
        disabled: open?.role !== Role.OWNER && open?.role !== Role.WRITE,
        action: () => {
          if (open) {
            this.renameCollection(open);
          }
        },
      });
      items.push({
        kind: 'menu_item',
        label: 'Delete',
        disabled: open?.role !== Role.OWNER,
        action: () => {
          if (open) {
            this.deleteCollection(open);
          }
        },
      });
      items.push({kind: 'divider'});
      items.push({
        kind: 'menu_item',
        label: 'Import',
        disabled: this.store.isReadOnly(),
        action: () => {
          this.importFiles();
        },
      });
      items.push({
        kind: 'menu',
        label: 'Export',
        items: [{
          kind: 'menu_item',
          label: 'GPX',
          action: () => {
            this.download(toGpx([...this.store.all()]), 'gpx', 'application/gpx+xml');
          },
        }, {
          kind: 'menu_item',
          label: 'GeoJSON',
          action: () => {
            this.download(toGeoJson([...this.store.all()]), 'geojson', 'application/geo+json');
          },
        }],
      });
      this.openMenu(items, trigger);
    });
  }

  private editMenu(trigger: Element): void {
    if (!this.claimMenu(trigger)) {
      return;
    }

    const mac = navigator.platform.startsWith('Mac');
    this.openMenu([{
      kind: 'menu_item',
      label: 'Undo',
      disabled: !this.store.canUndo,
      shortcut: mac ? '⌘Z' : 'Ctrl+Z',
      action: () => {
        this.store.undo();
      },
    }, {
      kind: 'menu_item',
      label: 'Redo',
      disabled: !this.store.canRedo,
      shortcut: mac ? '⇧⌘Z' : 'Ctrl+Y',
      action: () => {
        this.store.redo();
      },
    }], trigger);
  }

  private viewMenu(trigger: Element): void {
    if (!this.claimMenu(trigger)) {
      return;
    }

    const system = getUnitSystem();
    this.openMenu([{
      kind: 'checkbox_menu_item',
      label: 'Imperial',
      checked: system === 'imperial',
      action: () => {
        this.setUnitSystem('imperial');
      },
    }, {
      kind: 'checkbox_menu_item',
      label: 'Metric',
      checked: system === 'metric',
      action: () => {
        this.setUnitSystem('metric');
      },
    }], trigger);
  }

  private userMenu(trigger: Element): void {
    if (!this.claimMenu(trigger)) {
      return;
    }

    this.openMenu([{
      kind: 'menu_item',
      label: 'Log out',
      action: () => {
        // Force a page refresh as part of logging out
        window.location.href = '/logout';
      },
    }], trigger);
  }

  // Deactivates before activating, because both drawing layers share the index's routing switch.
  private setTool(tool: Tool): void {
    this.stopJoining();
    this.lineLayer.setActive(false);
    this.measureLayer.setActive(false);
    this.terrainLayer.setActive(false);
    this.pointLayer.setActive(tool === 'point');
    this.markerLayer.setActive(tool === 'marker');
    this.featureLayer.setInteractive(tool === 'pointer');
    this.featureLayer.setPointsDraggable(tool === 'point');
    // Refreshes the credits, because the measure layer's only count while it is active
    this.setMapLayers(this.state.layers.nodes);
    if (tool === 'line') {
      this.lineLayer.setActive(true);
    } else if (tool === 'measure') {
      this.measureLayer.setActive(true);
    } else if (tool === 'terrain') {
      this.terrainLayer.setActive(true);
    }
    this.updateState({
      ...this.state,
      tool,
    });
  }

  // Skipped while typing, so that the browser's own undo still works in text fields.
  private keyPressed(e: KeyboardEvent): void {
    // Checked before defaultPrevented, because the line being edited also takes Escape
    if (e.key === 'Escape' && this.joining !== undefined) {
      this.stopJoining();
      e.preventDefault();
      return;
    }

    // A map layer already handled it, like Delete removing a vertex from the line being edited
    if (e.defaultPrevented) {
      return;
    }

    const target = e.target;
    if (
        target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || target instanceof HTMLSelectElement
            || (target instanceof HTMLElement && target.isContentEditable)) {
      return;
    }

    // Folders only go through the button, because a stray key taking a folder of dozens of
    // features with it is too easy.
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.state.tool === 'pointer') {
      const feature = this.selected !== undefined ? this.store.get(this.selected) : undefined;
      if (feature && feature.kind !== 'folder') {
        this.deleteFeatures([feature]);
        e.preventDefault();
      }
      return;
    }

    if (!(e.ctrlKey || e.metaKey) || e.altKey) {
      return;
    }

    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      this.store.undo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      this.store.redo();
    } else {
      return;
    }
    e.preventDefault();
  }

  // Updates the length now, because it is cheap, and the profile once the pointer settles. The
  // drawing changes on every pointer move, and most moves leave the placed part alone.
  private measureChanged(): void {
    const route = this.state.tool === 'terrain' ? this.terrainLayer.routeStatus() : undefined;
    const shown = this.state.measure.route;
    if (
        route?.routing !== shown?.routing
            || route?.unroutable !== shown?.unroutable
            || route?.failed !== shown?.failed) {
      this.updateState({...this.state, measure: {...this.state.measure, route}});
    }

    const path = this.measurePath();
    const measured = this.measuredPath;
    if (measured && measured.length === path.length && measured.every((v, i) => v === path[i])) {
      return;
    }
    this.measuredPath = path;
    const lengthMeters = pathLengthMeters(path);
    const vertexCount = path.length / 2;
    this.updateState({
      ...this.state,
      measure: {
        ...this.state.measure,
        lengthMeters,
        vertexCount,
      },
    });
    if (vertexCount >= 2) {
      this.profileDebouncer.trigger();
    } else {
      this.measureSamples = undefined;
      this.updateState({
        ...this.state,
        measure: {
          lengthMeters,
          vertexCount,
          profile: undefined,
          hovered: undefined,
          status: 'idle',
          route,
        },
      });
    }
  }

  private sampleProfile(): void {
    const path = this.measurePath();
    if (path.length < 4) {
      return;
    }

    const samples = profileSamples(path);
    this.profileGeneration += 1;
    const generation = this.profileGeneration;
    this.updateState({...this.state, measure: {...this.state.measure, status: 'loading'}});
    this.elevations.sample(samples.latLngDegrees, samples.zoom).then(
        meters => {
          if (generation !== this.profileGeneration) {
            return;
          }

          const distanceMeters = slopeMeters(samples.distanceMeters, meters);
          this.measureSamples = {...samples, distanceMeters};
          this.updateState({
            ...this.state,
            measure: {
              ...this.state.measure,
              lengthMeters: distanceMeters[distanceMeters.length - 1],
              profile: {
                distanceMeters: Array.from(distanceMeters),
                meters: Array.from(meters),
                stats: profileStats(meters),
              },
              hovered: undefined,
              status: 'idle',
            },
          });
        },
        e => {
          console.error(e);
          if (generation === this.profileGeneration) {
            this.updateState({...this.state, measure: {...this.state.measure, status: 'failed'}});
          }
        });
  }

  // Without elevations, because the profile samples the DEM along a line that has none, and
  // elevations read at the vertices alone would draw each segment as a straight slope.
  private addLine(latLngE7: Int32Array): void {
    const line: EditableLine = {
      kind: 'line',
      id: crypto.randomUUID(),
      version: 0n,
      data: {},
      latLngE7,
      elevationCentimeters: undefined,
      timeSeconds: undefined,
    };
    this.store.apply([{id: line.id, before: undefined, after: line}]);
    this.select(line.id);
  }

  // Resolves undefined when the tiles could not be fetched.
  private sampleVertices(latLngE7: Int32Array): Promise<Int32Array|undefined> {
    const degrees = Float64Array.from(latLngE7, e7 => e7 / 1e7);
    return this.elevations.sample(degrees, profileSamples(degrees).zoom)
        .then(meters => Int32Array.from(meters, m => Math.round(m * 100)), () => undefined);
  }

  // The placed part of the measurement as interleaved lat then lng degrees. The segment to the
  // cursor is left out, because the numbers are about what was clicked.
  private measurePath(): Float64Array {
    return toDegrees(this.measuringLayer().placedPoints());
  }

  // The measure and terrain tools share the panel and its state, and only one is active at a time.
  private measuringLayer(): DrawingLayer {
    return this.state.tool === 'terrain' ? this.terrainLayer : this.measureLayer;
  }

  // Ignores what isn't a positive number, like an emptied field.
  private setGrade(e: CorgiEvent<typeof DOM_MOUSE>, key: keyof GradeLimitState): void {
    const percent = Number((e.actionElement.element() as HTMLInputElement).value);
    if (!(percent > 0) || percent === this.state.grades[key]) {
      return;
    }

    this.updateState({...this.state, grades: {...this.state.grades, [key]: percent}});
    this.terrainLayer.reroute();
  }

  // Where a new feature goes: inside the selected folder, or else beside the selected feature.
  private newFeatureParent(): string|undefined {
    const selected = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    return selected?.kind === 'folder' ? selected.id : selected && this.store.parentOf(selected);
  }

  private setHovered(id: string|undefined): void {
    if (id === this.state.features.hovered) {
      return;
    }

    this.updateState({
      ...this.state,
      features: {
        ...this.state.features,
        hovered: id,
        hoveredAncestors: new Set(this.ancestorsOf(id)),
      },
    });
  }

  private ancestorsOf(id: string|undefined): string[] {
    const ancestors = [];
    let at = id !== undefined ? this.store.get(id) : undefined;
    while (at) {
      const parent = this.store.parentOf(at);
      if (parent === undefined) {
        break;
      }
      ancestors.push(parent);
      at = this.store.get(parent);
    }
    return ancestors;
  }

  // Closes whatever map layer object is open, because the dialog shows one thing at a time. The
  // profile marker goes too, because its chart leaves without a pointerleave.
  private select(id: string|undefined): void {
    this.selected = id;
    this.featureLayer.setSelected(id);
    this.featureLayer.setMarker(undefined);
    this.inspected = undefined;
    this.inspectGeneration += 1;
    if (this.state.inspected) {
      this.updateState({...this.state, inspected: undefined});
    }
    this.refreshFeatureList();
  }

  // Draws the profile from the same samples, since an object from a map layer has no elevations.
  private loadClimb(path: Float64Array): void {
    const generation = this.inspectGeneration;
    const samples = profileSamples(path);
    this.lineSamples = undefined;
    this.updateState({...this.state, lineProfile: {status: 'loading'}});
    this.elevations.sample(samples.latLngDegrees, samples.zoom).then(
        meters => {
          const inspected = this.state.inspected;
          if (generation !== this.inspectGeneration || inspected?.kind !== 'line') {
            return;
          }

          const distanceMeters = slopeMeters(samples.distanceMeters, meters);
          this.lineSamples = {latLngDegrees: samples.latLngDegrees, distanceMeters};
          this.updateState({
            ...this.state,
            inspected: {
              ...inspected,
              lengthMeters: distanceMeters[distanceMeters.length - 1],
              climb: profileStats(meters),
            },
            lineProfile: {
              status: 'loaded',
              distanceMeters: Array.from(distanceMeters),
              meters: Array.from(meters),
              hovered: undefined,
            },
          });
        },
        e => {
          console.error(e);
          if (generation === this.inspectGeneration && this.state.inspected?.kind === 'line') {
            this.updateState({...this.state, lineProfile: {status: 'failed'}});
          }
        });
  }

  // Keeps the selected line's profile in step with its geometry. A line that carries elevations,
  // like an imported track, draws its own so that the chart agrees with the climb above it, and
  // anything else samples the DEM. An inspected object's profile belongs to loadClimb, and a marker
  // stroke has none because it marks up the map rather than following the ground.
  private lineProfileFor(live: EditableFeature|undefined): LineProfileState|undefined {
    if (live?.kind !== 'line' || isMarker(live)) {
      if (this.state.inspected?.kind === 'line') {
        return this.state.lineProfile;
      }
      this.lineProfileGeneration += 1;
      this.lineProfileSource = undefined;
      this.lineSamples = undefined;
      return undefined;
    } else if (
        live.latLngE7 === this.lineProfileSource?.latLngE7
            && live.elevationCentimeters === this.lineProfileSource.elevationCentimeters) {
      return this.state.lineProfile;
    }

    this.lineProfileGeneration += 1;
    this.lineProfileSource = {
      latLngE7: live.latLngE7,
      elevationCentimeters: live.elevationCentimeters,
    };
    const path = Float64Array.from(live.latLngE7, e7 => e7 / 1e7);
    const own = live.elevationCentimeters;
    if (own) {
      const meters = Array.from(own, centimeters => centimeters / 100);
      const distanceMeters = slopeMeters(cumulativeMeters(path), meters);
      this.lineSamples = {latLngDegrees: path, distanceMeters};
      return {
        status: 'loaded',
        distanceMeters: Array.from(distanceMeters),
        meters,
        hovered: undefined,
      };
    }

    const generation = this.lineProfileGeneration;
    const samples = profileSamples(path);
    this.lineSamples = undefined;
    this.elevations.sample(samples.latLngDegrees, samples.zoom).then(
        meters => {
          if (generation !== this.lineProfileGeneration) {
            return;
          }

          const distanceMeters = slopeMeters(samples.distanceMeters, meters);
          this.lineSamples = {latLngDegrees: samples.latLngDegrees, distanceMeters};
          this.updateState({
            ...this.state,
            lineProfile: {
              status: 'loaded',
              distanceMeters: Array.from(distanceMeters),
              meters: Array.from(meters),
              hovered: undefined,
            },
          });
        },
        e => {
          console.error(e);
          if (generation === this.lineProfileGeneration) {
            this.updateState({...this.state, lineProfile: {status: 'failed'}});
          }
        });
    return {status: 'loading'};
  }

  private loadOsmTags(type: 'node'|'way', id: number): void {
    const generation = this.inspectGeneration;
    const loading: Future<GetOsmTagsResponse> =
        requestData('lat.trails.DataService/GetOsmTags', {
          type: type === 'node' ? OsmElementType.NODE : OsmElementType.WAY,
          id: BigInt(id),
        });
    loading
        .then(
            response => response.tags,
            e => {
              console.error(e);
              return 'failed' as const;
            })
        .then(tags => {
          const inspected = this.state.inspected;
          if (generation !== this.inspectGeneration || !inspected?.osm) {
            return;
          }

          this.updateState({
            ...this.state,
            inspected: {...inspected, osm: {...inspected.osm, tags}},
          });
        });
  }

  private editSelectedData(update: (data: FeatureData) => FeatureData, mergeKey?: string): void {
    const live = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    if (!live) {
      return;
    }

    const before = snapshot(live);
    const after = {...snapshot(live), data: stripUndefined(update({...live.data}))};
    // Merged per feature, so that typing in one name and then another stay two undos
    this.store.apply(
        [{id: live.id, before, after}],
        mergeKey !== undefined ? `${mergeKey}:${live.id}` : undefined);
  }

  // The folder a drop onto this row lands in. A row that is not a folder passes it to the folder
  // it is in, so dropping onto a sibling moves nothing.
  private dropFolderFor(e: CorgiEvent<typeof DOM_MOUSE>): string|undefined {
    const row = this.store.get(checkExists(e.actionElement.data('id')).string());
    if (!row) {
      return undefined;
    }
    return row.kind === 'folder' ? row.id : this.store.parentOf(row);
  }

  // Whether the dragged feature may go into folder. A folder cannot move into itself or anything
  // under it.
  private canDropInto(folder: string|undefined): boolean {
    const dragged = this.draggedFeature;
    if (dragged === undefined) {
      return false;
    }
    return folder === undefined
        || (folder !== dragged && !this.ancestorsOf(folder).includes(dragged));
  }

  // Marks folder as the target when the drop is allowed. The browser only drops where dragover
  // called preventDefault.
  private dragOver(e: DragEvent, folder: string|undefined): void {
    if (!this.canDropInto(folder)) {
      this.setDropTarget(undefined);
      return;
    }

    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    this.setDropTarget({folder});
  }

  private drop(e: DragEvent, folder: string|undefined): void {
    const dragged = this.draggedFeature;
    const live = dragged !== undefined ? this.store.get(dragged) : undefined;
    if (!live || !this.canDropInto(folder)) {
      return;
    }

    e.preventDefault();
    this.draggedFeature = undefined;
    this.dropTarget = undefined;
    if (folder !== undefined) {
      this.expand([folder]);
    }
    if (this.store.parentOf(live) === folder) {
      this.refreshFeatureList();
      return;
    }

    const before = snapshot(live);
    const after = {...snapshot(live), data: stripUndefined({...live.data, folder_id: folder})};
    this.store.apply([{id: live.id, before, after}]);
  }

  private setDropTarget(target: {folder: string|undefined}|undefined): void {
    if (target?.folder === this.dropTarget?.folder && !target === !this.dropTarget) {
      return;
    }

    this.dropTarget = target;
    this.refreshFeatureList();
  }

  // Follows the pointer with the length drawn so far, which includes the segment to it.
  private drawnLengthChanged(): void {
    const layer =
        this.state.tool === 'line'
            ? this.lineLayer
            : this.state.tool === 'measure' || this.state.tool === 'terrain'
                ? this.measuringLayer()
                : undefined;
    const pointer = this.pointer;
    const drawnLength =
        layer?.followsPointer() && pointer
            ? {x: pointer[0], y: pointer[1], meters: pathLengthMeters(toDegrees(layer.points()))}
            : undefined;
    const shown = this.state.drawnLength;
    if (
        drawnLength?.x === shown?.x
            && drawnLength?.y === shown?.y
            && drawnLength?.meters === shown?.meters) {
      return;
    }
    this.updateState({...this.state, drawnLength});
  }

  private stopJoining(): void {
    if (this.joining === undefined) {
      return;
    }

    this.joining = undefined;
    this.updateState({...this.state, joining: false});
  }

  // Splits at a vertex, adding one first when the spot is partway along a segment.
  private splitLineAt(id: string, spot: LineSpot): void {
    const live = this.store.get(id);
    if (live?.kind !== 'line') {
      return;
    }

    const line =
        spot.kind === 'segment' ? insertVertex(live, spot.index, spot.latE7, spot.lngE7) : live;
    const halves = splitLine(line, spot.index, crypto.randomUUID());
    if (!halves) {
      return;
    }

    const [first, second] = halves;
    const changes = [
      {id: live.id, before: snapshot(live), after: first},
      {id: second.id, before: undefined, after: second},
    ];
    if (spot.kind === 'segment') {
      this.applyPlacingVertices(
          changes, [{id: live.id, index: spot.index}, {id: second.id, index: 0}]);
    } else {
      this.store.apply(changes);
    }
  }

  // Applies an edit that moved or added vertices, then gives each one on a line with elevations
  // of its own the DEM's elevation as part of the same edit. Every other line samples the DEM for
  // its profile anyway.
  //
  // An edit landing before the DEM answers keeps the patch from merging, so the patch becomes an
  // undo of its own. The DEM usually answers well before anyone can edit again.
  private applyPlacingVertices(
      changes: Change[], placed: Array<{id: string; index: number}>): void {
    const mergeKey = `placed:${crypto.randomUUID()}`;
    this.store.apply(changes, mergeKey);
    const targets = placed.flatMap(({id, index}) => {
      const line = this.store.get(id);
      return line?.kind === 'line' && line.elevationCentimeters
          ? [{id, index, latLngE7: line.latLngE7}]
          : [];
    });
    if (targets.length === 0) {
      return;
    }

    const latLngE7 = Int32Array.from(
        targets.flatMap(({index, latLngE7}) => [latLngE7[2 * index], latLngE7[2 * index + 1]]));
    this.sampleVertices(latLngE7).then(centimeters => {
      if (!centimeters) {
        return;
      }

      const patches = targets.flatMap(({id, index, latLngE7}, i) => {
        const live = this.store.get(id);
        // Geometry edits replace the array rather than writing through it, so the same array means
        // the line has kept its shape since.
        if (live?.kind !== 'line' || live.latLngE7 !== latLngE7 || !live.elevationCentimeters) {
          return [];
        }

        const elevationCentimeters = live.elevationCentimeters.slice();
        elevationCentimeters[index] = centimeters[i];
        return [{id, before: snapshot(live), after: {...snapshot(live), elevationCentimeters}}];
      });
      this.store.apply(patches, mergeKey);
    });
  }

  private editLine(id: string, edit: (line: EditableLine) => EditableLine|undefined): void {
    const live = this.store.get(id);
    const after = live?.kind === 'line' ? edit(live) : undefined;
    if (live && after) {
      this.store.apply([{id, before: snapshot(live), after}]);
    }
  }

  // Selects the copy, because it lands exactly on the original and would otherwise look like
  // nothing happened.
  private duplicateFeature(id: string): void {
    const live = this.store.get(id);
    if (!live) {
      return;
    }

    const copy = {...snapshot(live), id: crypto.randomUUID(), version: 0n};
    if (copy.data.name) {
      copy.data.name = `${copy.data.name} copy`;
    }
    this.store.apply([{id: copy.id, before: undefined, after: copy}]);
    this.select(copy.id);
  }

  // In the order given, which for a folder is its descendants deepest first and then itself, so
  // each folder is empty by the time its delete lands.
  private deleteFeatures(features: EditableFeature[]): void {
    this.store.apply(features.map(f => ({id: f.id, before: snapshot(f), after: undefined})));
    if (features.some(f => f.id === this.selected)) {
      this.select(undefined);
    }
  }

  // Hands the list copies, because the store edits features in place and corgi skips rendering a
  // component whose props are the same objects as last time.
  private refreshFeatureList(): void {
    const live = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    const selected = live && snapshot(live);
    this.updateState({
      ...this.state,
      features: {
        ...this.state.features,
        all: [...this.store.all()].map(snapshot),
        selected,
        selectedDescendants:
            selected?.kind === 'folder' ? this.store.descendants(selected.id).length : 0,
        hoveredAncestors: new Set(this.ancestorsOf(this.state.features.hovered)),
        dropTarget: this.dropTarget,
      },
      lineProfile: this.lineProfileFor(live),
    });
  }

  private newCollection(): void {
    this.collectionGeneration += 1;
    this.saves.clear();
    this.select(undefined);
    this.setHidden([]);
    this.store.reset([], /* readOnly= */ false);
    this.updateState({
      ...this.state,
      collection: undefined,
      collectionStatus: 'loaded',
    });
    this.history.silentlyReplaceUrl('/');
  }

  // Empties the list while the collection loads, or else the last one's rows are left to click.
  private openCollection(collection: Collection): void {
    this.saves.clear();
    this.select(undefined);
    this.setHidden([]);
    this.store.reset([], this.store.isReadOnly());
    this.updateState({
      ...this.state,
      collection,
      features: {...this.state.features, expanded: new Set()},
    });
    this.history.silentlyReplaceUrl(`/collection/${collection.id}`);
    this.loadCollection(collection.id, /* fit= */ true);
  }

  private renameCollection(collection: Collection): void {
    this.dialog.display(RenameDialog({
      collection,
      renamed: renamed => {
        if (this.state.collection?.id === renamed.id) {
          this.updateState({...this.state, collection: renamed});
        }
      },
    })).catch(() => {});
  }

  private deleteCollection(collection: Collection): void {
    const count = [...this.store.all()].length;
    this.dialog.display(ConfirmDeleteCollectionDialog({count, name: collection.name}))
        .then(() => {
          const deleted: Future<DeleteCollectionResponse> =
              requestData('lat.trails.DataService/DeleteCollection', {id: collection.id});
          return deleted;
        }, () => undefined)
        .then(response => {
          if (response && this.state.collection?.id === collection.id) {
            this.newCollection();
          }
        })
        .catch(e => {
          console.error(e);
        });
  }

  private loadCollection(id: string, fit: boolean): void {
    this.collectionGeneration += 1;
    const generation = this.collectionGeneration;
    const hidden = this.state.features.hidden;
    this.updateState({...this.state, collectionStatus: 'loading'});
    const loading: Future<GetCollectionResponse> =
        requestData('lat.trails.DataService/GetCollection', {id});
    loading
        .then(response => {
          if (generation !== this.collectionGeneration) {
            return;
          }
          this.updateState({
            ...this.state,
            collection: response.collection,
            collectionStatus: 'loaded',
          });
          const readOnly = response.collection?.role === Role.READ;
          // A toggle made since the request, like on the rows the server rendered, is newer than
          // what the response read.
          if (this.state.features.hidden === hidden) {
            this.setHidden(response.hiddenFeatureIds);
          }
          const features = [
            ...response.folders.map(folderFromProto),
            ...response.lines.map(lineFromProto),
            ...response.points.map(pointFromProto),
          ];
          this.expand(topLevelFolderIds(features, this.state.features.hidden));
          this.store.reset(features, readOnly);
          if (fit) {
            this.fitCamera(featureLatLngDegrees(this.store.all()));
          }
          const tool = this.state.tool;
          if (readOnly && (tool === 'point' || tool === 'line' || tool === 'marker')) {
            this.setTool('pointer');
          }
        })
        .catch(e => {
          console.error(e);
          if (generation === this.collectionGeneration) {
            this.updateState({...this.state, collectionStatus: 'failed'});
          }
        });
  }

  private importFiles(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.gpx,.json,application/geo+json,application/gpx+xml';
    input.multiple = true;
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      Promise.all(files.map(file => this.importOne(file)))
          .then(results => {
            // One edit for the whole pick, so that a single undo takes back everything it added.
            this.store.apply(results.flatMap(r => r.changes));
            const failed = results.flatMap(r => r.failed ? [r.failed] : []);
            if (failed.length > 0) {
              this.dialog.display(ImportFailedDialog({files: failed})).catch(() => {});
            }
          });
    });
    input.click();
  }

  private download(text: string, extension: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], {type}));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.state.collection?.name || 'trails'}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Wraps the file's features in a folder named after it, so that importing a pile of files does
  // not bury the collection's root. Reports the file's name when it yielded nothing, so that
  // picking several files names every one that failed in a single dialog.
  private importOne(file: File): Promise<{changes: Change[]; failed?: string}> {
    return file.text()
        .then(text => {
          const features = parseImport(text);
          // A GPX carrying only routes parses and still leaves nothing to draw, which looks the
          // same to somebody who picked a file and watched the map not change.
          if (features.length === 0) {
            return {changes: [], failed: file.name};
          }

          const folder: EditableFeature = {
            kind: 'folder',
            id: crypto.randomUUID(),
            version: 0n,
            data: {name: file.name.replace(/\.[^.]*$/, '')},
          };
          for (const feature of features) {
            feature.data.folder_id ??= folder.id;
          }
          return {
            changes: [folder, ...features].map(f => ({id: f.id, before: undefined, after: f})),
          };
        })
        .catch(e => {
          console.error(e);
          return {changes: [], failed: file.name};
        });
  }

  private save(entries: SaveEntry[]): Promise<bigint> {
    return this.currentCollection()
        .then(collectionId => {
          const saved: Future<SaveResponse> =
              requestData('lat.trails.DataService/Save', {
                collectionId,
                writes: entries.map(e => toWrite(e.op, e.feature)),
              });
          return saved;
        })
        .then(response => response.version);
  }

  // Dismissing the dialog arms it again, so a later failure is not silent.
  private warnUnsaved(): void {
    if (this.warnedUnsaved) {
      return;
    }

    this.warnedUnsaved = true;
    const dismissed = () => {
      this.warnedUnsaved = false;
    };
    this.dialog.display(SaveFailedDialog({})).then(dismissed, dismissed);
  }

  private currentCollection(): Promise<string> {
    const open = this.state.collection;
    if (open) {
      return Promise.resolve(open.id);
    }

    return this.requireLogin()
        .then(() => {
          const created: Future<CreateCollectionResponse> =
              requestData(
                  'lat.trails.DataService/CreateCollection', {name: newCollectionName()});
          return created;
        })
        .then(response => {
          const collection = checkExists(response.collection);
          this.updateState({
            ...this.state,
            collection,
          });
          this.history.silentlyReplaceUrl(`/collection/${collection.id}`);
          // Anything hidden before the collection existed had nowhere to save to.
          if (this.state.features.hidden.size > 0) {
            this.saveViewState();
          }
          return collection.id;
        });
  }

  private setHidden(ids: Iterable<string>): void {
    const hidden = new Set(ids);
    this.featureLayer.setHidden(hidden);
    this.updateState({...this.state, features: {...this.state.features, hidden}});
  }

  private expand(ids: Iterable<string>): void {
    const expanded = new Set([...this.state.features.expanded, ...ids]);
    this.updateState({...this.state, features: {...this.state.features, expanded}});
  }

  // Viewers get no view state, so they start from the owner's every time they open the collection.
  private saveViewState(): void {
    const collection = this.state.collection;
    if (!collection || (collection.role !== Role.OWNER && collection.role !== Role.WRITE)) {
      return;
    }

    const request = {
      collectionId: collection.id,
      hiddenFeatureIds: [...this.state.features.hidden],
    };
    this.viewStateWrites = this.viewStateWrites
        .then(() => {
          const saved: Future<SetViewStateResponse> =
              requestData('lat.trails.DataService/SetViewState', request);
          return saved;
        })
        .then(() => {}, e => {
          console.error(e);
        });
  }

  private requireLogin(): Promise<void> {
    if (this.login) {
      return this.login.promise;
    }

    // Somebody already signed in whose GetCurrentUser has not landed yet gets a popup if we go by
    // finished, so wait the fetch out instead.
    return this.state.self.then(
        response => response.user ? Promise.resolve() : this.openLogin());
  }

  private openLogin(): Promise<void> {
    if (this.login) {
      return this.login.promise;
    }

    const popup = window.open('/login/google', 'login', 'height=700,popup,width=500');
    if (!popup) {
      return Promise.reject(new Error('Unable to open the login window'));
    }

    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.login = {popup, promise, resolve, reject};
    this.loginWatcher.start();
    return promise;
  }

  // Closes whatever menu is open and makes trigger's the one to open. Answers false when trigger's
  // own menu was the open one, so that clicking it again only closes it.
  private claimMenu(trigger: Element): boolean {
    const toggled = this.menuOverlay?.isConnected && this.menuTrigger === trigger;
    this.closeMenu();
    this.menuTrigger = toggled ? undefined : trigger;
    return !toggled;
  }

  private closeMenu(): void {
    this.menuOverlay?.remove();
    this.menuOverlay = undefined;
    this.menuTrigger = undefined;
  }

  private openContextMenu(items: MenuEntries, x: number, y: number): void {
    this.closeMenu();
    this.menu.open(items, {x, y}, this.root, {anchor: 'top_left', classes: MENU_CLASSES});
    this.menuOverlay = this.root.lastElementChild ?? undefined;
  }

  private openMenu(items: MenuEntries, trigger: Element): void {
    if (this.menuTrigger !== trigger) {
      return;
    }

    const bound = trigger.getBoundingClientRect();
    this.menu.open(
        items,
        {x: bound.left, y: bound.bottom},
        this.root,
        {anchor: 'top_left', classes: MENU_CLASSES});
    this.menuOverlay = this.root.lastElementChild ?? undefined;
  }

  // The formatters read the unit system from a global rather than from props, so a rerender with
  // caching on would skip every element whose props are unchanged.
  private setUnitSystem(system: UnitSystem): void {
    setUnitSystem(system);
    const nodes =
        updateLayerNode(
            this.state.layers.nodes,
            'topography/contours',
            node => ({...node as LayerEntry, layer: this.contours[system]}));
    corgi.vdomCaching.disable();
    this.updateState({...this.state, layers: {...this.state.layers, nodes}}).then(() => {
      corgi.vdomCaching.enable();
    });
    this.setMapLayers(nodes);
  }

  private newContourLayer(style: Readonly<Style>): MbtileLayer {
    return new MbtileLayer(
        [COPERNICUS_COPYRIGHT, {
          long: 'Contains modified NASADEM data 2000',
        }],
        'https://tiles.trailcatalog.org/contours/${id.zoom}/${id.x}/${id.y}.pbf',
        style,
        /* extraZoom= */ 0,
        /* minZoom= */ 9,
        /* maxZoom= */ 14,
        this.mapController.renderer);
  }

  private newGoesEntry(satellite: 'East'|'West', product: string, label: string): LayerEntry {
    return {
      kind: 'layer',
      id: `satellite/goes/${satellite}_${product}`,
      name: `${satellite} ${label}`,
      enabled: false,
      layer: new RasterTileLayer(
          [
            {
              long:
                  `GOES-${satellite} ABI imagery from NOAA, tiled by NASA Global Imagery Browse `
                      + 'Services',
              short: 'NOAA/NASA GIBS',
              url: 'https://nasa-gibs.github.io/gibs-api-docs/',
            },
          ],
          // The path is style/time/matrix set, and "default" for time means the most recent scan
          // GIBS has finished tiling, which runs about 20 minutes behind the satellite.
          `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-${satellite}_ABI_${product}`
              + '/default/default/GoogleMapsCompatible_Level7'
              + '/${id.zoom}/${id.y}/${id.x}.png',
          /* tint= */ 0xFFFFFFFF as RgbaU32,
          /* z= */ Z_OVERLAY_TERRAIN,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          // GoogleMapsCompatible_Level7 stops at zoom 7, which is about the 2 km resolution ABI
          // gives away from the sub-satellite point anyway.
          /* maxZoom= */ 7,
          this.mapController.renderer,
      ),
      controls: [],
      values: {},
    };
  }

  private layerNodeOf(e: CorgiEvent<typeof DOM_MOUSE>): LayerNode {
    const id = checkExists(e.actionElement.data('id')).string();
    return checkExists(findLayerNode(this.state.layers.nodes, id));
  }

  private toggleLayerExpanded(id: string): void {
    const expanded = new Set(this.state.layers.expanded);
    if (!expanded.delete(id)) {
      expanded.add(id);
    }
    this.updateState({...this.state, layers: {...this.state.layers, expanded}});
  }

  private setLayerEnabled(id: string, enabled: boolean): void {
    const nodes = updateLayerNode(this.state.layers.nodes, id, node => ({...node, enabled}));
    this.updateState({
      ...this.state,
      layers: {...this.state.layers, nodes},
    });
    this.setMapLayers(nodes);
  }

  private setMapLayers(nodes: LayerNode[]): void {
    const entries = layerEntries(nodes);
    for (const {entry, shown} of entries) {
      if (entry.layer instanceof CollectionLayer) {
        // A hidden layer's geometry would otherwise answer hovers and catch the line tool.
        entry.layer.setIndexed(shown);
      }
    }
    // The map draws by z, so this order only decides who hears events first. Nodes sit on
    // everything they share the map with and claim what lands on an icon.
    const shown = entries.filter(({shown}) => shown).map(({entry}) => entry.layer);
    this.mapController.setLayers(
        [
          this.pointLayer,
          this.markerLayer,
          this.lineLayer,
          this.measureLayer,
          this.terrainLayer,
          this.featureLayer as Layer,
        ]
            .concat(shown.filter(layer => layer instanceof PointCollectionLayer))
            .concat(shown.filter(layer => !(layer instanceof PointCollectionLayer)))
            .concat([this.skyboxLayer]));
  }
}

// Mercator to interleaved lat then lng degrees
function toDegrees(points: Float64Array): Float64Array {
  const degrees = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    const ll = unprojectS2LatLng(points[i], points[i + 1]);
    degrees[i] = ll.latDegrees();
    degrees[i + 1] = ll.lngDegrees();
  }
  return degrees;
}

// The point's own spot, the spot on a line nearest the click, or else the click
function coordinatesOf(
    feature: EditableFeature|undefined,
    spot: LineSpot|undefined,
    latE7: number,
    lngE7: number): [number, number] {
  if (feature?.kind === 'point') {
    return [feature.latE7, feature.lngE7];
  } else if (feature?.kind === 'line' && spot?.kind === 'vertex') {
    return [feature.latLngE7[2 * spot.index], feature.latLngE7[2 * spot.index + 1]];
  } else if (spot?.kind === 'segment') {
    return [spot.latE7, spot.lngE7];
  }
  return [latE7, lngE7];
}

function stripUndefined(data: FeatureData): FeatureData {
  const stripped: FeatureData = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      stripped[key] = value;
    }
  }
  return stripped;
}

// The local day, because that is what a date input shows and edits
function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// An empty day leaves that end open, which STAC writes as ..
function sentinelSearch(values: ControlValues): Search {
  const from = String(values.from);
  const to = String(values.to);
  return {
    // Without a zone, Date reads these as local time.
    from: from ? new Date(`${from}T00:00:00`).toISOString() : '..',
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : '..',
    query: {'eo:cloud_cover': {lte: values.cloud}},
  };
}

function newCollectionName(): string {
  return `Untitled collection ${new Date().toLocaleDateString()}`;
}

// A point's id is twice its node's id, or twice its way's id plus one. Keep in sync with
// ExtractPoints.kt#nodePointId.
function osmElementOf(pointId: number): {type: 'node'|'way'; id: number} {
  return pointId % 2 === 0
      ? {type: 'node', id: pointId / 2}
      : {type: 'way', id: (pointId - 1) / 2};
}
