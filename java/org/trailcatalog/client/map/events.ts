import { S2LatLng } from 'java/org/trailcatalog/s2';
import { declareEvent } from 'js/corgi/events';

export interface MapController {
  listTrailsInViewport(): Trail[];
  setTrailHighlighted(trail: bigint, selected: boolean): void;
}

export interface Path {
  readonly id: bigint;
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

export const PATH_SELECTED = declareEvent<{
  controller: MapController;
  path: Path;
}>('path_selected');

export const TRAIL_SELECTED = declareEvent<{
  controller: MapController;
  trail: Trail;
}>('trail_selected');
