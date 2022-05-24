import { Controller, ControllerResponse, RequestSpec } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { checkExists } from './common/asserts';
import { Vec2 } from './common/types';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, MapController, SELECTION_CHANGED } from './map/events';
import { Path, Trail } from './models/types';
import { ViewsService } from './views/views_service';

interface Deps {
  services: {
    views: ViewsService;
  };
}

export interface State {
  hovering: Path|Trail|undefined;
  selectedCardPosition: Vec2;
  selectedTrails: Trail[];
  showTrailsList: boolean;
  trails: Trail[];
}

interface Response extends ControllerResponse<undefined, Deps, HTMLDivElement, State> {
  state: [State, (newState: State) => void];
}

export class OverviewController extends Controller<undefined, Deps, HTMLDivElement, State, Response> {

  static deps(): RequestSpec<Deps> {
    return {
      services: {
        views: ViewsService,
      },
    };
  }

  private mapController: MapController|undefined;
  private views: ViewsService;

  constructor(response: Response) {
    super(response);
    this.views = response.deps.services.views;
  }

  onDataChange(e: CorgiEvent<typeof DATA_CHANGED>): void {
    this.updateState({
      ...this.state,
      trails: e.detail.controller.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }

  onHoverChanged(e: CorgiEvent<typeof HOVER_CHANGED>): void {
    this.updateState({
      ...this.state,
      hovering: e.detail.target,
    });
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    // TODO(april): it'd be nice if this was a constructor arg or something
    this.mapController = e.detail.controller;

    const {center, controller, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    window.history.replaceState(null, '', url);

    this.updateState({
      ...this.state,
      trails: controller.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }

  onSelectionChanged(e: CorgiEvent<typeof SELECTION_CHANGED>): void {
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

  toggleTrailsList(): void {
    this.updateState({
      ...this.state,
      showTrailsList: !this.state.showTrailsList,
    });
  }

  highlightTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, true);
  }

  unhighlightTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, false);
  }

  unselectTrails(e: MouseEvent): void {
    this.updateState({
      ...this.state,
      selectedTrails: [],
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
    this.mapController.setHighlighted(trail, selected);
    this.updateState({
      ...this.state,
      hovering: trail,
    });
  }
}

