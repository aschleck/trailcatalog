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

// A click that no layer claimed, so the page can offer what lies under it
export const UNCLAIMED_CLICKED = declareEvent<{
  point: S2LatLng;
  // relative to the canvas
  px: Vec2;
}>('unclaimed_clicked');

export const ZOOMED = declareEvent<{}>('zoomed');
