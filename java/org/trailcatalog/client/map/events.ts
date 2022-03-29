import { S2LatLng } from 'java/org/trailcatalog/s2';
import { declareEvent } from 'js/corgi/events';

export const MAP_MOVED = declareEvent<{
  center: S2LatLng;
  zoom: number;
}>('map_moved');
