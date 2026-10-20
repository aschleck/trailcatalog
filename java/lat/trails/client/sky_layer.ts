import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { Camera, projectS2LatLng } from 'js/map/camera';
import { RgbaU32 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

import {
  getMoonPhase,
  getMoonPosition,
  getMoonTimes,
  getSunPosition,
  getSunTimes,
  SkyPosition,
} from './sky';
import { getClock } from './timeline';

// The horizon's radius in the sky chart around the pin, where the pin is straight up
const CHART_RADIUS_PX = 110;
const PIN_RADIUS_PX = 4;
// A little past the pin, so that it is easy to grab with a finger
const GRAB_RADIUS_PX = 12;
const DISC_RADIUS_PX = 7;
const PATH_RADIUS_PX = 2.5;
const SIGHT_RADIUS_PX = 1.5;
// Past the edge of the screen, but no farther than you could see a peak on the line
const SIGHT_LENGTH_PX = 4096;
const SIGHT_LENGTH_M = 100_000;
const PIN_FILL = 0x111827FF as RgbaU32;
const CASING = 0xFFFFFFFF as RgbaU32;
const HORIZON = 0x37415180 as RgbaU32;
const SUN = 0xF59E0BFF as RgbaU32;
const SUN_BELOW = 0xF59E0B80 as RgbaU32;
const MOON = 0x64748BFF as RgbaU32;
const MOON_DISC = 0xE2E8F0FF as RgbaU32;
const MOON_BELOW = 0xE2E8F080 as RgbaU32;
const PATH_STEP_MS = 10 * 60 * 1000;
// Over the collection's features but under anything being edited
const Z_SKY = Z_USER_DATA_HIGHLIGHT + 1;
const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];
const HOUR_MS = 60 * 60 * 1000;

const WHOLE = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0});

type Position = (ms: number, latRadians: number, lngRadians: number) => SkyPosition;

/**
 * Draws a chart of the sky around a pin the pointer tool drags, the way the sky looks overhead from
 * the pin. The ring is the horizon and the pin is straight up, so the sun and moon's paths over the
 * day are arcs that rise and set on the ring, with a disc where each is at the map's time.
 */
export class SkyLayer extends Layer {

  private pin: S2LatLng|undefined;
  private appearing: boolean;
  private interactive: boolean;
  private time: number;
  private readonly glGeometry: WebGLBuffer;
  private geometry: ArrayBuffer;
  private drawables: Drawable[];
  private generation: number;
  private planned: number;
  // The chart is a fixed size on screen, so a zoom replans it.
  private plannedRadius: number;

  constructor(private readonly camera: Camera, private readonly renderer: Renderer) {
    super();
    this.pin = undefined;
    this.appearing = false;
    this.interactive = true;
    this.time = Date.now();
    this.glGeometry = renderer.createDataBuffer(0);
    this.registerDisposer(() => {
      renderer.deleteBuffer(this.glGeometry);
    });
    // A day of each path at PATH_STEP_MS, the horizon, and the discs fit
    this.geometry = new ArrayBuffer(512 * LineProgram.bytesNeeded(2));
    this.drawables = [];
    this.generation = 0;
    this.planned = -1;
    this.plannedRadius = 0;
  }

  setTime(time: number): void {
    if (time !== this.time) {
      this.time = time;
      this.generation += 1;
    }
  }

  /** Puts the pin at the center of the screen on the next viewport, unless it is already on it. */
  appear(): void {
    this.appearing = true;
  }

  /** Returns where the pin is, if it is near a point on the screen. */
  pinNear(point: S2LatLng): S2LatLng|undefined {
    return this.pin && this.isNearPin(point) ? this.pin : undefined;
  }

