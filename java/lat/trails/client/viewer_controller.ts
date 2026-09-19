import { checkExists, exists } from 'external/dev_april_corgi+/js/common/asserts';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { Timer } from 'external/dev_april_corgi+/js/common/timer';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { CorgiEvent, DOM_MOUSE } from 'external/dev_april_corgi+/js/corgi/events';
import { HistoryService } from 'external/dev_april_corgi+/js/corgi/history/history_service';
import { DialogService } from 'external/dev_april_corgi+/js/emu/dialog';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';
import { MenuEntries } from 'external/dev_april_corgi+/js/emu/menu/menu_controller';
import { MenuService } from 'external/dev_april_corgi+/js/emu/menu/menu_service';

import { RgbaU32 } from 'js/map/common/types';
import { CLICKED, MAP_MOVED } from 'js/map/events';
import { Layer } from 'js/map/layer';
import { SkyboxLayer } from 'js/map/layers/skybox_layer';
import { MapController } from 'js/map/map_controller';
import { EarthSearchLayer } from 'js/map/layers/earth_search_layer';
import { MbtileLayer, CONTOURS_FEET, CONTOURS_METERS } from 'js/map/layers/mbtile_layer';
import { RasterTileLayer } from 'js/map/layers/raster_tile_layer';
import { Z_BASE_SATELLITE, Z_BASE_TERRAIN, Z_BOTTOM, Z_OVERLAY_TERRAIN } from 'js/map/z';
import {
  Collection,
  CreateCollectionResponse,
  GetCollectionResponse,
  GetCurrentUserResponse,
  Line,
  ListCollectionsResponse,
  PutLineResponse,
} from 'trails_lat/proto/data_pb';

