import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { HistoryService } from 'js/corgi/history/history_service';

import { emptyLatLngRect, emptyPixelRect, LatLng, Vec2 } from './common/types';
import { MapDataService } from './data/map_data_service';
import { TileDataService } from './data/tile_data_service';
import { SELECTION_CHANGED } from './map/events';
import { Filters, MapData } from './map/layers/map_data';
import { OverlayData, Overlays } from './map/layers/overlay_data';
import { TileData } from './map/layers/tile_data';
import { MapController } from './map/map_controller';
import { Path, Point, Trail } from './models/types';
import { ViewsService } from './views/views_service';

export interface State {
}

type Deps = typeof ViewerController.deps;

export class ViewerController<A extends Args, D extends Deps, S extends State>
    extends Controller<A, D, HTMLDivElement, S> {

  static deps() {
    return {
      controllers: {
        map: MapController,
      },
      services: {
        history: HistoryService,
        mapData: MapDataService,
        tileData: TileDataService,
        views: ViewsService,
      },
    };
  }

  private readonly history: HistoryService;
  private readonly mapData: MapData;
  private readonly overlayData: OverlayData;
  protected readonly mapController: MapController;
  protected readonly views: ViewsService;

  constructor(response: Response<ViewerController<A, D, S>>) {
    super(response);
    this.history = response.deps.services.history;
    this.mapController = response.deps.controllers.map;
    this.views = response.deps.services.views;

    this.mapData =
        new MapData(
            this.mapController.camera,
            response.deps.services.mapData,
            response.args.filters ?? {},
            this.mapController.renderer,
            this.mapController.textRenderer);
    this.overlayData = new OverlayData(response.args.overlays ?? {}, this.mapController.renderer);

    this.mapController.setLayers([
      this.mapData,
      new TileData(this.mapController.camera, response.deps.services.tileData, this.mapController.renderer),
      this.overlayData,
    ]);

    (response.args.active?.trails ?? []).forEach(t => this.setActive(t, true));
  }
}
