// Keep in sync with SimpleS2#EARTH_RADIUS_METERS
const EARTH_RADIUS_METERS = 6371010;
// The standard coefficient of refraction: light bends with 13% of the Earth's curvature, so
// distant terrain drops by less than the geometry alone says.
const REFRACTION = 0.13;

/** How far a band of the trace reaches and the zoom whose pixels it steps by. */
export interface TraceBand {
  zoom: number;
  toMeters: number;
}

// An elevation error of e at a distance d tilts a sight line by e / d, so coarser tiles farther
// out keep the angles as good as near ones. Each band steps a pixel at a time, which is 1.7, 7, 13,
// and 27 m at the latitude of the Alps.
export const SKYLINE_BANDS: TraceBand[] = [
  {zoom: 15, toMeters: 2_000},
  {zoom: 13, toMeters: 7_000},
  {zoom: 12, toMeters: 20_000},
  {zoom: 11, toMeters: 60_000},
];
export const VIEWSHED_BANDS: TraceBand[] = SKYLINE_BANDS.slice(0, 3);
// Each 0.5 degrees, as wide as the sun
export const SKYLINE_AZIMUTHS = 720;
// Rays 15 m apart at the viewshed's 20 km edge, about a z12 pixel, so that every pixel of the
// image is near a ray
export const VIEWSHED_AZIMUTHS = 8192;

/** Meters above sea level at a lat, lng in radians, read from the band's zoom. */
export type HeightAt = (latRadians: number, lngRadians: number) => number;

/**
 * Returns the angle in radians up to terrain at targetMeters a distance away, from an eye at
 * eyeMeters. The Earth curving away lowers distant terrain.
 */
export function getElevationAngle(eyeMeters: number, targetMeters: number, distanceMeters: number):
    number {
  const drop = distanceMeters * distanceMeters / (2 * EARTH_RADIUS_METERS) * (1 - REFRACTION);
  return Math.atan2(targetMeters - drop - eyeMeters, distanceMeters);
}

/** Returns a pixel's width on the ground at a zoom and latitude, for 512 pixel tiles. */
export function getPixelMeters(zoom: number, latRadians: number): number {
  return 2 * Math.PI * EARTH_RADIUS_METERS * Math.cos(latRadians) / (512 * 2 ** zoom);
}

/**
 * Walks rays out from a point a pixel at a time, through bands that the caller loads one after
 * another, so that only one band's tiles are held at once. Each ray remembers the steepest ground
 * it has crossed, which is the skyline, and the stretches where a target clears it, which is the
 * viewshed.
 */
export class TerrainTracer {

  // The steepest angle to the ground so far along each ray
  readonly skyline: Float32Array;
  // Near and far meters of each visible stretch, by ray
  private readonly stretches: number[][];
  // Where the open stretch on each ray started, or NaN while the ray is hidden
  private readonly openFrom: Float64Array;
  private readonly sinLat: number;
  private readonly cosLat: number;
  private traced: number;

  constructor(
      private readonly latRadians: number,
      private readonly lngRadians: number,
      // The source's eye, and how high above the ground a target has to be seen
      private readonly eyeMeters: number,
      private readonly targetHeight: number,
      private readonly azimuths: number) {
    this.skyline = new Float32Array(azimuths).fill(-Math.PI / 2);
    this.stretches = [];
    for (let a = 0; a < azimuths; ++a) {
      this.stretches.push([]);
    }
    // The ground right by the source is always visible.
    this.openFrom = new Float64Array(azimuths).fill(0);
    this.sinLat = Math.sin(latRadians);
    this.cosLat = Math.cos(latRadians);
    this.traced = 0;
  }

  /** Traces the band from where the last one stopped out to its end. */
  trace(band: TraceBand, heightAt: HeightAt): void {
    const step = getPixelMeters(band.zoom, this.latRadians);
    const from = this.traced;
    for (let a = 0; a < this.azimuths; ++a) {
      const bearing = a / this.azimuths * 2 * Math.PI;
      const sinBearing = Math.sin(bearing);
      const cosBearing = Math.cos(bearing);
      let highest = this.skyline[a];
      let openFrom = this.openFrom[a];
      let previous = from;
      for (let d = from + step; d <= band.toMeters; d += step) {
        // https://www.movable-type.co.uk/scripts/latlong.html#destPoint
        const angle = d / EARTH_RADIUS_METERS;
        const sinAngle = Math.sin(angle);
        const cosAngle = Math.cos(angle);
        const sinTo = this.sinLat * cosAngle + this.cosLat * sinAngle * cosBearing;
        const lat = Math.asin(sinTo);
        const lng =
            this.lngRadians
                + Math.atan2(sinBearing * sinAngle * this.cosLat, cosAngle - this.sinLat * sinTo);
        const ground = heightAt(lat, lng);
        const visible =
            getElevationAngle(this.eyeMeters, ground + this.targetHeight, d) >= highest;
        highest = Math.max(highest, getElevationAngle(this.eyeMeters, ground, d));
        // A stretch starts and ends halfway between a visible sample and a hidden one.
        if (visible && Number.isNaN(openFrom)) {
          openFrom = (previous + d) / 2;
        } else if (!visible && !Number.isNaN(openFrom)) {
          this.stretches[a].push(openFrom, (previous + d) / 2);
          openFrom = NaN;
        }
        previous = d;
      }
      this.skyline[a] = highest;
      this.openFrom[a] = openFrom;
    }
    this.traced = band.toMeters;
  }

