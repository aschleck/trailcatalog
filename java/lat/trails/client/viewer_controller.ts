import { checkExists, exists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';
import { Timer } from 'external/dev_april_corgi+/js/common/timer';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { CorgiEvent, DOM_MOUSE, DOM_POINTER } from 'external/dev_april_corgi+/js/corgi/events';
import { HistoryService } from 'external/dev_april_corgi+/js/corgi/history/history_service';
import { DialogService } from 'external/dev_april_corgi+/js/emu/dialog';
import { ACTION, CHANGED } from 'external/dev_april_corgi+/js/emu/events';
import { MenuEntries } from 'external/dev_april_corgi+/js/emu/menu/menu_controller';
import { MenuService } from 'external/dev_april_corgi+/js/emu/menu/menu_service';

import { S2LatLng } from 'java/org/trailcatalog/s2';
import { projectS2LatLng, unprojectS2LatLng } from 'js/map/camera';
import { RgbaU32 } from 'js/map/common/types';
import { CLICKED, MAP_MOVED } from 'js/map/events';
import { Layer } from 'js/map/layer';
import { SkyboxLayer } from 'js/map/layers/skybox_layer';
import { MapController } from 'js/map/map_controller';
import { EarthSearchLayer } from 'js/map/layers/earth_search_layer';
import { MbtileLayer, CONTOURS_FEET, CONTOURS_METERS } from 'js/map/layers/mbtile_layer';
import { RasterTileLayer } from 'js/map/layers/raster_tile_layer';
import { Elevations } from 'js/map/workers/elevations';
import { LocationIndex } from 'js/map/workers/location_index';
import { Z_BASE_SATELLITE, Z_BASE_TERRAIN, Z_BOTTOM, Z_OVERLAY_TERRAIN } from 'js/map/z';
import {
  Collection,
  CreateCollectionResponse,
  GetCollectionResponse,
  GetCurrentUserResponse,
  ListCollectionsResponse,
  SaveResponse,
} from 'trails_lat/proto/data_pb';

import { CollectionLayer } from './collection_layer';
import { NATURE_PROTOMAPS, NATURE_WITHOUT_DETAILED_WAYS, OSM_PATHS, PUBLIC_LAND } from './styles';
import { invalidateCurrentUser, requestData } from './data';
import { ConfirmDeleteDialog, ImportFailedDialog, SaveFailedDialog } from './dialogs';
import { DrawingLayer, toE7Array } from './drawing_layer';
import {
  FEATURE_CLICKED,
  FEATURE_EDITED,
  FEATURE_HOVERED,
  HOVER_CHANGED,
  LINE_DRAWN,
  POINT_PLACED,
  Tool,
  TOOL_REQUESTED,
} from './events';
import { toGeoJson, toGpx } from './exporter';
import { FeatureLayer } from './feature_layer';
import { buildTree, FeatureListState, foldersOf } from './feature_list';
import { Change, FeatureStore } from './feature_store';
import {
  DEFAULT_POINT_COLOR,
  EditableFeature,
  EditableLine,
  FeatureData,
  folderFromProto,
  importableIcon,
  lineFromProto,
  pointFromProto,
  snapshot,
  toWrite,
} from './features';
import { parseImport } from './importer';
import { IconPickerDialog } from './icon_picker';
import { MeasureState } from './measure_panel';
import { PointToolLayer } from './point_tool_layer';
import { haversineMeters, profileSamples, ProfileSamples, profileStats } from './measurements';
import { MENU_CLASSES } from './menubar';
import { SaveEntry, SaveQueue } from './save_queue';

const MAPTERHORN_COPYRIGHT = {
  long: 'Mapterhorn',
  short: 'Mapterhorn',
  url: 'https://mapterhorn.com/attribution',
};
// No short form, so that it shows in the full list and leaves the credit bar to Mapterhorn
const COPERNICUS_COPYRIGHT = {
  long: 'Contains modified Copernicus Sentinel data 2021',
};

export interface LayerState {
  name: string;
  enabled: boolean;
  layer: Layer;
}

export interface Args {
  // The id of the open collection or none
  collection: string|undefined;
}

export interface State {
  collection: Collection|undefined;
  features: FeatureListState;
  layers: LayerState[];
  measure: MeasureState;
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
  private readonly pointLayer: PointToolLayer;
  private readonly skyboxLayer: SkyboxLayer;
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
  private selected: string|undefined;
  private readonly hidden: Set<string>;
  private readonly expanded: Set<string>;
  // Logins run in a popup on Google's origin, so a caller waiting on one waits on this.
  private login: {
    popup: Window;
    promise: Promise<void>;
    resolve: () => void;
    reject: (e: unknown) => void;
  }|undefined;
  private readonly loginWatcher: Timer;
  private readonly saves: SaveQueue;
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
    this.elevations = new Elevations();
    this.profileDebouncer = new Debouncer(/* delayMs= */ 150, () => {
      this.sampleProfile();
    });
    this.measureSamples = undefined;
    this.profileGeneration = 0;
    this.measuredPath = undefined;
    this.selected = undefined;
    this.hidden = new Set();
    this.expanded = new Set();
    this.store.listen(() => {
      this.refreshFeatureList();
    });
    this.warnedUnsaved = false;
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
    this.lineLayer =
        new DrawingLayer(
            'line',
            locations,
            camera,
            renderer);
    this.registerDisposable(this.lineLayer);
    this.measureLayer =
        new DrawingLayer(
            'measure',
            locations,
            camera,
            renderer,
            () => {
              this.measureChanged();
            },
            [MAPTERHORN_COPYRIGHT]);
    this.registerDisposable(this.measureLayer);
    this.pointLayer = new PointToolLayer();
    this.registerDisposable(this.pointLayer);

    this.registerListener(window, 'keydown', e => {
      this.keyPressed(e);
    });

    this.skyboxLayer = new SkyboxLayer(Z_BOTTOM, this.mapController.renderer);
    this.registerDisposable(this.skyboxLayer);

    const allLayers = [{
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
    }, {
      name: 'Contours (feet)',
      enabled: true,
      layer: new MbtileLayer(
          [MAPTERHORN_COPYRIGHT, COPERNICUS_COPYRIGHT, {
            long: 'Contains modified NASADEM data 2000',
          }],
          'https://tiles.trailcatalog.org/contours/${id.zoom}/${id.x}/${id.y}.pbf',
          CONTOURS_FEET,
          /* extraZoom= */ 0,
          /* minZoom= */ 9,
          /* maxZoom= */ 14,
          this.mapController.renderer,
      ),
    }, {
      name: 'Contours (meters)',
      enabled: false,
      layer: new MbtileLayer(
          [MAPTERHORN_COPYRIGHT, COPERNICUS_COPYRIGHT, {
            long: 'Contains modified NASADEM data 2000',
          }],
          'https://tiles.trailcatalog.org/contours/${id.zoom}/${id.x}/${id.y}.pbf',
          CONTOURS_METERS,
          /* extraZoom= */ 0,
          /* minZoom= */ 9,
          /* maxZoom= */ 14,
          this.mapController.renderer,
      ),
    }, {
      name: 'MapTiler vector',
      enabled: false,
      layer: new MbtileLayer(
          [
            {
              long: 'Base political and transportation packaged and served by MapTiler',
              short: 'MapTiler',
              url: 'https://www.maptiler.com/copyright/',
            },
            {
              long: 'Base political and transportation data provided by the OpenStreetMap project',
              short: 'OpenStreetMap contributors',
              url: 'https://www.openstreetmap.org/copyright',
            },
          ],
          'https://api.maptiler.com/tiles/v3/${id.zoom}/${id.x}/${id.y}.pbf?'
              + 'key=UGTHB0b969Xa1xpZvnvB',
          NATURE_WITHOUT_DETAILED_WAYS,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          /* maxZoom= */ 15,
          this.mapController.renderer,
      ),
    }, {
      name: 'MapTiler satellite',
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
    }, {
      name: 'Protomaps',
      enabled: true,
      layer: new MbtileLayer(
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
      ),
    }, {
      name: 'Sentinel L2A (last 7 days)',
      enabled: false,
      layer: new EarthSearchLayer(
        'sentinel-2-l2a',
        7 /* days */,
        {},
        Z_BASE_SATELLITE,
        this.mapController.renderer),
    }, {
      name: 'Sentinel L2A (cloud-free)',
      enabled: false,
      layer: new EarthSearchLayer(
        'sentinel-2-l2a',
        365 /* days */,
        {'eo:cloud_cover': {'gte': 0, 'lte': 5}},
        Z_BASE_SATELLITE,
        this.mapController.renderer),
    }, {
      name: 'GOES-East GeoColor',
      enabled: false,
      layer: new RasterTileLayer(
          [
            {
              long: 'GOES-East ABI imagery from NOAA, tiled by NASA Global Imagery Browse Services',
              short: 'NOAA/NASA GIBS',
              url: 'https://nasa-gibs.github.io/gibs-api-docs/',
            },
          ],
          // The path is style/time/matrix set, and "default" for time means the most recent scan
          // GIBS has finished tiling, which runs about 20 minutes behind the satellite.
          'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_GeoColor'
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
    }, {
      name: 'GOES-East fire temperature',
      enabled: false,
      layer: new RasterTileLayer(
          [
            {
              long: 'GOES-East ABI imagery from NOAA, tiled by NASA Global Imagery Browse Services',
              short: 'NOAA/NASA GIBS',
              url: 'https://nasa-gibs.github.io/gibs-api-docs/',
            },
          ],
          // The path is style/time/matrix set, and "default" for time means the most recent scan
          // GIBS has finished tiling, which runs about 20 minutes behind the satellite.
          'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_FireTemp'
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
    }, {
      name: 'GOES-West GeoColor',
      enabled: false,
      layer: new RasterTileLayer(
          [
            {
              long: 'GOES-West ABI imagery from NOAA, tiled by NASA Global Imagery Browse Services',
              short: 'NOAA/NASA GIBS',
              url: 'https://nasa-gibs.github.io/gibs-api-docs/',
            },
          ],
          // The path is style/time/matrix set, and "default" for time means the most recent scan
          // GIBS has finished tiling, which runs about 20 minutes behind the satellite.
          'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-West_ABI_GeoColor'
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
    }, {
      name: 'GOES-West fire temperature',
      enabled: false,
      layer: new RasterTileLayer(
          [
            {
              long: 'GOES-West ABI imagery from NOAA, tiled by NASA Global Imagery Browse Services',
              short: 'NOAA/NASA GIBS',
              url: 'https://nasa-gibs.github.io/gibs-api-docs/',
            },
          ],
          // The path is style/time/matrix set, and "default" for time means the most recent scan
          // GIBS has finished tiling, which runs about 20 minutes behind the satellite.
          'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-West_ABI_FireTemp'
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
    }, {
      name: 'US public land',
      enabled: false,
      layer: new CollectionLayer(
          '/api/collections/22b0cb56-dc1f-4546-8615-3382dc3eb44a',
          PUBLIC_LAND,
          // Snapping to a level whose cells are a few pixels across is invisible and saves most of
          // the geometry, but past zoom 10 we want the real boundaries.
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
            // in. Level 5 costs 205 requests for a view of the western US instead of 68, and 2.9 MB
            // instead of 4.5 MB at zoom 11.
            {minZoom: 0, maxZoom: undefined, indexBottom: 5, fromLevel: 0, toLevel: 10},
            // Everything smaller. A level 6 cell holds up to 11k of these, which is why they wait
            // until the viewport is small enough to be worth it.
            {minZoom: 7, maxZoom: undefined, indexBottom: 6, fromLevel: 11, toLevel: undefined},
          ],
          locations,
          this.mapController.camera,
          this.mapController.renderer,
      ),
    }, {
      name: 'OSM paths',
      // On by default because NATURE_WITHOUT_DETAILED_WAYS hands it the ways.
      enabled: true,
      layer: new CollectionLayer(
          '/api/collections/00000000-0000-0000-0000-000000000001',
          OSM_PATHS,
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
            // Only the tiling moves between bands. They all carry levels 11 and deeper, so crossing
            // a zoom boundary can never leave a level uncovered.
            //
            // Level 9 is the coarsest safe tiling. The worst level 9 cell on the planet is central
            // Berlin at 221k paths for 3.7 MB, against 94k at level 10 and 34k at level 11.
            {minZoom: 10, maxZoom: 12, indexBottom: 9, fromLevel: 11, toLevel: undefined},
            {minZoom: 12, maxZoom: 14, indexBottom: 10, fromLevel: 11, toLevel: undefined},
            {minZoom: 14, maxZoom: undefined, indexBottom: 11, fromLevel: 11, toLevel: undefined},
            // Carry the long ways separately, or a river keeps its short ways and loses the long
            // stretches of its mainstem. A way is assigned to the smallest cell containing it and a
            // range query only reaches cells at or below its own level, so nothing above can pick
            // these up. 153k paths sit above level 10, 42% of them waterways, and the share climbs
            // with length: 87 of the 101 paths at level 4.
            //
            // Tile the two ends differently because they cost differently. Levels 0 to 8 are rare
            // enough for level 4, where the worst tile on the planet holds 188 and a real one runs
            // about 25 kb. Levels 9 and 10 are 25x more numerous, so they need level 7 for 9 to
            // 42 kb against the 1.5 MB a level 4 tile of them costs.
            //
            // fromLevel 0 buys the 18 ways above level 4 for 8 to 19 ancestor requests a viewport.
            // They are ferry routes and a rail line, and a layer that draws every way draws those.
            {minZoom: 10, maxZoom: undefined, indexBottom: 4, fromLevel: 0, toLevel: 8},
            {minZoom: 10, maxZoom: undefined, indexBottom: 7, fromLevel: 9, toLevel: 10},
          ],
          locations,
          this.mapController.camera,
          this.mapController.renderer,
      ),
    }];
    for (const layer of allLayers) {
      this.registerDisposable(layer.layer);
    }
    this.updateState({
      ...this.state,
      layers: allLayers,
    });
    this.setMapLayers(allLayers);

    const collection = response.args.collection;
    if (collection) {
      this.loadCollection(collection);
    }
  }

  onHoverChange(e: CorgiEvent<typeof HOVER_CHANGED>): void {
    console.log(e.detail);
  }

  onLineDrawn(e: CorgiEvent<typeof LINE_DRAWN>): void {
    const line: EditableLine = {
      kind: 'line',
      id: crypto.randomUUID(),
      version: 0n,
      data: {},
      latLngE7: e.detail.latLngE7,
      elevationCentimeters: undefined,
      timeSeconds: undefined,
    };
    this.store.apply([{id: line.id, before: undefined, after: line}]);
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
      this.expanded.add(parent);
    }
    this.store.apply([{id: point.id, before: undefined, after: point}]);
    this.select(point.id);
  }

  onToolRequested(e: CorgiEvent<typeof TOOL_REQUESTED>): void {
    this.setTool(e.detail.tool);
  }

  // Opens the folders above what the map selected and scrolls to it, so that the list shows it.
  onFeatureClicked(e: CorgiEvent<typeof FEATURE_CLICKED>): void {
    const id = e.detail.id;
    for (const ancestor of this.ancestorsOf(id)) {
      this.expanded.add(ancestor);
    }
    this.select(id);
    if (id !== undefined) {
      // After the render that puts the row in the list
      requestAnimationFrame(() => {
        this.root.querySelector(`div[data-id="${id}"]`)?.scrollIntoView({block: 'nearest'});
      });
    }
  }

  onFeatureEdited(e: CorgiEvent<typeof FEATURE_EDITED>): void {
    const {before, after} = e.detail;
    this.store.apply([{id: after.id, before, after}]);
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

  folderToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    if (!this.expanded.delete(id)) {
      this.expanded.add(id);
    }
    this.refreshFeatureList();
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
    this.measureLayer.popVertex();
  }

  profileHovered(e: CorgiEvent<typeof DOM_POINTER>): void {
    const samples = this.measureSamples;
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
    this.measureLayer.setMarker(projectS2LatLng(ll));
    this.updateState({...this.state, measure: {...this.state.measure, hovered: index}});
  }

  profileLeft(): void {
    this.measureLayer.setMarker(undefined);
    this.updateState({...this.state, measure: {...this.state.measure, hovered: undefined}});
  }

  // Samples elevations at the vertices so that the saved line carries them like an imported one.
  saveMeasurementClicked(): void {
    const latLngE7 = toE7Array(this.measureLayer.points());
    if (latLngE7.length < 4) {
      return;
    }

    const degrees = Float64Array.from(latLngE7, e7 => e7 / 1e7);
    this.elevations.sample(degrees, profileSamples(degrees).zoom)
        .then(meters => Int32Array.from(meters, m => Math.round(m * 100)), () => undefined)
        .then(elevationCentimeters => {
          const line: EditableLine = {
            kind: 'line',
            id: crypto.randomUUID(),
            version: 0n,
            data: {},
            latLngE7,
            elevationCentimeters,
            timeSeconds: undefined,
          };
          this.store.apply([{id: line.id, before: undefined, after: line}]);
          this.setTool('pointer');
          this.select(line.id);
        });
  }

  visibilityToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const id = checkExists(e.actionElement.data('id')).string();
    if (!this.hidden.delete(id)) {
      this.hidden.add(id);
    }
    this.featureLayer.setHidden(new Set(this.hidden));
    this.refreshFeatureList();
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
      this.expanded.add(parent);
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
      this.expanded.add(folder);
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

  layerToggled(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const index = checkExists(e.actionElement.data('index')).number();
    this.setLayerEnabled(index, !this.state.layers[index].enabled);
  }

  fileMenuClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
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
      if (response.collections.length > 0) {
        items.push({
          kind: 'menu',
          label: 'Open',
          items: response.collections.map(collection => ({
            kind: 'menu_item' as const,
            label: collection.name,
            action: () => {
              this.openCollection(collection);
            },
          })),
        });
      } else {
        items.push({kind: 'menu_item', label: 'Open', disabled: true, action: () => {}});
      }
      items.push({kind: 'divider'});
      items.push({
        kind: 'menu_item',
        label: 'Import',
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
      this.openMenu(items, e);
    });
  }

  toolClicked(e: CorgiEvent<typeof ACTION>): void {
    this.setTool(checkExists(e.actionElement.data('tool')).string() as Tool);
  }

  userMenuClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.openMenu([{
      kind: 'menu_item',
      label: 'Log out',
      action: () => {
        // Force a page refresh as part of logging out
        window.location.href = '/logout';
      },
    }], e);
  }

  loginClicked(): void {
    this.requireLogin().catch(e => {
      console.error(e);
    });
  }

  // Deactivates before activating, because both drawing layers share the index's routing switch.
  private setTool(tool: Tool): void {
    this.lineLayer.setActive(false);
    this.measureLayer.setActive(false);
    this.pointLayer.setActive(tool === 'point');
    this.featureLayer.setInteractive(tool === 'pointer');
    // Refreshes the credits, because the measure layer's only count while it is active
    this.setMapLayers(this.state.layers);
    if (tool === 'line') {
      this.lineLayer.setActive(true);
    } else if (tool === 'measure') {
      this.measureLayer.setActive(true);
    }
    this.updateState({
      ...this.state,
      tool,
    });
  }

  // Skipped while typing, so that the browser's own undo still works in text fields.
  private keyPressed(e: KeyboardEvent): void {
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
    const path = this.measurePath();
    const measured = this.measuredPath;
    if (measured && measured.length === path.length && measured.every((v, i) => v === path[i])) {
      return;
    }
    this.measuredPath = path;
    let lengthMeters = 0;
    for (let i = 2; i < path.length; i += 2) {
      lengthMeters += haversineMeters(path[i - 2], path[i - 1], path[i], path[i + 1]);
    }
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

          this.measureSamples = samples;
          this.updateState({
            ...this.state,
            measure: {
              ...this.state.measure,
              profile: {
                distanceMeters: Array.from(samples.distanceMeters),
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

  // The placed part of the measurement as interleaved lat then lng degrees. The segment to the
  // cursor is left out, because the numbers are about what was clicked.
  private measurePath(): Float64Array {
    const points = this.measureLayer.placedPoints();
    const path = new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      const ll = unprojectS2LatLng(points[i], points[i + 1]);
      path[i] = ll.latDegrees();
      path[i + 1] = ll.lngDegrees();
    }
    return path;
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

  private select(id: string|undefined): void {
    this.selected = id;
    this.featureLayer.setSelected(id);
    this.refreshFeatureList();
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
    const tree =
        buildTree([...this.store.all()].map(snapshot), f => this.store.parentOf(f));
    const live = this.selected !== undefined ? this.store.get(this.selected) : undefined;
    const selected = live && snapshot(live);
    // A folder cannot move into itself or anything under it
    const excluded =
        new Set(
            selected?.kind === 'folder'
                ? [selected.id, ...this.store.descendants(selected.id).map(f => f.id)]
                : []);
    this.updateState({
      ...this.state,
      features: {
        tree,
        folders: foldersOf(tree).filter(({folder}) => !excluded.has(folder.id)),
        selected,
        selectedDescendants:
            selected?.kind === 'folder' ? this.store.descendants(selected.id).length : 0,
        hovered: this.state.features.hovered,
        hoveredAncestors: new Set(this.ancestorsOf(this.state.features.hovered)),
        hidden: new Set(this.hidden),
        expanded: new Set(this.expanded),
      },
    });
  }

  private newCollection(): void {
    this.saves.clear();
    this.select(undefined);
    this.store.reset([]);
    this.updateState({
      ...this.state,
      collection: undefined,
    });
    this.history.silentlyReplaceUrl('/');
  }

  private openCollection(collection: Collection): void {
    this.saves.clear();
    this.select(undefined);
    this.updateState({
      ...this.state,
      collection,
    });
    this.history.silentlyReplaceUrl(`/collection/${collection.id}`);
    this.loadCollection(collection.id);
  }

  private loadCollection(id: string): void {
    const loading: Future<GetCollectionResponse> =
        requestData('lat.trails.DataService/GetCollection', {id});
    loading
        .then(response => {
          this.updateState({
            ...this.state,
            collection: response.collection,
          });
          this.store.reset([
            ...response.folders.map(folderFromProto),
            ...response.lines.map(lineFromProto),
            ...response.points.map(pointFromProto),
          ]);
        })
        .catch(e => {
          console.error(e);
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
          return collection.id;
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

  private openMenu(items: MenuEntries, e: CorgiEvent<typeof DOM_MOUSE>): void {
    const bound = e.actionElement.element().getBoundingClientRect();
    this.menu.open(
        items,
        {x: bound.left, y: bound.bottom},
        this.root,
        {anchor: 'top_left', classes: MENU_CLASSES});
  }

  private setLayerEnabled(index: number, enabled: boolean): void {
    const layers = [...this.state.layers];
    layers[index] = {
      ...layers[index],
      enabled,
    };

    this.updateState({
      ...this.state,
      layers,
    });
    this.setMapLayers(layers);
  }

  private setMapLayers(layers: LayerState[]): void {
    for (const {enabled, layer} of layers) {
      if (layer instanceof CollectionLayer) {
        // A hidden layer's geometry would otherwise answer hovers and catch the line tool.
        layer.setIndexed(enabled);
      }
    }
    this.mapController.setLayers(
        [this.pointLayer, this.lineLayer, this.measureLayer, this.featureLayer as Layer]
            .concat(layers.filter(l => l.enabled).map(l => l.layer))
            .concat([this.skyboxLayer]));
  }
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

function newCollectionName(): string {
  return `Untitled collection ${new Date().toLocaleDateString()}`;
}

