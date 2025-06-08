import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { CorgiEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { rgbaToUint32 } from 'js/map/common/math';
import { RgbaU32 } from 'js/map/common/types';
import { MAP_MOVED } from 'js/map/events';
import { Layer } from 'js/map/layer';
import { SkyboxLayer } from 'js/map/layers/skybox_layer';
import { MapController } from 'js/map/map_controller';
import { CompositeZoomLayer } from 'js/map/layers/composite_zoom_layer';
import { EarthSearchLayer } from 'js/map/layers/earth_search_layer';
import { MbtileLayer, CONTOURS_FEET, CONTOURS_METERS, NATURE } from 'js/map/layers/mbtile_layer';
import { RasterTileLayer } from 'js/map/layers/raster_tile_layer';
import { Z_BASE_SATELLITE, Z_BASE_TERRAIN, Z_BOTTOM } from 'js/map/z';

import { CollectionLayer } from './collection_layer';

export interface LayerState {
  name: string;
  enabled: boolean;
  layer: Layer;
}

export interface State {
  layers: LayerState[];
}

type Deps = typeof ViewerController.deps;

export class ViewerController extends Controller<{}, Deps, HTMLElement, State> {

  static deps() {
    return {
      controllers: {
        map: MapController,
      },
      services: {
      },
    };
  }

  private readonly mapController: MapController;
  lastChange: number;

  constructor(response: Response<ViewerController>) {
    super(response);
    this.mapController = response.deps.controllers.map;
    this.lastChange = Date.now();

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
          /* tint= */ 0xFFFFFF44 as RgbaU32,
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
      enabled: true,
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
              + 'key=wWxlJy7a8SEPXS7AZ42l',
          NATURE,
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
          'https://api.maptiler.com/tiles/satellite-mediumres-2021/${id.zoom}/${id.x}/${id.y}.jpg?key=wWxlJy7a8SEPXS7AZ42l',
          /* tint= */ 0xFFFFFFFF as RgbaU32,
          /* z= */ Z_BASE_SATELLITE,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          /* maxZoom= */ 14,
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
      name: 'Public land',
      enabled: false,
      layer: new CompositeZoomLayer([
        [
          0,
          new CollectionLayer(
              '/api/collections/f09f5d2e-f163-4271-8ac2-34c44c75f99a',
              /* indexBottom= */ 4,
              /* snap= */ 11,
              this.mapController.renderer,
          ),
        ],
        [
          7,
          new CollectionLayer(
              '/api/collections/f09f5d2e-f163-4271-8ac2-34c44c75f99a',
              /* indexBottom= */ 6,
              /* snap= */ 14,
              this.mapController.renderer,
          ),
        ],
        [
          10,
          new CollectionLayer(
              '/api/collections/f09f5d2e-f163-4271-8ac2-34c44c75f99a',
              /* indexBottom= */ 6,
              /* snap= */ undefined,
              this.mapController.renderer,
          ),
        ],
      ]),
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

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    window.history.replaceState(null, '', url);
  }

  setLayerVisible(e: CorgiEvent<typeof ACTION>): void {
    const name = checkExists(e.targetElement.attr('aria-label')).string();

    const newLayers = [];
    for (const layer of this.state.layers) {
      if (layer.name === name) {
        newLayers.push({
          ...layer,
          enabled: !layer.enabled,
        });
      } else {
        newLayers.push(layer);
      }
    }

    this.updateState({
      ...this.state,
      layers: newLayers,
    });
    this.mapController.setLayers(newLayers.filter(l => l.enabled).map(l => l.layer));
  }
}