  /**
   * Returns the visible stretches as near, far pairs, with offsets[a] the index of ray a's first
   * pair and offsets[azimuths] the end.
   */
  getViewshed(): {stretches: Float32Array; offsets: Uint32Array} {
    const offsets = new Uint32Array(this.azimuths + 1);
    let count = 0;
    for (let a = 0; a < this.azimuths; ++a) {
      offsets[a] = count;
      count += this.stretches[a].length / 2 + (Number.isNaN(this.openFrom[a]) ? 0 : 1);
    }
    offsets[this.azimuths] = count;
    const stretches = new Float32Array(2 * count);
    for (let a = 0; a < this.azimuths; ++a) {
      stretches.set(this.stretches[a], 2 * offsets[a]);
      if (!Number.isNaN(this.openFrom[a])) {
        stretches.set([this.openFrom[a], this.traced], 2 * offsets[a + 1] - 2);
      }
    }
    return {stretches, offsets};
  }
}

/**
 * A square of a zoom's pixels in mercator, with x and y from 0 to 1 across the world, x east and y
 * south. Visible pixels are opaque white and the rest are clear, so a tint colors it.
 */
export interface ViewshedImage {
  x: number;
  y: number;
  size: number;
  pixels: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Draws a band of the viewshed into an image of its zoom's pixels, from the stretches
 * TerrainTracer#getViewshed returns. Each pixel takes the ray nearest its center, and pixels
 * outside the band stay clear so that the bands' images don't overlap.
 */
export function drawViewshed(
    latRadians: number,
    lngRadians: number,
    {stretches, offsets}: {stretches: Float32Array; offsets: Uint32Array},
    fromMeters: number,
    band: TraceBand): ViewshedImage {
  const azimuths = offsets.length - 1;
  const world = 512 * 2 ** band.zoom;
  const sin = Math.sin(latRadians);
  const sx = (lngRadians + Math.PI) / (2 * Math.PI) * world;
  const sy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world;
  // A pixel more than the band for the stretch of latitude the image spans
  const reach = Math.ceil(band.toMeters / getPixelMeters(band.zoom, latRadians) * 1.01) + 1;
  const x0 = Math.floor(sx) - reach;
  const y0 = Math.floor(sy) - reach;
  const pixels = 2 * reach + 1;
  const rgba = new Uint8ClampedArray(4 * pixels * pixels);
  const sinLat = Math.sin(latRadians);
  const cosLat = Math.cos(latRadians);
  for (let j = 0; j < pixels; ++j) {
    // Inverse mercator of the row's center
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y0 + j + 0.5) / world)));
    const sinTo = Math.sin(lat);
    const cosTo = Math.cos(lat);
    for (let i = 0; i < pixels; ++i) {
      const dLng = (x0 + i + 0.5) / world * 2 * Math.PI - Math.PI - lngRadians;
      // https://www.movable-type.co.uk/scripts/latlong.html, the haversine and the bearing
      const h =
          Math.sin((lat - latRadians) / 2) ** 2
              + cosLat * cosTo * Math.sin(dLng / 2) ** 2;
      const d = 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
      if (d < fromMeters || d > band.toMeters) {
        continue;
      }
      const bearing =
          Math.atan2(
              Math.sin(dLng) * cosTo, cosLat * sinTo - sinLat * cosTo * Math.cos(dLng));
      const ray = (Math.round(bearing / (2 * Math.PI) * azimuths) % azimuths + azimuths) % azimuths;
      for (let k = offsets[ray]; k < offsets[ray + 1]; ++k) {
        if (stretches[2 * k] <= d && d < stretches[2 * k + 1]) {
          rgba.fill(255, 4 * (j * pixels + i), 4 * (j * pixels + i) + 4);
          break;
        }
      }
    }
  }
  return {x: x0 / world, y: y0 / world, size: pixels / world, pixels, rgba};
}
