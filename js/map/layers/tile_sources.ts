import { BitmapTileset, MbtileTileset } from '../common/types';

export const MAPTILER_CONTOURS: MbtileTileset = {
  extraZoom: -2,
  minZoom: 9,
  maxZoom: 14,
  tileUrl: 'https://api.maptiler.com/tiles/contours/${id.zoom}/${id.x}/${id.y}.pbf?' +
      'key=wWxlJy7a8SEPXS7AZ42l',
  type: 'mbtile',
} as const;

export const MAPTILER_DEM: BitmapTileset = {
  extraZoom: -1, // we're using the 512x512px tiles
  minZoom: 0,
  maxZoom: 12,
  tileUrl: 'https://api.maptiler.com/tiles/terrain-rgb-v2/${id.zoom}/${id.x}/${id.y}.webp?' +
      'key=wWxlJy7a8SEPXS7AZ42l',
  type: 'bitmap',
} as const;

export const MAPTILER_HILLSHADE: BitmapTileset = {
  extraZoom: 0,
  minZoom: 0,
  maxZoom: 12,
  tileUrl: 'https://api.maptiler.com/tiles/hillshade/${id.zoom}/${id.x}/${id.y}.webp?' +
      'key=wWxlJy7a8SEPXS7AZ42l',
  type: 'bitmap',
} as const;

export const MAPTILER_OUTDOOR: BitmapTileset = {
  extraZoom: -1, // we're using the 512x512px tiles
  minZoom: 2,
  maxZoom: 22,
  tileUrl: 'https://api.maptiler.com/maps/outdoor-v2/${id.zoom}/${id.x}/${id.y}.png?' +
      'key=wWxlJy7a8SEPXS7AZ42l',
  type: 'bitmap',
} as const;

export const MAPTILER_PLANET: MbtileTileset = {
  extraZoom: -1,
  minZoom: 0,
  maxZoom: 15,
  tileUrl: 'https://api.maptiler.com/tiles/v3/${id.zoom}/${id.x}/${id.y}.pbf?' +
      'key=wWxlJy7a8SEPXS7AZ42l',
  type: 'mbtile',
} as const;

export const MAPTILER_TOPO: BitmapTileset = {
  extraZoom: -1, // we're using the 512x512px tiles
  minZoom: 2,
  maxZoom: 22,
  tileUrl: 'https://api.maptiler.com/maps/topo/${id.zoom}/${id.x}/${id.y}.png?' +
      'key=wWxlJy7a8SEPXS7AZ42l',
  type: 'bitmap',
} as const;

export const STADIA_OMT: MbtileTileset = {
  extraZoom: -1.5, // Magic number: -1 renders too slow, -2 renders too blocky
  minZoom: 0,
  maxZoom: 14,
  tileUrl: 'https://tiles.stadiamaps.com/data/openmaptiles/${id.zoom}/${id.x}/${id.y}.pbf',
  type: 'mbtile',
} as const;

export const THUNDERFOREST_TOPO: BitmapTileset = {
  extraZoom: 0,
  minZoom: 2, // TODO: who cares
  maxZoom: 22,
  tileUrl: 'https://tile.thunderforest.com/landscape/${id.zoom}/${id.x}/${id.y}.png' +
      'apikey=d72e980f5f1849fbb9fb3a113a119a6f',
  type: 'bitmap',
} as const;

export const TRAILCATALOG_CONTOURS: MbtileTileset = {
  extraZoom: -1,
  minZoom: 9,
  maxZoom: 9,
  tileUrl: 'https://tiles.trailcatalog.org/contours/${id.zoom}/${id.x}/${id.y}.pbf',
  type: 'mbtile',
} as const;
