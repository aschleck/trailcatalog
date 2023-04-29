import { Disposable } from 'js/common/disposable';
import { EventSpec } from 'js/corgi/events';

import { Vec2 } from './common/types';
import { RenderBaker } from './rendering/render_baker';

export abstract class Layer extends Disposable {
  abstract hasDataNewerThan(time: number): boolean;
  abstract plan(size: Vec2, zoom: number, baker: RenderBaker): void;

  click(point: Vec2, px: [number, number], contextual: boolean, source: EventSource): boolean {
    return false
  }
  hover(point: Vec2, source: EventSource): boolean { return false; }
  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {}
}

export interface EventSource {
  trigger<D>(spec: EventSpec<D>, detail: D): void;
}
