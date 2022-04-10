import { Vec2 } from '../../common/types';

import { RenderPlanner } from '../rendering/render_planner';

export interface Layer {
  hasDataNewerThan(time: number): boolean;
  plan(size: Vec2, zoom: number, planner: RenderPlanner): void;
  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void;
}
