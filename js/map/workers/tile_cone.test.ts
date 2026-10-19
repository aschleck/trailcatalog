import { S2LatLng } from 'java/org/trailcatalog/s2';

import { Camera, projectS2LatLng } from '../camera';
import { TileId } from '../common/types';

import { Cone, selectTilesInCone } from './tile_cone';

// A laptop's map canvas at DPI 2
const WIDTH = 2700;
const HEIGHT = 2000;

function coneAt(lat: number, lng: number, zoom: number): Cone {
  const cone = new Camera(lat, lng, zoom).sphericalCone(WIDTH, HEIGHT);
  if (!cone) {
    throw new Error(`zoom ${zoom} is flat`);
  }
  return cone;
}

function tileAt(tiles: TileId[], lat: number, lng: number): TileId {
  const [x, y] = projectS2LatLng(S2LatLng.fromDegrees(lat, lng));
  const found = tiles.filter(t => {
    const size = 2 / 2 ** t.zoom;
    const left = -1 + t.x * size;
    const top = 1 - t.y * size;
    return left <= x && x < left + size && top - size < y && y <= top;
  });
  expect(found.length).toBe(1);
  return found[0];
}

test('the center never stretches a texel over more than a canvas pixel', () => {
  const cone = coneAt(47.24, -121.9, 8.06);
  const tiles = selectTilesInCone(cone, /* extraZoom= */ 0, /* minZoom= */ 0, /* maxZoom= */ 22);
  const wanted = Math.floor(cone.centerZoom + Math.log2(Math.cos(47.24 * Math.PI / 180)));
  expect(tileAt(tiles, 47.24, -121.9).zoom).toBe(wanted);
});

test('the center is finer than the horizon', () => {
  const cone = coneAt(0, 0, 5);
  const tiles = selectTilesInCone(cone, 0, 0, 22);
  const zooms = tiles.map(t => t.zoom);
  expect(tileAt(tiles, 0, 0).zoom).toBe(Math.max(...zooms));
  expect(Math.min(...zooms)).toBeLessThan(Math.max(...zooms));
});

test('tiles never overlap', () => {
  for (const [lat, zoom] of [[0, 4], [47, 8.06], [70, 7], [85, 6], [-60, 9.3]]) {
    const tiles = selectTilesInCone(coneAt(lat, 20, zoom), 0, 0, 22);
    for (const a of tiles) {
      for (const b of tiles) {
        if (a === b || a.zoom > b.zoom) {
          continue;
        }
        const shift = b.zoom - a.zoom;
        expect(b.x >> shift === a.x && b.y >> shift === a.y).toBe(false);
      }
    }
  }
});

test('the cap costs no more tiles than the flat map would over the same area', () => {
  // Flat, a texel is between half a pixel and a pixel, so a tile spans at least 128 pixels, and a
  // tile can straddle each edge. The cone is a circle through the screen's corners padded by 10%,
  // see camera.ts#sphericalCone.
  // => (ceil(WIDTH / 128) + 1) * (ceil(HEIGHT / 128) + 1)
  //        * pi * (WIDTH^2 + HEIGHT^2) / (4 * WIDTH * HEIGHT) * 1.1^2
  const flat =
      (Math.ceil(WIDTH / 128) + 1) * (Math.ceil(HEIGHT / 128) + 1)
          * Math.PI * (WIDTH ** 2 + HEIGHT ** 2) / (4 * WIDTH * HEIGHT) * 1.1 ** 2;
  for (const lat of [0, 30, 47, 60, 70, 80, 85]) {
    for (let zoom = 3; zoom < 9.5; zoom += 0.25) {
      const tiles = selectTilesInCone(coneAt(lat, 0, zoom), 0, 0, 22);
      expect(tiles.length).toBeLessThan(flat);
    }
  }
});

test('the zoom limits hold', () => {
  const tiles = selectTilesInCone(coneAt(47, 0, 8), 0, 0, /* maxZoom= */ 5);
  expect(Math.max(...tiles.map(t => t.zoom))).toBe(5);
  expect(selectTilesInCone(coneAt(47, 0, 4), 0, /* minZoom= */ 10, 22)).toEqual([]);
});

test('extra zoom adds a level at the center', () => {
  const cone = coneAt(47, 0, 8);
  const plain = tileAt(selectTilesInCone(cone, 0, 0, 22), 47, 0).zoom;
  expect(tileAt(selectTilesInCone(cone, 1, 0, 22), 47, 0).zoom).toBe(plain + 1);
});

function tileAtLatLng(tiles: TileId[], ll: S2LatLng): TileId {
  return tileAt(tiles, ll.latDegrees(), ll.lngDegrees());
}

test('the screen keeps full detail out to its corners', () => {
  const camera = new Camera(47, -121.9, 7.5);
  const cone = camera.sphericalCone(WIDTH, HEIGHT)!;
  const tiles = selectTilesInCone(cone, 0, 0, 22);
  const unculled = selectTilesInCone(cone, 0, 0, 22, /* cull= */ false);
  for (const [x, y] of [[1, 1], [WIDTH - 1, 1], [1, HEIGHT - 1], [WIDTH - 1, HEIGHT - 1]]) {
    const corner = camera.unprojectScreen(x, y, WIDTH, HEIGHT);
    expect(tileAtLatLng(tiles, corner).zoom).toBe(tileAtLatLng(unculled, corner).zoom);
  }
});

test('off screen comes coarser', () => {
  const camera = new Camera(47, -121.9, 7.5);
  const cone = camera.sphericalCone(WIDTH, HEIGHT)!;
  const tiles = selectTilesInCone(cone, 0, 0, 22);
  const unculled = selectTilesInCone(cone, 0, 0, 22, /* cull= */ false);
  expect(tiles.length).toBeLessThan(unculled.length);
  // A fifth of a screen above the top edge, inside the margin. Tiles still overlapping the screen
  // carry the descent on, so the margin can come out less than MARGIN_DROP coarser.
  const above = camera.unprojectScreen(WIDTH / 2, -HEIGHT * 0.2, WIDTH, HEIGHT);
  expect(tileAtLatLng(tiles, above).zoom).toBeLessThan(tileAtLatLng(unculled, above).zoom);
});

test('culling keeps working while the globe flattens', () => {
  const camera = new Camera(47, -121.9, 9.3);
  const cone = camera.sphericalCone(WIDTH, HEIGHT)!;
  expect(cone.flattenFactor).toBeGreaterThan(0);
  const tiles = selectTilesInCone(cone, 0, 0, 22);
  const unculled = selectTilesInCone(cone, 0, 0, 22, /* cull= */ false);
  expect(tiles.length).toBeLessThan(unculled.length);
  for (const [x, y] of [[1, 1], [WIDTH - 1, HEIGHT - 1]]) {
    const corner = camera.unprojectScreen(x, y, WIDTH, HEIGHT);
    expect(tileAtLatLng(tiles, corner).zoom).toBe(tileAtLatLng(unculled, corner).zoom);
  }
});
