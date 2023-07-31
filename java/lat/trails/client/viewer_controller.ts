import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { rgbaToUint32 } from 'js/map/common/math';
import { MAP_MOVED } from 'js/map/events';
import { MbtileData } from 'js/map/layers/mbtile_data';
import { Style, TileData } from 'js/map/layers/tile_data';
import { TileDataService } from 'js/map/layers/tile_data_service';
import { MAPTILER_CONTOURS, MAPTILER_DEM, MAPTILER_OUTDOOR, MAPTILER_PLANET, MAPTILER_TOPO, TRAILCATALOG_CONTOURS, TRAILCATALOG_HILLSHADES } from 'js/map/layers/tile_sources';
import { MapController } from 'js/map/map_controller';

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
        tileData: TileDataService,
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
      new MbtileData(
          this.mapController.camera,
          response.deps.services.tileData,
          this.mapController.renderer,
          this.mapController.renderPlanner.baker,
          MAPTILER_PLANET),
      new MbtileData(
          this.mapController.camera,
          response.deps.services.tileData,
          this.mapController.renderer,
          this.mapController.renderPlanner.baker,
          TRAILCATALOG_CONTOURS),
      new TileData(
          this.mapController.camera,
          response.deps.services.tileData,
          this.mapController.renderer,
          Style.Rgb,
          rgbaToUint32(1, 1, 1, 0.4),
          1,
          TRAILCATALOG_HILLSHADES),
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

