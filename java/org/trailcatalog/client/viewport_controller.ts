import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';
import { HistoryService } from 'js/corgi/history/history_service';

import { emptyLatLngRect, emptyPixelRect, LatLng, Vec2 } from './common/types';
import { SELECTION_CHANGED } from './map/events';
import { MapController } from './map/map_controller';
import { Path, Point, Trail } from './models/types';
import { ViewsService } from './views/views_service';

export interface State {
  selected: Array<Path|Point|Trail>;
  selectedCardPosition: Vec2;
}

type Deps = typeof ViewportController.deps;

export class ViewportController<A extends {}, D extends Deps, S extends State>
    extends Controller<A, D, HTMLDivElement, S> {

  static deps() {
    return {
      controllers: {
        map: MapController,
      },
      services: {
        history: HistoryService,
        views: ViewsService,
      },
    };
  }

  private readonly history: HistoryService;
  protected readonly mapController: MapController;
  protected readonly views: ViewsService;

  constructor(response: Response<ViewportController<A, D, S>>) {
    super(response);
    this.history = response.deps.services.history;
    this.mapController = response.deps.controllers.map;
    this.views = response.deps.services.views;
  }

  goBack(): void {
    if (this.history.backStaysInApp()) {
      this.history.back();
    } else {
      this.views.showOverview(this.mapController.cameraLlz);
    }
  }

  selectionChanged(e: CorgiEvent<typeof SELECTION_CHANGED>): void {
    const {clickPx, selected} = e.detail;

    let items: Array<Path|Point|Trail>;
    if (selected instanceof Path) {
      const trails = this.mapController.listTrailsOnPath(selected);
      if (trails.length === 0) {
        items = [selected];
      } else {
        items = trails;
      }
    } else if (!!selected) {
      items = [selected];
    } else {
      items = [];
    }

    this.updateState({
      ...this.state,
      selected: items,
      selectedCardPosition: clickPx,
    });
  }

  highlightTrail(e: MouseEvent): void {}
  unhighlightTrail(e: MouseEvent): void {}
}

