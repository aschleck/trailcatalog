import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { rgbaToUint32 } from 'js/map2/common/math';
import { RgbaU32 } from 'js/map2/common/types';
import { MAP_MOVED } from 'js/map2/events';
import { MapController } from 'js/map2/map_controller';
import { CompositeZoomLayer } from 'js/map2/layers/composite_zoom_layer';
import { MbtileLayer, NATURE } from 'js/map2/layers/mbtile_layer';
import { RasterTileLayer } from 'js/map2/layers/raster_tile_layer';
import { Z_BASE_TERRAIN } from 'js/map2/z';

import { CollectionLayer } from './collection_layer';

export interface State {
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

    this.mapController.setLayers([
      new RasterTileLayer(
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
      new MbtileLayer(
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
      new CompositeZoomLayer([
        [
          0,
          new CollectionLayer(
              '/api/collections/d06e3048-a112-4cdd-bc27-440ea9637adf',
              /* indexBottom= */ 4,
              /* snap= */ 11,
              this.mapController.renderer,
          ),
        ],
        [
          7,
          new CollectionLayer(
              '/api/collections/d06e3048-a112-4cdd-bc27-440ea9637adf',
              /* indexBottom= */ 6,
              /* snap= */ 14,
              this.mapController.renderer,
          ),
        ],
        [
          10,
          new CollectionLayer(
              '/api/collections/d06e3048-a112-4cdd-bc27-440ea9637adf',
              /* indexBottom= */ 6,
              /* snap= */ undefined,
              this.mapController.renderer,
          ),
        ],
      ]),
    ]);
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    window.history.replaceState(null, '', url);
  }
}

