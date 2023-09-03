import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { Disposable } from 'js/common/disposable';
import { EventSpec } from 'js/corgi/events';

import { Vec2 } from './common/types';
import { Planner } from './rendering/planner';

export abstract class Layer extends Disposable {
  click(point: Vec2, px: [number, number], contextual: boolean, source: EventSource): boolean {
    return false
  }

  hasNewData(): boolean {
    return false;
  }

  hover(point: Vec2, source: EventSource): boolean {
    return false;
  }

  render(planner: Planner): void {}

  viewportChanged(bounds: S2LatLngRect, zoom: number): void {}
}

export interface EventSource {
  trigger<D>(spec: EventSpec<D>, detail: D): void;
}
