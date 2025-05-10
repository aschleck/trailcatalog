import { declareEvent } from 'external/dev_april_corgi+/js/corgi/events';
import { Vec2 } from 'js/map/common/types';

import { Path, Point, Trail } from '../models/types';

export const HOVER_CHANGED = declareEvent<{
  target: Path|Point|Trail|undefined;
}>('hover_changed');

export const SELECTION_CHANGED = declareEvent<{
  selected?: Path|Point|Trail;
  clickPx: Vec2;
}>('selection_changed');
