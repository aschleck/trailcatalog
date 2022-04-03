import { S2LatLng } from 'java/org/trailcatalog/s2';
import { declareEvent } from 'js/corgi/events';

interface MapController {
  listTrailsInViewport(): Trail[];
}

export interface Trail {
  readonly id: bigint;
  readonly name: string;
  readonly lengthMeters: number;
}

export const MAP_MOVED = declareEvent<{
  controller: MapController;
  center: S2LatLng;
  zoom: number;
}>('map_moved');
