import { S2LatLng } from 'java/org/trailcatalog/s2';
import { declareEvent } from 'js/corgi/events';

import { Vec2 } from '../common/types';
import { Path, Trail } from '../models/types';

export interface MapController {
  getTrail(id: bigint): Trail|undefined;
  listTrailsInViewport(): Trail[];
  listTrailsOnPath(path: Path): Trail[];
  setHighlighted(trail: Trail, selected: boolean): void;
}

export const DATA_CHANGED = declareEvent<{
  controller: MapController;
}>('data_changed');

export const HOVER_CHANGED = declareEvent<{
  controller: MapController;
  target: Path|Trail|undefined;
}>('hover_changed');

export const MAP_MOVED = declareEvent<{
  controller: MapController;
  center: S2LatLng;
  zoom: number;
}>('map_moved');

export const SELECTION_CHANGED = declareEvent<{
  controller: MapController;
  selected: Path|Trail|undefined;
  clickPx: Vec2;
}>('selection_changed');
