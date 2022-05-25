import { Controller, ControllerResponse } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { CorgiEvent } from 'js/corgi/events';

import { MAP_MOVED } from './map/events';

export interface State {}

interface Response extends ControllerResponse<undefined, EmptyDeps, HTMLElement, State> {
  state: [State, (newState: State) => void];
}

export class LocationUrlController extends Controller<undefined, EmptyDeps, HTMLElement, State, Response> {

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    window.history.replaceState(null, '', url);

    this.trigger(MAP_MOVED, e.detail);
  }
}

