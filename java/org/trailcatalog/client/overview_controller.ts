import { Controller, ControllerResponse } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { checkExists } from './common/asserts';
import { MAP_MOVED, MapController, PATH_SELECTED, Trail, TRAIL_SELECTED } from './map/events';

export interface State {
  trails: Trail[];
}

interface Response extends ControllerResponse<undefined, HTMLDivElement, State> {
  state: [State, (newState: State) => void];
}

export class OverviewController extends Controller<undefined, HTMLDivElement, State, Response> {

  private readonly state: State;
  private readonly updateState: (newState: State) => void;
  private mapController: MapController|undefined;

  constructor(response: Response) {
    super(response);
    this.state = response.state[0];
    this.updateState = response.state[1];
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
      trails: controller.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }

  onPathSelected(e: CorgiEvent<typeof PATH_SELECTED>): void {
    console.log(e);
  }

  onTrailSelected(e: CorgiEvent<typeof TRAIL_SELECTED>): void {
    console.log(e);
  }

  selectTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, true);
  }

  unselectTrail(e: MouseEvent): void {
    this.setTrailHighlighted(e, false);
  }

  private setTrailHighlighted(e: MouseEvent, selected: boolean): void {
    if (!this.mapController) {
      return;
    }
    const id = (checkExists(e.currentTarget) as HTMLElement).dataset['trailId'];
    if (!id) {
      return;
    }
    this.mapController.setTrailHighlighted(BigInt(id), selected);
  }
}

