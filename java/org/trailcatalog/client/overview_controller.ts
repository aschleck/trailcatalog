import { Controller, ControllerResponse } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { MAP_MOVED } from './map/events';

interface Response extends ControllerResponse<HTMLDivElement> {
}

export class OverviewController extends Controller<HTMLDivElement, Response> {

  constructor(response: Response) {
    super(response);
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center, zoom} = e.detail;
    const url = new URL(window.location.href);
    url.searchParams.set('lat', center.latDegrees().toFixed(7));
    url.searchParams.set('lng', center.lngDegrees().toFixed(7));
    url.searchParams.set('zoom', zoom.toFixed(3));
    window.history.replaceState(null, '', url);
  }
}

