import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { Timer } from 'external/dev_april_corgi+/js/common/timer';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { CorgiEvent, DOM_MOUSE } from 'external/dev_april_corgi+/js/corgi/events';
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
import { GetCurrentUserResponse } from 'trails_lat/proto/data_pb';

import { CollectionLayer } from './collection_layer';
import { NATURE_PROTOMAPS, NATURE_WITHOUT_DETAILED_WAYS, OSM_PATHS, PUBLIC_LAND } from './styles';
import { invalidateCurrentUser, requestData } from './data';
import { HOVER_CHANGED } from './events';
import { MENU_CLASSES } from './menubar';

export interface LayerState {
  name: string;
  enabled: boolean;
  layer: Layer;
}

export interface State {
  layers: LayerState[];
  self: Future<GetCurrentUserResponse>;
}

type Deps = typeof ViewerController.deps;

export class ViewerController extends Controller<{}, Deps, HTMLElement, State> {

  static deps() {
    return {
      controllers: {
        map: MapController,
      },
      services: {
        menu: MenuService,
      },
    };
  }

  private readonly mapController: MapController;
  private readonly menu: MenuService;
  private loginPopup: Window|undefined;
  private readonly loginWatcher: Timer;
  lastChange: number;

  constructor(response: Response<ViewerController>) {
    super(response);
    this.mapController = response.deps.controllers.map;
    this.menu = response.deps.services.menu;
    this.lastChange = Date.now();

    // Logins work via a popup running on Google's origin. So when we know it's open we start this
    // timer to poll for completion.
    this.loginWatcher = new Timer(250 /* ms */, () => {
      const popup = this.loginPopup;
      if (popup && !popup.closed) {
        return;
      }

      this.loginWatcher.stop();
      this.loginPopup = undefined;
      invalidateCurrentUser();
      this.updateState({
        ...this.state,
        self: requestData('lat.trails.DataService/GetCurrentUser', {}),
      });
    });
    this.registerDisposable(this.loginWatcher);

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
            {minZoom: 0, indexBottom: 5, fromLevel: 0, toLevel: 10},
            // Everything smaller. A level 6 cell holds up to 11k of these, which is why they wait
            // until the viewport is small enough to be worth it.
            {minZoom: 7, indexBottom: 6, fromLevel: 11, toLevel: undefined},
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
            // Snapping only reaches polygons, see ApiServer#fetchRealCollection, and a collection
            // of nothing but lines draws fast enough at zoom 10 to leave them at full detail.
            {minZoom: 0, snap: undefined},
          ],
          [
            // Tiled at level 11 even though zoom 10 sees about four cells across, because the
            // level 13 snap keeps each one small enough that the extra offscreen reach is cheaper
            // than quadrupling the request count.
            {minZoom: 10, indexBottom: 11, fromLevel: 10, toLevel: undefined},
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
    this.mapController.setLayers(allLayers.filter(l => l.enabled).map(l => l.layer));
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
    window.history.replaceState(null, '', url);
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

  userMenuClicked(e: CorgiEvent<typeof DOM_MOUSE>): void {
    this.openMenu([{
      kind: 'menu_item',
      // Navigating drops the camera and the layers, which is the point: the map should not keep
      // showing what it was showing for someone who just signed out.
      label: 'Log out',
      action: () => {
        window.location.href = '/logout';
      },
    }], e);
  }

  loginClicked(): void {
    const popup = window.open('/login/google', 'login', 'height=700,popup,width=500');
    if (!popup) {
      return;
    }

    this.loginPopup = popup;
    this.loginWatcher.start();
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
    this.mapController.setLayers(layers.filter(l => l.enabled).map(l => l.layer));
  }
}

