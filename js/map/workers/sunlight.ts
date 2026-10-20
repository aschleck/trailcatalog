// Keep in sync with SimpleS2#EARTH_RADIUS_METERS
const EARTH_RADIUS_METERS = 6371010;
// See terrain_tracer.ts#REFRACTION
const REFRACTION = 0.13;

/**
 * Returns how dark each pixel of a heightmap is under the sun, from 0 in full sun facing it to 1
 * in shadow. Heights are meters in rows from the north edge, a pixel is pixelMeters across, and
 * the sun is at an azimuth clockwise from north and an apparent altitude, both in radians.
 *
 * Shadows are swept from the side nearest the sun: a pixel's shadow height is the higher of the
 * terrain and the shadow height one pixel toward the sun, lowered by the sun's slope over that
 * pixel, and anything below it is in shadow. Only terrain inside the heightmap casts shadows, so
 * the caller pads the side toward the sun by as far as a shadow reaches.
 */
export function getSunlight(
    heights: Float32Array,
    width: number,
    height: number,
    pixelMeters: number,
    azimuth: number,
    altitude: number): Float32Array {
  const darkness = new Float32Array(width * height);
  if (altitude <= 0) {
    return darkness.fill(1);
  }

  // Toward the sun, with x east and y south
  const ux = Math.sin(azimuth);
  const uy = -Math.cos(azimuth);
  // The Earth curves away from the middle of the heightmap along the sun's direction, so we lower
  // the terrain by how far it sits from there. This is exact at the middle and off by the middle's
  // distance over R in the sun's altitude at the edges, a tenth of a degree for 10 km.
  const curved = new Float32Array(heights.length);
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      const along = ((x - width / 2) * ux + (y - height / 2) * uy) * pixelMeters;
      curved[y * width + x] =
          heights[y * width + x] - along * along / (2 * EARTH_RADIUS_METERS) * (1 - REFRACTION);
    }
  }

  // March along whichever axis the sun is more along, so each step moves one whole pixel on it
  // and a fraction on the other.
  const shadow = new Float32Array(width * height).fill(-Infinity);
  const tan = Math.tan(altitude);
  const xMajor = Math.abs(ux) >= Math.abs(uy);
  const [major, minor] = xMajor ? [width, height] : [height, width];
  const toward = Math.sign(xMajor ? ux : uy);
  const slide = xMajor ? uy / Math.abs(ux) : ux / Math.abs(uy);
  const drop = Math.hypot(1, slide) * pixelMeters * tan;
  const index = (m: number, n: number) => xMajor ? n * width + m : m * width + n;
  // The line nearest the sun has nothing toward the sun to shade it.
  const first = toward > 0 ? major - 1 : 0;
  for (let m = first - toward; m >= 0 && m < major; m -= toward) {
    const behind = m + toward;
    for (let n = 0; n < minor; ++n) {
      const at = n + slide;
      const n0 = Math.floor(at);
      if (n0 < 0 || n0 + 1 >= minor) {
        continue;
      }
      const f = at - n0;
      const i0 = index(behind, n0);
      const i1 = index(behind, n0 + 1);
      const blocker =
          Math.max(curved[i0], shadow[i0]) * (1 - f) + Math.max(curved[i1], shadow[i1]) * f;
      shadow[index(m, n)] = blocker - drop;
    }
  }

  // Lit ground darkens as it turns away from the sun, like a hillshade under the real sun.
  const sun = [Math.cos(altitude) * ux, Math.cos(altitude) * uy, Math.sin(altitude)];
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      const i = y * width + x;
      if (curved[i] < shadow[i]) {
        darkness[i] = 1;
        continue;
      }
      const east =
          (heights[y * width + Math.min(x + 1, width - 1)]
              - heights[y * width + Math.max(x - 1, 0)]) / (2 * pixelMeters);
      const south =
          (heights[Math.min(y + 1, height - 1) * width + x]
              - heights[Math.max(y - 1, 0) * width + x]) / (2 * pixelMeters);
      // The normal of z = h(x, y) is (-dh/dx, -dh/dy, 1).
      const length = Math.hypot(east, south, 1);
      const facing = (-east * sun[0] - south * sun[1] + sun[2]) / length;
      darkness[i] = 1 - Math.max(facing, 0);
    }
  }
  return darkness;
}

/** Returns the sun's altitude raised by refraction, which is what lights the ground. */
export function getApparentAltitude(altitude: number): number {
  // Saemundsson's formula, which takes the true altitude where Bennett's takes the apparent one.
  // In degrees, clamped below the horizon where it blows up.
  const degrees = Math.max(altitude * 180 / Math.PI, -1);
  const minutes = 1.02 / Math.tan((degrees + 10.3 / (degrees + 5.11)) * Math.PI / 180);
  return altitude + minutes / 60 * Math.PI / 180;
}
