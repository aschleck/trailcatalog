import { checkExists } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { ACTION } from 'js/emu/events';
import { rgbaToUint32 } from 'js/map2/common/math';
import { RgbaU32 } from 'js/map2/common/types';
import { MAP_MOVED } from 'js/map2/events';
import { Layer } from 'js/map2/layer';
import { MapController } from 'js/map2/map_controller';
import { CompositeZoomLayer } from 'js/map2/layers/composite_zoom_layer';
import { EarthSearchLayer } from 'js/map2/layers/earth_search_layer';
import { MbtileLayer, NATURE } from 'js/map2/layers/mbtile_layer';
import { RasterTileLayer } from 'js/map2/layers/raster_tile_layer';
import { Z_BASE_SATELLITE, Z_BASE_TERRAIN } from 'js/map2/z';

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
      name: 'Hillshades',
      enabled: true,
      layer: new RasterTileLayer(
          [{
            long: 'Contains modified Copernicus Sentinel data 2021',
            short: 'Copernicus 2021',
          }],
          'https://tiles.trailcatalog.org/hillshades/${id.zoom}/${id.x}/${id.y}.webp',
          /* tint= */ 0xFFFFFF88 as RgbaU32,
          /* z= */ Z_BASE_TERRAIN,
          /* extraZoom= */ 0,
          /* minZoom= */ 0,
          /* maxZoom= */ 12,
          this.mapController.renderer,
      ),
    }, {
      name: 'Maptiler Vector',
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
      name: 'Maptiler Satellite',
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
        14 /* days */,
        {'eo:cloud_cover': {'gte': 0, 'lte': 5}},
        Z_BASE_SATELLITE,
        this.mapController.renderer),
    }, {
      name: 'Public Land',
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
    const target = checkExists(e.target) as HTMLElement;
    const name = target.getAttribute('aria-label');

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

