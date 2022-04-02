import { Controller, ControllerResponse } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { MAP_MOVED } from './map/events';

export interface State {
  count: number;
}

interface Response extends ControllerResponse<undefined, HTMLDivElement, State> {
  state: [State, (newState: State) => void];
}

export class OverviewController extends Controller<undefined, HTMLDivElement, State, Response> {

  private readonly state: State;
  private readonly updateState: (newState: State) => void;

  constructor(response: Response) {
    super(response);
    this.state = response.state[0];
    this.updateState = response.state[1];
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    window.history.replaceState(null, '', url);

    this.state.count += 1;
    this.updateState({count: this.state.count});
  }
}

