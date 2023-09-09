import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { rgbaToUint32 } from 'js/map2/common/math';
import { MAP_MOVED } from 'js/map2/events';
import { MapController } from 'js/map2/map_controller';

import { CollectionLayer } from './collection_layer';
import { RasterTileLayer } from './raster_tile_layer';

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
          {
            long: 'Contains modified Copernicus Sentinel data 2021',
            short: 'Copernicus 2021',
          },
          'https://tiles.trailcatalog.org/hillshades/${id.zoom}/${id.x}/${id.y}.webp',
          0,
          0,
          12,
          this.mapController.renderer,
      ),
      new CollectionLayer(
          '/api/collections/4c441d76-b804-4275-a6b8-b0e00cb9e2e2',
          this.mapController.renderer,
      ),
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

