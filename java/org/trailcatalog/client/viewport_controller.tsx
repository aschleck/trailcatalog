import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { checkExists } from './common/asserts';
import { Vec2 } from './common/types';
import { MapController, SELECTION_CHANGED } from './map/events';
import { Path, Trail } from './models/types';
import { ViewsService } from './views/views_service';

export type Deps = () => {
  services: {
    views: typeof ViewsService;
  };
}

export interface State {
  hovering: Path|Trail|undefined;
  selectedCardPosition: Vec2;
  selectedTrails: Trail[];
}

export abstract class ViewportController<A, D extends Deps, S extends State>
    extends Controller<A, D, HTMLDivElement, S> {

  protected readonly views: ViewsService;
  protected mapController: MapController|undefined;

  constructor(response: Response<ViewportController<A, D, S>>) {
    super(response);
    this.views = response.deps.services.views;
  }

  onSelectionChanged(e: CorgiEvent<typeof SELECTION_CHANGED>): void {
    const {controller, clickPx, selected} = e.detail;
    this.mapController = controller;

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

  viewTrail(e: MouseEvent): void {
    const raw = (e.currentTarget as HTMLElement|undefined)?.dataset?.trailId;
    if (raw === undefined) {
      console.error('Unable to find trail ID');
      return;
    }

    const id = Number.parseInt(raw);
    if (Number.isNaN(id)) {
      console.error(`Unable to parse trail ID ${raw}`);
      return;
    }

    this.views.showTrail(id);
  }

  highlightTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, true);
  }

  unhighlightTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, false);
  }

  private setTrailHighlighted(e: MouseEvent, selected: boolean): void {
    if (!this.mapController) {
      return;
    }
    const id = (checkExists(e.currentTarget) as HTMLElement).dataset.trailId;
    if (!id) {
      return;
    }
    const trail = this.mapController.getTrail(BigInt(id));
    if (!trail) {
      return;
    }
    this.mapController.setHover(trail, selected);
    this.updateState({
      ...this.state,
      hovering: selected ? trail : undefined,
    });
  }
}

