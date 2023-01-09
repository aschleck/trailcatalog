import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { emptyLatLngRect, emptyPixelRect, LatLng, Vec2 } from './common/types';
import { SELECTION_CHANGED } from './map/events';
import { MapController } from './map/map_controller';
import { Path, Point, Trail } from './models/types';

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
    };
  }

  protected readonly mapController: MapController;

  constructor(response: Response<ViewportController<A, D, S>>) {
    super(response);
    this.mapController = response.deps.controllers.map;
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

