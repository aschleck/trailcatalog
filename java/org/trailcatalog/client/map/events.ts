import { S2LatLng } from 'java/org/trailcatalog/s2';
import { declareEvent } from 'js/corgi/events';

import { Path, Trail } from '../models/types';

export interface MapController {
  listTrailsInViewport(): Trail[];
  listTrailsOnPath(path: Path): Trail[];
  setTrailHighlighted(trail: bigint, selected: boolean): void;
}

export const DATA_CHANGED = declareEvent<{
  controller: MapController;
}>('data_changed');

export const MAP_MOVED = declareEvent<{
  controller: MapController;
  center: S2LatLng;
  zoom: number;
}>('map_moved');

export const SELECTION_CHANGED = declareEvent<{
  controller: MapController;
  selected: Path|Trail|undefined;
}>('selection_changed');
