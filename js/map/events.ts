import { S2LatLng } from 'java/org/trailcatalog/s2';
import { declareEvent } from 'external/dev_april_corgi+/js/corgi/events';

import { LatLngRect, LatLngZoom, Vec2 } from './common/types';

export const CLICKED = declareEvent<{
  clickPx: Vec2;
  contextual: boolean;
}>('clicked');

export const DATA_CHANGED = declareEvent<{}>('data_changed');

export const MAP_MOVED = declareEvent<{
  center: S2LatLng;
  zoom: number;
}>('map_moved');

export const ZOOMED = declareEvent<{}>('zoomed');
