import { S2LatLng } from 'java/org/trailcatalog/s2';
import { declareEvent } from 'js/corgi/events';

import { LatLngRect, LatLngZoom, Vec2 } from '../common/types';
import { Path, Point, Trail } from '../models/types';

export const HOVER_CHANGED = declareEvent<{
  target: Path|Point|Trail|undefined;
}>('hover_changed');

export const SELECTION_CHANGED = declareEvent<{
  selected?: Path|Point|Trail;
  clickPx: Vec2;
}>('selection_changed');
