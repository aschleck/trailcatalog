import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { CorgiEvent } from 'js/corgi/events';

import { Vec2 } from './common/types';
import { SELECTION_CHANGED } from './map/events';
import { Path, Trail } from './models/types';

export interface State {
  selectedCardPosition: Vec2;
  selectedTrails: Trail[];
}

export class ViewportController<A extends {}, D extends EmptyDeps, S extends State>
    extends Controller<A, D, HTMLDivElement, S> {

  constructor(response: Response<ViewportController<A, D, S>>) {
    super(response);
  }

  selectionChanged(e: CorgiEvent<typeof SELECTION_CHANGED>): void {
    const {controller, clickPx, selected} = e.detail;

    let trails: Trail[];
    if (selected instanceof Path) {
      trails = controller.listTrailsOnPath(selected);
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

