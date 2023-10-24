import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { Disposable } from 'js/common/disposable';
import { EventSpec } from 'js/corgi/events';

import { Copyright } from './common/types';
import { Planner } from './rendering/planner';

export abstract class Layer extends Disposable {

  constructor(private readonly _copyrights: Copyright[]|undefined = undefined) {
    super();
  }

  get copyrights(): Copyright[] {
    return this._copyrights ?? [];
  }

  click(point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    return false;
  }

  hasNewData(): boolean {
    return false;
  }

  hover(point: S2LatLng, source: EventSource): boolean {
    return false;
  }

  loadingData(): boolean {
    return false;
  }

  render(planner: Planner): void {}

  viewportChanged(bounds: S2LatLngRect, zoom: number): void {}
}

export interface EventSource {
  trigger<D>(spec: EventSpec<D>, detail: D): void;
}
