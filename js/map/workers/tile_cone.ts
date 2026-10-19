import { createProjection, Projection, projectToNdc, unprojectNdc } from '../camera';
import { TileId } from '../common/types';

type Vec3 = [number, number, number];

// See camera.ts#SphericalCone
export interface Cone {
  camDir: Vec3;
  cosThetaT: number;
  distance: number;
  centerZoom: number;
  flattenFactor: number;
  zoom: number;
  lat: number;
  lng: number;
  widthPx: number;
  heightPx: number;
}

// Off screen tiles only show while the globe turns, so a quarter screen past each edge comes two
// zooms coarser and the rest of the cap three.
const MARGIN_NDC = 1.5;
const MARGIN_DROP = 2;
const BACKSTOP_DROP = 3;
// Samples per side over the screen and over each tile
const SCREEN_SAMPLES = 9;
const TILE_SAMPLES = 5;

/**
 * Returns the tiles that cover the visible cap, each at the zoom that puts one or two canvas pixels
 * on a texel where it comes nearest the camera.
 */
export function selectTilesInCone(
    cone: Cone, extraZoom: number, minZoom: number, maxZoom: number, cull = true): TileId[] {
  const projection =
      createProjection(cone.lat, cone.lng, cone.zoom, cone.widthPx, cone.heightPx);
  const ground = groundUnderScreen(projection);
  const tiles: Array<{id: TileId; dot: number}> = [];
  const visit = (id: TileId) => {
    const worldSize = Math.pow(2, id.zoom);
    const {dot, lat} = nearestInCone(id, worldSize, cone);
    if (dot < cone.cosThetaT) {
      return;
    }
    // A point theta off the view axis gets (distance - 1) / (distance - cos(theta)) of the center's
    // pixels per radian, and a mercator texel covers cos(lat) as much ground as one at the equator.
    const spherical =
        cone.centerZoom
            + Math.log2(Math.cos(lat) * (cone.distance - 1) / (cone.distance - dot));
    let wanted =
        Math.floor(
            (1 - cone.flattenFactor) * spherical + cone.flattenFactor * cone.zoom + extraZoom);
    if (wanted < minZoom) {
      return;
    }
    const reach = cull ? screenReach(id, worldSize, projection, ground) : 0;
    if (reach > MARGIN_NDC) {
      wanted = Math.max(wanted - BACKSTOP_DROP, minZoom);
    } else if (reach > 1) {
      wanted = Math.max(wanted - MARGIN_DROP, minZoom);
    }
    if (id.zoom < Math.min(wanted, maxZoom)) {
      for (let dy = 0; dy < 2; ++dy) {
        for (let dx = 0; dx < 2; ++dx) {
          visit({x: 2 * id.x + dx, y: 2 * id.y + dy, zoom: id.zoom + 1});
        }
      }
    } else {
      tiles.push({id, dot});
    }
  };
  visit({x: 0, y: 0, zoom: 0});
  // The middle of the screen loads first
  tiles.sort((a, b) => b.dot - a.dot);
  return tiles.map(t => t.id);
}

// The ground under a grid of screen points, as fractions of the world in tile order: x east from
// the antimeridian and y south from the top of mercator. Points off the globe are left out.
function groundUnderScreen(projection: Projection): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < SCREEN_SAMPLES; ++i) {
    for (let j = 0; j < SCREEN_SAMPLES; ++j) {
      const ndc = [2 * i / (SCREEN_SAMPLES - 1) - 1, 2 * j / (SCREEN_SAMPLES - 1) - 1] as const;
      const point = unprojectNdc(ndc, projection);
      if (!point) {
        continue;
      }
      out.push([
        point.lng / (2 * Math.PI) + 0.5,
        0.5 - Math.log(Math.tan(Math.PI / 4 + point.lat / 2)) / (2 * Math.PI),
      ]);
    }
  }
  return out;
}

