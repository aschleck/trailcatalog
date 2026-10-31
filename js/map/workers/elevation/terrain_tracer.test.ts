import { drawViewshed, getElevationAngle, TerrainTracer } from './terrain_tracer';

const DEGREES = Math.PI / 180;
const LAT = 46 * DEGREES;
const LNG = 7 * DEGREES;
const EYE = 1.7;
// A meter north, in radians of latitude
const METER = 1 / 6371010;

function getViewshedOf(tracer: TerrainTracer, azimuths: number): Array<Array<[number, number]>> {
  const {stretches, offsets} = tracer.getViewshed();
  const rays = [];
  for (let a = 0; a < azimuths; ++a) {
    const ray: Array<[number, number]> = [];
    for (let i = offsets[a]; i < offsets[a + 1]; ++i) {
      ray.push([stretches[2 * i], stretches[2 * i + 1]]);
    }
    rays.push(ray);
  }
  return rays;
}

test('Level ground stays in view out to the horizon', () => {
  const tracer = new TerrainTracer(LAT, LNG, EYE, 0, 4);
  tracer.trace({zoom: 13, toMeters: 7_000}, () => 0);
  tracer.trace({zoom: 12, toMeters: 20_000}, () => 0);
  for (const ray of getViewshedOf(tracer, 4)) {
    // sqrt(2 * eye * R / (1 - refraction)) is about 5 km
    expect(ray.length).toBe(1);
    expect(ray[0][0]).toBe(0);
    expect(ray[0][1]).toBeGreaterThan(4_800);
    expect(ray[0][1]).toBeLessThan(5_200);
  }
  for (const altitude of tracer.skyline) {
    expect(altitude).toBeLessThan(0);
  }
});

test('A wall hides what is behind it', () => {
  // 100 m tall from 1 to 1.05 km north
  const heightAt = (lat: number) => {
    const north = (lat - LAT) / METER;
    return north > 1_000 && north < 1_050 ? 100 : 0;
  };
  const tracer = new TerrainTracer(LAT, LNG, EYE, 0, 4);
  tracer.trace({zoom: 13, toMeters: 7_000}, heightAt);
  const [north, east] = getViewshedOf(tracer, 4);
  // Seen from below, a flat top shows only its front edge.
  expect(north.length).toBe(1);
  expect(north[0][1]).toBeGreaterThan(1_000);
  expect(north[0][1]).toBeLessThan(1_010);
  expect(east[0][1]).toBeGreaterThan(4_800);
  expect(tracer.skyline[0]).toBeCloseTo(getElevationAngle(EYE, 100, 1_000), 2);
});

test('A target taller than a wall shows over it', () => {
  const heightAt = (lat: number) => {
    const north = (lat - LAT) / METER;
    return north > 1_000 && north < 1_050 ? 5 : 0;
  };
  // Seen from the ground, anything 100 m up clears a 5 m wall.
  const tracer = new TerrainTracer(LAT, LNG, 0, 100, 4);
  tracer.trace({zoom: 13, toMeters: 3_000}, heightAt);
  const [north] = getViewshedOf(tracer, 4);
  expect(north).toEqual([[0, 3_000]]);
});

test('The image shades what the rays saw and leaves the other bands clear', () => {
  const tracer = new TerrainTracer(LAT, LNG, EYE, 0, 64);
  const near = {zoom: 9, toMeters: 7_000};
  tracer.trace(near, () => 0);
  const image = drawViewshed(LAT, LNG, tracer.getViewshed(), 0, near);
  const alphaAt = (east: number, south: number) => {
    const middle = (image.pixels - 1) / 2;
    return image.rgba[4 * ((middle + south) * image.pixels + middle + east) + 3];
  };
  // At zoom 9 a pixel is about 106 m here, so the 5 km horizon is about 47 pixels out.
  expect(alphaAt(0, 0)).toBe(255);
  expect(alphaAt(40, 0)).toBe(255);
  expect(alphaAt(56, 0)).toBe(0);
  // Past the band, where the next band's image takes over
  expect(alphaAt(0, 67)).toBe(0);
});