  // Off for the drawing tools, so that a press on the pin places a vertex instead.
  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
  }

  override viewportChanged(bounds: S2LatLngRect): void {
    if (!this.appearing) {
      return;
    }
    this.appearing = false;
    if (!this.pin || !bounds.contains(S2LatLngRect.fromPoint(this.pin))) {
      this.pin = this.camera.center;
      this.generation += 1;
    }
  }

  override dragStart(point: S2LatLng, px: [number, number], source: EventSource): boolean {
    return this.interactive && this.isNearPin(point);
  }

  override drag(point: S2LatLng, source: EventSource): void {
    this.pin = point;
    this.generation += 1;
  }

  override hasNewData(): boolean {
    return this.generation !== this.planned
        || this.camera.inverseWorldRadius !== this.plannedRadius;
  }

  override render(planner: Planner): void {
    if (this.hasNewData()) {
      this.plan();
      this.planned = this.generation;
      this.plannedRadius = this.camera.inverseWorldRadius;
    }
    planner.add(this.drawables);
  }

  private isNearPin(point: S2LatLng): boolean {
    if (!this.pin) {
      return false;
    }
    const [x, y] = projectS2LatLng(point);
    const [px, py] = projectS2LatLng(this.pin);
    const radius = GRAB_RADIUS_PX * this.camera.inverseWorldRadius;
    return (x - px) * (x - px) + (y - py) * (y - py) <= radius * radius;
  }

  private plan(): void {
    const pin = this.pin;
    if (!pin) {
      this.drawables = [];
      return;
    }

    const lat = pin.latRadians();
    const lng = pin.lngRadians();
    const [x, y] = projectS2LatLng(pin);
    const chartRadius = CHART_RADIUS_PX * this.camera.inverseWorldRadius;
    // Straight up is the pin and the horizon is the ring. Mercator keeps angles, so the azimuth
    // points the way it does on the ground.
    const chart = ({azimuth, altitude}: SkyPosition): [number, number] => {
      const r = chartRadius * (1 - Math.max(altitude, 0) / (Math.PI / 2));
      return [x + r * Math.sin(azimuth), y + r * Math.cos(azimuth)];
    };
    // The parts of a day's path above the horizon, ending on the ring where it rises and sets
    const noon = getSunTimes(this.time, lat, lng).noon;
    const paths = (position: Position): number[][] => {
      const runs: number[][] = [];
      let run: number[] = [];
      let previous: SkyPosition|undefined;
      for (let t = noon - 12 * HOUR_MS; t <= noon + 12 * HOUR_MS; t += PATH_STEP_MS) {
        const now = position(t, lat, lng);
        if (previous && (previous.altitude < 0) !== (now.altitude < 0)) {
          const f = previous.altitude / (previous.altitude - now.altitude);
          const crossing =
              chart({azimuth: lerpAngle(previous.azimuth, now.azimuth, f), altitude: 0});
          run.push(...crossing);
          if (now.altitude < 0) {
            runs.push(run);
            run = [];
          }
        }
        if (now.altitude >= 0) {
          run.push(...chart(now));
        }
        previous = now;
      }
      if (run.length > 0) {
        runs.push(run);
      }
      return runs;
    };

    const horizon = [];
    for (let i = 0; i <= 64; ++i) {
      const angle = i / 64 * 2 * Math.PI;
      horizon.push(x + chartRadius * Math.sin(angle), y + chartRadius * Math.cos(angle));
    }
    const sun = getSunPosition(this.time, lat, lng);
    const moon = getMoonPosition(this.time, lat, lng);
    // From the pin through the disc and on across the map, to see what lines up with it
    const sights = [];
    const reach =
        Math.min(
            SIGHT_LENGTH_PX * this.camera.inverseWorldRadius,
            // Mercator x is longitude over pi, stretched by 1 / cos(latitude) north and south
            SimpleS2.earthMetersToAngle(SIGHT_LENGTH_M).radians() / Math.PI / Math.cos(lat));
    for (const [{azimuth, altitude}, fill] of [[moon, MOON], [sun, SUN]] as const) {
      if (altitude >= 0) {
        const points = [x, y, x + reach * Math.sin(azimuth), y + reach * Math.cos(azimuth)];
        sights.push({fill, stroke: CASING, radius: SIGHT_RADIUS_PX, points});
      }
    }
    const lines: Array<{fill: RgbaU32; stroke: RgbaU32; radius: number; points: number[]}> = [
      ...sights,
      {fill: HORIZON, stroke: HORIZON, radius: 1, points: horizon},
      ...paths(getMoonPosition)
          .map(points => ({fill: MOON, stroke: CASING, radius: PATH_RADIUS_PX, points})),
      ...paths(getSunPosition)
          .map(points => ({fill: SUN, stroke: CASING, radius: PATH_RADIUS_PX, points})),
      {fill: PIN_FILL, stroke: CASING, radius: PIN_RADIUS_PX, points: [x, y, x, y]},
      disc(chart(moon), moon.altitude < 0 ? MOON_BELOW : MOON_DISC, MOON),
      disc(chart(sun), sun.altitude < 0 ? SUN_BELOW : SUN, CASING),
    ];

    this.geometry =
        growBuffer(
            this.geometry,
            lines.reduce((bytes, {points}) =>
                bytes + LineProgram.bytesNeeded(points.length / 2), 0));
    const drawables: Drawable[] = [];
    let offset = 0;
    for (const {fill, stroke, radius, points} of lines) {
      const result =
          LineProgram.push(
              fill, stroke, radius, /* stipple= */ false, points, this.geometry, offset);
      drawables.push({
        elements: undefined,
        geometry: this.glGeometry,
        geometryByteLength: result.geometryByteLength,
        geometryOffset: result.geometryOffset,
        instanced: {count: result.instanceCount},
        program: this.renderer.lineProgram,
        texture: undefined,
        vertexCount: result.vertexCount,
        // in order, so the sun's disc is on top
        z: Z_SKY + drawables.length / 100,
      });
      offset += result.geometryByteLength;
    }

    this.renderer.uploadData(this.geometry, offset, this.glGeometry);
    this.drawables = drawables;
  }
}

