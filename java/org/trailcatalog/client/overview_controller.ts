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
    console.log(e.detail);
  }
}