// How far the tile comes toward the middle of the screen, in normalized device coordinates where
// the screen's edges sit at 1. A tile holding the ground under a screen sample is on screen.
function screenReach(
    id: TileId,
    worldSize: number,
    projection: Projection,
    ground: Array<[number, number]>): number {
  for (const [u, v] of ground) {
    if (Math.floor(u * worldSize) === id.x && Math.floor(v * worldSize) === id.y) {
      return 0;
    }
  }

  let best = Infinity;
  for (let i = 0; i < TILE_SAMPLES; ++i) {
    const lng = ((id.x + i / (TILE_SAMPLES - 1)) / worldSize * 2 - 1) * Math.PI;
    for (let j = 0; j < TILE_SAMPLES; ++j) {
      const my = 1 - (id.y + j / (TILE_SAMPLES - 1)) / worldSize * 2;
      const ndc = projectToNdc(Math.asin(Math.tanh(my * Math.PI)), lng, projection);
      if (ndc) {
        best = Math.min(best, Math.max(Math.abs(ndc[0]), Math.abs(ndc[1])));
      }
    }
  }
  return best;
}

/** Returns true if the tile's geographic patch intersects the camera's visible cap. */
export function tileInCone(id: TileId, worldSize: number, cone?: Cone): boolean {
  return !cone || nearestInCone(id, worldSize, cone).dot >= cone.cosThetaT;
}

// Returns the tile's point nearest the cone's center, as its dot with camDir and its latitude. The
// cap is the set of unit-sphere points P with dot(P, camDir) >= cosThetaT, so we maximize
// dot(P, camDir) over the patch.
//
// dot(P, camDir) = cos(lat) cos(camLat) cos(dLng) + sin(lat) sin(camLat).
// cos(lat) cos(camLat) is never negative, so the dot only grows as dLng
// shrinks and the best longitude is the patch's nearest to camLng at any
// latitude. With dLng fixed, the dot is a sinusoid in lat peaking at
// atan2(sin(camLat), cos(camLat) cos(dLng)), which is camLat only when dLng is
// 0. Clamping camLat instead picks the far edge of a tile across the pole.
function nearestInCone(id: TileId, worldSize: number, cone: Cone): {dot: number; lat: number} {
  const PI = Math.PI;
  const mx0 = (id.x / worldSize) * 2 - 1;
  const mx1 = ((id.x + 1) / worldSize) * 2 - 1;
  // Tile y indices go top-to-bottom but mercator y goes bottom-to-top.
  const myHigh = 1 - (id.y / worldSize) * 2;
  const myLow = 1 - ((id.y + 1) / worldSize) * 2;
  const lng0 = mx0 * PI;
  const lng1 = mx1 * PI;
  const lat0 = Math.asin(Math.tanh(myLow * PI));
  const lat1 = Math.asin(Math.tanh(myHigh * PI));

  const camLat = Math.asin(Math.max(-1, Math.min(1, cone.camDir[1])));
  const camLng = Math.atan2(cone.camDir[2], cone.camDir[0]);
  // in [0, 2pi), how far east of the tile's west edge the camera sits
  const east = ((camLng - lng0) % (2 * PI) + 2 * PI) % (2 * PI);
  const dLng = east <= lng1 - lng0 ? 0 : Math.min(east - (lng1 - lng0), 2 * PI - east);

  const dot = (lat: number) =>
      Math.cos(lat) * Math.cos(camLat) * Math.cos(dLng) + Math.sin(lat) * Math.sin(camLat);
  const bestLat = Math.atan2(Math.sin(camLat), Math.cos(camLat) * Math.cos(dLng));
  // The peak can sit past a pole, where the nearer edge around the circle isn't the one a clamp
  // picks, so outside the patch we try both edges.
  if (lat0 <= bestLat && bestLat <= lat1) {
    return {dot: dot(bestLat), lat: bestLat};
  }
  return dot(lat0) >= dot(lat1) ? {dot: dot(lat0), lat: lat0} : {dot: dot(lat1), lat: lat1};
}