/** Describes the sun and moon at a spot and time as rows for the click menu. */
export function getSkyReadings(point: S2LatLng, time: number):
    Array<{name: string; value: string}> {
  const lat = point.latRadians();
  const lng = point.lngRadians();
  const sunTimes = getSunTimes(time, lat, lng);
  const moonTimes = getMoonTimes(sunTimes.noon - 12 * HOUR_MS, lat, lng);
  const phase = getMoonPhase(time);
  const rows: Array<{name: string; value: string}> = [];
  const clock = getClock();
  const at = (name: string, when: number|undefined, position: Position) => {
    if (when !== undefined) {
      rows.push({
        name,
        value: `${clock.format(when)}, ${formatBearing(position(when, lat, lng).azimuth)}`,
      });
    }
  };
  const during = (name: string, ...periods: Array<{start: number; end: number}|undefined>) => {
    const shown = periods.filter(p => p !== undefined);
    if (shown.length > 0) {
      rows.push({
        name,
        value: shown.map(({start, end}) => clock.formatRange(start, end)).join(', '),
      });
    }
  };

  rows.push({name: 'Sun', value: formatPosition(getSunPosition(time, lat, lng))});
  at('Sunrise', sunTimes.sunrise, getSunPosition);
  at('Sunset', sunTimes.sunset, getSunPosition);
  during('Golden hour', sunTimes.morningGolden, sunTimes.eveningGolden);
  during('Blue hour', sunTimes.morningBlue, sunTimes.eveningBlue);
  const waxing = phase.phase < 0.5 ? 'waxing' : 'waning';
  const lit = `${WHOLE.format(phase.illumination * 100)}% lit, ${waxing}`;
  rows.push({name: 'Moon', value: `${lit}, ${formatPosition(getMoonPosition(time, lat, lng))}`});
  at('Moonrise', moonTimes.moonrise, getMoonPosition);
  at('Moonset', moonTimes.moonset, getMoonPosition);
  return rows;
}

// A zero length segment, which the cap program draws as a circle
function disc([x, y]: [number, number], fill: RgbaU32, stroke: RgbaU32):
    {fill: RgbaU32; stroke: RgbaU32; radius: number; points: number[]} {
  return {fill, stroke, radius: DISC_RADIUS_PX, points: [x, y, x, y]};
}

// The angle a fraction of the way from a to b, the short way around
function lerpAngle(a: number, b: number, f: number): number {
  const turn = 2 * Math.PI;
  const delta = ((b - a) % turn + 1.5 * turn) % turn - turn / 2;
  return a + delta * f;
}

function formatPosition({azimuth, altitude}: SkyPosition): string {
  const degrees = WHOLE.format(Math.abs(altitude) * 180 / Math.PI);
  const height = altitude < 0 ? `${degrees}° below the horizon` : `${degrees}° up`;
  return `${height}, ${formatBearing(azimuth)}`;
}

function formatBearing(azimuth: number): string {
  const degrees = azimuth * 180 / Math.PI;
  return `${WHOLE.format(degrees)}° ${COMPASS[Math.round(degrees / 22.5) % 16]}`;
}