import { CollectionLayer } from './collection_layer';
import { NATURE_PROTOMAPS, NATURE_WITHOUT_DETAILED_WAYS, OSM_PATHS, PUBLIC_LAND } from './styles';
import { invalidateCurrentUser, requestData } from './data';
import { ImportFailedDialog, SaveFailedDialog } from './dialogs';
import { EditableLine, EditLayer, Tool } from './edit_layer';
import { HOVER_CHANGED } from './events';
import { parseGpx } from './gpx';
import { MENU_CLASSES } from './menubar';

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
  layers: LayerState[];
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
  private readonly editLayer: EditLayer;
  // Logins run in a popup on Google's origin, so a caller waiting on one waits on this.
  private login: {
    popup: Window;
    promise: Promise<void>;
    resolve: () => void;
    reject: (e: unknown) => void;
  }|undefined;
  private readonly loginWatcher: Timer;
  // Writes to the server are serialized one after another to avoid multiple occuring at the same
  // time.
  private writes: Promise<unknown>;
  // Importing a GPX queues a write per segment, and whatever failed the first one usually fails
  // all of them, so a dialog apiece would bury the page.
  private warnedUnsaved: boolean;
  lastChange: number;

  constructor(response: Response<ViewerController>) {
    super(response);
    this.mapController = response.deps.controllers.map;
    this.dialog = response.deps.services.dialog;
    this.history = response.deps.services.history;
    this.menu = response.deps.services.menu;
    this.writes = Promise.resolve();
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
            this.retryUnsaved();
          } else {
            login.reject(new Error('Nobody signed in'));
          }
        }).catch(e => {
          login.reject(e);
        });
      }
    });
    this.registerDisposable(this.loginWatcher);

    this.editLayer =
        new EditLayer(
            this.mapController.camera,
            this.mapController.renderer,
            line => {
              this.saveLine(line);
            });
    this.registerDisposable(this.editLayer);

    const allLayers = [{
      name: 'Skybox',
      enabled: true,
      layer: new SkyboxLayer(Z_BOTTOM, this.mapController.renderer),
    }, {
      name: 'Hillshades',
      enabled: true,
      layer: new RasterTileLayer(
          [{
            long: 'Contains modified Copernicus Sentinel data 2021',
            short: 'Copernicus 2021',
          }, {
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
          [{
            long: 'Contains modified Copernicus Sentinel data 2021',
            short: 'Copernicus 2021',
          }, {
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
          [{
            long: 'Contains modified Copernicus Sentinel data 2021',
            short: 'Copernicus 2021',
          }, {
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

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    this.history.silentlyReplaceUrl(url.toString());
  }

  // Reversed so the menu reads top down the way the layers stack, the topmost drawn one first.
  layersMenuClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    const layers = this.state.layers;
    const items: MenuEntries = [];
    for (let i = layers.length - 1; i >= 0; --i) {
      const index = i;
      const layer = layers[index];
      items.push({
        kind: 'checkbox_menu_item',
        label: layer.name,
        checked: layer.enabled,
        action: () => {
          this.setLayerEnabled(index, !layer.enabled);
        },
      });
    }
    this.openMenu(items, e);
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
        label: 'Import GPX',
        action: () => {
          this.importGpx();
        },
      });
      this.openMenu(items, e);
    });
  }

  toolClicked(e: CorgiEvent<typeof ACTION>): void {
    const tool = checkExists(e.actionElement.data('tool')).string() as Tool;
    this.editLayer.setTool(tool);
    this.updateState({
      ...this.state,
      tool,
    });
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

  private newCollection(): void {
    this.editLayer.setLines([]);
    this.updateState({
      ...this.state,
      collection: undefined,
    });
    this.history.silentlyReplaceUrl('/');
  }

  private openCollection(collection: Collection): void {
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
          this.editLayer.setLines(response.lines.map(fromProto));
        })
        .catch(e => {
          console.error(e);
        });
  }

  private importGpx(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gpx,application/gpx+xml';
    input.multiple = true;
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      Promise.all(files.map(file => this.importOneGpx(file)))
          .then(failed => {
            const named = failed.filter(exists);
            if (named.length > 0) {
              this.dialog.display(ImportFailedDialog({files: named})).catch(() => {});
            }
          });
    });
    input.click();
  }

  // Resolves with the file's name when it yielded no lines, so that picking several files names
  // every one that failed in a single dialog.
  private importOneGpx(file: File): Promise<string|undefined> {
    return file.text()
        .then(text => {
          const lines = parseGpx(text);
          // A GPX carrying only waypoints or routes parses and still leaves nothing to draw, which
          // looks the same to somebody who picked a file and watched the map not change.
          if (lines.length === 0) {
            return file.name;
          }

          this.editLayer.addLines(lines);
          for (const line of lines) {
            this.saveLine(line);
          }
          return undefined;
        })
        .catch(e => {
          console.error(e);
          return file.name;
        });
  }

  private saveLine(line: EditableLine): void {
    this.writes =
        this.writes
            .then(() => this.currentCollection())
            .then(collection => {
              const put: Future<PutLineResponse> =
                  requestData('lat.trails.DataService/PutLine', {
                    collection,
                    line: toProto(line),
                  });
              return put.then(response => {
                line.version = response.version;
              });
            })
            .catch(e => {
              console.error(e);
              this.warnUnsaved();
            });
  }

  // Puts the lines that never reached the server, because a failed write drops its line and only
  // finishing a line calls saveLine again.
  //
  // Queued behind the outstanding writes because a line waiting in front of this has no version
  // yet, and putting it twice makes the second one a 409.
  private retryUnsaved(): void {
    this.writes =
        this.writes
            .then(() => {
              for (const line of this.editLayer.unsavedLines()) {
                this.saveLine(line);
              }
            })
            .catch(e => {
              console.error(e);
            });
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
    this.mapController.setLayers(
        [this.editLayer as Layer].concat(layers.filter(l => l.enabled).map(l => l.layer)));
  }
}

function toProto(line: EditableLine): {
  id: string;
  version: bigint;
  data: string;
  latLngE7: number[];
  elevationCentimeters: number[];
  timeSeconds: bigint[];
} {
  return {
    id: line.id,
    version: line.version,
    data: JSON.stringify(line.data),
    latLngE7: Array.from(line.latLngE7),
    elevationCentimeters:
        line.elevationCentimeters ? Array.from(line.elevationCentimeters) : [],
    timeSeconds: line.timeSeconds ? Array.from(line.timeSeconds) : [],
  };
}

function fromProto(line: Line): EditableLine {
  return {
    id: line.id,
    version: line.version,
    data: line.data ? JSON.parse(line.data) : {},
    latLngE7: Int32Array.from(line.latLngE7),
    elevationCentimeters:
        line.elevationCentimeters.length > 0
            ? Int32Array.from(line.elevationCentimeters)
            : undefined,
    timeSeconds: line.timeSeconds.length > 0 ? BigInt64Array.from(line.timeSeconds) : undefined,
  };
}

function newCollectionName(): string {
  return `Untitled collection ${new Date().toLocaleDateString()}`;
}

