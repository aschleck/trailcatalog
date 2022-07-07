import { Disposable } from 'js/common/disposable';

import { Vec2 } from '../../common/types';

import { RenderPlanner } from '../rendering/render_planner';

export abstract class Layer extends Disposable {
  abstract hasDataNewerThan(time: number): boolean;
  abstract plan(size: Vec2, zoom: number, planner: RenderPlanner): void;
  abstract viewportBoundsChanged(viewportSize: Vec2, zoom: number): void;
}
