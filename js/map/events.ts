import { LatLngRect, LatLngZoom, Vec2 } from 'java/org/trailcatalog/client/common/types';
import { S2LatLng } from 'java/org/trailcatalog/s2';
import { declareEvent } from 'js/corgi/events';

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
