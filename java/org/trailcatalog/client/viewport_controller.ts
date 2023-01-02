import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { emptyLatLngRect, emptyPixelRect, LatLng, Vec2 } from './common/types';
import { SELECTION_CHANGED } from './map/events';
import { MapController } from './map/map_controller';
import { Path, Trail } from './models/types';

export interface State {
  selectedCardPosition: Vec2;
  selectedTrails: Trail[];
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

    let trails: Trail[];
    if (selected instanceof Path) {
      trails = this.mapController.listTrailsOnPath(selected);
      if (trails.length === 0) {
        const wayId = selected.id / 2n;
        trails.push(new Trail(
          -wayId,
          /* readableName= */ undefined,
          /* name= */ 'OSM Way',
          /* type= */ -1,
          /* mouseBound= */ emptyPixelRect(),
          /* paths= */ [selected.id],
          /* bound= */ emptyLatLngRect(),
          /* marker= */ [0, 0] as LatLng,
          /* markerPx= */ [0, 0],
          /* elevationDownMeters= */ -1,
          /* elevationUpMeters= */ -1,
          /* lengthMeters= */ -1,
        ));
      }
    } else if (selected instanceof Trail) {
      trails = [selected];
    } else {
      trails = [];
    }

    this.updateState({
      ...this.state,
      selectedCardPosition: clickPx,
      selectedTrails: trails,
    });
  }

  highlightTrail(e: MouseEvent): void {}
  unhighlightTrail(e: MouseEvent): void {}
}

