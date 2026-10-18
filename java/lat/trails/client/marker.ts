import { RgbaU32 } from 'js/map/common/types';
import { LineProgram } from 'js/map/rendering/line_program';

// Strokes follow perfect-freehand with the options tldraw's draw tool passes it for a mouse, whose
// pressure is simulated from how far the pointer moves between samples.
// https://github.com/steveruizok/perfect-freehand

const THINNING = 0.5;
const RATE_OF_PRESSURE_CHANGE = 0.275;
// A stroke almost always starts slow, which would otherwise make it start fat.
const FIRST_PRESSURE = 0.25;
// Points this close to the end are dropped because the pointer wobbles as it lifts.
const END_NOISE_PX = 3;
const MIN_RADIUS_PX = 0.01;
// LineProgram insets its fill by the one pixel casing, so a thinner radius turns the fill inside
// out.
const MIN_DRAWN_RADIUS_PX = 1;

/** Where each point of a marker stroke is and how wide the stroke is there, both in mercator. */
export interface MarkerOutline {
  points: Float64Array;
  radii: Float64Array;
  maxRadius: number;
}

/**
 * Returns the points a stroke keeps from the pointer's path, in the same units. Each point moves
 * only part of the way from the last toward the pointer, which smooths out jitter. The end of an
 * incomplete stroke trails the pointer, and a complete one reaches it.
 */
export function streamline(
    inputs: ArrayLike<number>, widthPx: number, pixel: number, complete: boolean): Float64Array {
  let path = Array.from(inputs);
  if (path.length < 4) {
    return Float64Array.from(path);
  } else if (path.length === 4) {
    // Two samples become five, so that a quick flick still has points to thin out between.
    const [ax, ay, bx, by] = path;
    path = [];
    for (let i = 0; i <= 4; ++i) {
      path.push(ax + (bx - ax) * i / 4, ay + (by - ay) * i / 4);
    }
  }

  // tldraw streamlines harder as strokes get wider.
  // => 0.64 up to a size of 9 px, rising to 0.74 at 16 px
  const sizePx = sizeOf(widthPx);
  const amount = 0.64 + 0.1 * Math.min(1, Math.max(0, (sizePx - 9) / 7));
  const t = 0.15 + (1 - amount) * 0.85;
  const size = sizePx * pixel;
  const kept = [path[0], path[1]];
  let x = path[0];
  let y = path[1];
  let runningLength = 0;
  let reachedSize = false;
  const last = path.length / 2 - 1;
  for (let i = 1; i <= last; ++i) {
    const nx = complete && i === last ? path[2 * i] : x + (path[2 * i] - x) * t;
    const ny = complete && i === last ? path[2 * i + 1] : y + (path[2 * i + 1] - y) * t;
    if (nx === x && ny === y) {
      continue;
    }

    runningLength += Math.hypot(nx - x, ny - y);
    // Nothing is kept until the stroke is a size away from where it started, which is noise. The
    // length still counts what was skipped, as perfect-freehand's does.
    if (i < last && !reachedSize) {
      if (runningLength < size) {
        continue;
      }
      reachedSize = true;
    }

    kept.push(nx, ny);
    x = nx;
    y = ny;
  }
  return Float64Array.from(kept);
}

/**
 * Returns how wide a stroke is at each of its points, which is wider where the pointer moved
 * slowly. Pixel is the mercator size of a pixel at the zoom it was drawn.
 */
export function outlineMarker(
    points: Float64Array, widthPx: number, pixel: number): MarkerOutline {
  const count = points.length / 2;
  const size = sizeOf(widthPx) * pixel;
  const distances = new Float64Array(count);
  const along = new Float64Array(count);
  for (let i = 1; i < count; ++i) {
    distances[i] =
        Math.hypot(points[2 * i] - points[2 * i - 2], points[2 * i + 1] - points[2 * i - 1]);
    along[i] = along[i - 1] + distances[i];
  }
  const total = count > 0 ? along[count - 1] : 0;

  // Averaged over the first few points so that the stroke doesn't start fat
  let pressure = FIRST_PRESSURE;
  for (let i = 0; i < Math.min(10, count); ++i) {
    pressure = (pressure + simulatePressure(pressure, distances[i], size)) / 2;
  }

  const kept = [];
  const radii = [];
  let maxRadius = 0;
  for (let i = 0; i < count; ++i) {
    if (i < count - 1 && total - along[i] < END_NOISE_PX * pixel) {
      continue;
    }

    pressure = simulatePressure(pressure, distances[i], size);
    // easeOutSine
    const eased = Math.sin((0.5 - THINNING * (0.5 - pressure)) * Math.PI / 2);
    const radius = Math.max(MIN_RADIUS_PX * pixel, size * eased);
    kept.push(points[2 * i], points[2 * i + 1]);
    radii.push(radius);
    maxRadius = Math.max(maxRadius, radius);
  }
  return {points: Float64Array.from(kept), radii: Float64Array.from(radii), maxRadius};
}

/**
 * Writes a stroke as LineProgram segments, each as wide as the average of its ends. extraPx
 * widens every segment for a casing.
 */
export function pushMarker(
    fill: RgbaU32,
    stroke: RgbaU32,
    outline: MarkerOutline,
    extraPx: number,
    worldRadius: number,
    buffer: ArrayBuffer,
    offset: number,
): ReturnType<typeof LineProgram.push> {
  const radii = new Float32Array(Math.max(0, outline.radii.length - 1));
  for (let i = 0; i < radii.length; ++i) {
    const px = (outline.radii[i] + outline.radii[i + 1]) / 2 * worldRadius;
    radii[i] = Math.max(MIN_DRAWN_RADIUS_PX, px) + extraPx;
  }
  return LineProgram.push(
      fill, stroke, radii, /* stipple= */ false, outline.points, buffer, offset);
}

// Returns perfect-freehand's size for a stroke drawn widthPx wide at the default pressure of 0.5.
// Its radius is size * easeOutSine(0.5 - THINNING * (0.5 - pressure)), so at 0.5
// => radius = size * sin(pi / 4) = size / sqrt(2)
// => width = sqrt(2) * size
function sizeOf(widthPx: number): number {
  return widthPx / Math.SQRT2;
}

// Faster pointer movement lowers the pressure, and a slower one raises it.
function simulatePressure(previous: number, distance: number, size: number): number {
  const speed = Math.min(1, distance / size);
  const target = Math.min(1, 1 - speed);
  return Math.min(1, previous + (target - previous) * speed * RATE_OF_PRESSURE_CHANGE);
}
