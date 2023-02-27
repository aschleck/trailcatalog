import { Vec2 } from 'java/org/trailcatalog/client/common/types';
import { Disposable } from 'js/common/disposable';
import { EventSpec } from 'js/corgi/events';

import { RenderPlanner } from './rendering/render_planner';

export abstract class Layer extends Disposable {
  abstract hasDataNewerThan(time: number): boolean;
  abstract plan(size: Vec2, zoom: number, planner: RenderPlanner): void;
  abstract viewportBoundsChanged(viewportSize: Vec2, zoom: number): void;

  click(point: Vec2, px: [number, number], source: EventSource): boolean { return false; }
  hover(point: Vec2, source: EventSource): boolean { return false; }
}

export interface EventSource {
  trigger<D>(spec: EventSpec<D>, detail: D): void;
}
