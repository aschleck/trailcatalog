import { SKYLINE_AZIMUTHS } from 'js/map/workers/terrain_tracer';

export { getElevationAngle } from 'js/map/workers/terrain_tracer';

/** The eye above the ground the pin stands on. */
export const EYE_METERS = 1.7;

/** Returns the initial bearing in radians clockwise from north from one point to another. */
export function getBearing(lat0: number, lng0: number, lat1: number, lng1: number): number {
  // https://www.movable-type.co.uk/scripts/latlong.html#bearing
  const [p0, p1] = [lat0 * Math.PI / 180, lat1 * Math.PI / 180];
  const dl = (lng1 - lng0) * Math.PI / 180;
  const bearing =
      Math.atan2(
          Math.sin(dl) * Math.cos(p1),
          Math.cos(p0) * Math.sin(p1) - Math.sin(p0) * Math.cos(p1) * Math.cos(dl));
  return (bearing + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Returns the skyline's altitude at an azimuth, between the two directions traced beside it. The
 * skyline is the steepest angle up to the terrain in each direction, from TerrainTracer.
 */
export function getSkylineAt(skyline: Float32Array, azimuth: number): number {
  const at = azimuth / (2 * Math.PI) * SKYLINE_AZIMUTHS;
  const below = Math.floor(at);
  const f = at - below;
  return skyline[below % SKYLINE_AZIMUTHS] * (1 - f)
      + skyline[(below + 1) % SKYLINE_AZIMUTHS] * f;
}
