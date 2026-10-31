import { S2LatLng, S2LatLngRect, SimpleS2 } from 'java/org/trailcatalog/s2';
import { Camera, projectS2LatLng, unprojectS2LatLng } from 'js/map/camera';
import { RgbaU32, Vec2 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { BillboardProgram } from 'js/map/rendering/billboard_program';
import { growBuffer } from 'js/map/rendering/buffers';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { Elevations } from 'js/map/workers/elevations';
import { getApparentAltitude } from 'js/map/workers/sunlight';
import {
  SKYLINE_AZIMUTHS,
  VIEWSHED_BANDS,
  ViewshedImage,
} from 'js/map/workers/terrain_tracer';
import { Z_USER_DATA_FILL, Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

import { EYE_METERS, getBearing, getElevationAngle, getSkylineAt } from './skyline';
import { SKY_PINS_MOVED } from './events';
import { formatDistance, haversineMeters } from './measurements';
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
const SKYLINE_RADIUS_PX = 1.5;
// Terrain below level drawn outside the ring, as far as from a summit you'd see it fall away
const LOWEST_SKYLINE = -10 * Math.PI / 180;
const SIGHT_RADIUS_PX = 1.5;
const PIN_FILL = 0x111827FF as RgbaU32;
const CASING = 0xFFFFFFFF as RgbaU32;
const HORIZON = 0x37415180 as RgbaU32;
const SUN = 0xF59E0BFF as RgbaU32;
const SUN_BELOW = 0xF59E0B80 as RgbaU32;
const MOON = 0x64748BFF as RgbaU32;
const MOON_DISC = 0xE2E8F0FF as RgbaU32;
const MOON_BELOW = 0xE2E8F080 as RgbaU32;
const SUN_HIDDEN = 0xF59E0B66 as RgbaU32;
const MOON_HIDDEN = 0x64748B66 as RgbaU32;
const HIDDEN_CASING = 0xFFFFFF66 as RgbaU32;
const SKYLINE = 0x374151FF as RgbaU32;
const SUBJECT_FILL = 0xFFFFFFFF as RgbaU32;
const SUBJECT_RADIUS_PX = 5;
// Where the subject starts beside the pin, outside the chart so the two are easy to tell apart,
// but no farther than a short walk so that turning the layer on zoomed out keeps them together
const SUBJECT_OFFSET_PX = 160;
const MAX_SUBJECT_OFFSET_M = 1_000;
// The viewshed's z13 band, whose pixels are 7 m in the Alps. A sighting can reach the viewshed's
// 20 km edge, and walking z15 tiles that far would fetch dozens of them.
const SIGHTING_ZOOM = 13;
const SIGHTING_STEP_METERS = 7;
// Close enough to the subject's height that the sun or moon sits on it
const ON_SUBJECT = 0.5 * Math.PI / 180;
const PATH_STEP_MS = 10 * 60 * 1000;
const VISIBLE_STEP_MS = 60 * 1000;
const VIEWSHED = 0x3B82F64D as RgbaU32;
// Darkness from the worker scales this, so shadow is a dim slate and full sun is clear.
const SHADOW = 0x1E293B8C as RgbaU32;
const CIVIL_TWILIGHT = -6 * Math.PI / 180;
// Below this a view spans hundreds of kilometers, and shadows are a few pixels.
const MIN_SUNLIGHT_ZOOM = 8;
// Over the collection's features but under anything being edited
const Z_SKY = Z_USER_DATA_HIGHLIGHT + 1;
// Under the collection's features, so its lines and points stay readable through the shading
const Z_VIEWSHED = Z_USER_DATA_FILL - 0.5;
// Under the viewshed so its blue reads through the shadow
const Z_SHADOW = Z_VIEWSHED - 0.1;
const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];
const HOUR_MS = 60 * 60 * 1000;

const WHOLE = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0});

type Position = (ms: number, latRadians: number, lngRadians: number) => SkyPosition;

/**
 * Which ground the viewshed shades: none, what the pin sees, or where a person could stand to see
 * the subject.
 */
export type ViewshedMode = 'none'|'pin'|'subject';

// Where the subject sits in the sky from the pin
interface Sighting {
  azimuth: number;
  altitude: number;
  meters: number;
  // Whether ground between the pin and the subject rises above the line to it, or undefined past
  // the viewshed's reach where we don't check
  hidden: boolean|undefined;
}

interface Line {
  fill: RgbaU32;
  stroke: RgbaU32;
  radius: number;
  points: number[];
  dashed?: boolean;
}

/**
 * Draws a chart of the sky around a pin the pointer tool drags, the way the sky looks overhead from
 * the pin. The ring is the horizon and the pin is straight up, so the sun and moon's paths over the
 * day are arcs that rise and set on the ring, with a disc where each is at the map's time.
 *
 * A second pin marks a subject to photograph, which shows on the chart where it sits in the sky,
 * so the sun or moon lines up with it where its arc crosses the subject's dot.
 */
export class SkyLayer extends Layer {

  private pin: S2LatLng|undefined;
  // The terrain's altitude around the pin, indexed by azimuth
  private terrain: Float32Array|undefined;
  private subject: S2LatLng|undefined;
  private sighting: Sighting|undefined;
  private dragging: 'pin'|'subject'|undefined;
  private viewshedMode: ViewshedMode;
  // The shading for viewshedMode, which doesn't change with zoom so it is planned once it loads
  private viewshed: Drawable[];
  private viewshedTextures: WebGLTexture[];
  private sunlight: boolean;
  private moonlight: boolean;
  // The shading for the view, and its texture
  private shade: {drawable: Drawable; texture: WebGLTexture}|undefined;
  private readonly glShade: WebGLBuffer;
  // The view in mercator from 0 to 1 with y south, and its zoom
  private view: {x0: number; y0: number; x1: number; y1: number; zoom: number}|undefined;
  // Set while a shade is out, and again when something changes under it, so that only the newest
  // view and time is shaded next
  private shading: 'idle'|'busy'|'stale';
  private readonly glViewshed: WebGLBuffer;
  // Terrain samples in flight, including ones a moved pin will discard
  private sampling: number;
  private appearing: boolean;
  private interactive: boolean;
  private time: number;
  private readonly glGeometry: WebGLBuffer;
  private geometry: ArrayBuffer;
  private drawables: Drawable[];
  private planned: number;
  // The chart is a fixed size on screen, so a zoom replans it.
  private plannedRadius: number;

  constructor(
      private readonly camera: Camera,
      private readonly elevations: Elevations,
      private readonly renderer: Renderer) {
    super();
    this.pin = undefined;
    this.terrain = undefined;
    this.subject = undefined;
    this.sighting = undefined;
    this.dragging = undefined;
    this.viewshedMode = 'none';
    this.viewshed = [];
    this.viewshedTextures = [];
    this.sunlight = false;
    this.moonlight = false;
    this.shade = undefined;
    this.view = undefined;
    this.shading = 'idle';
    this.sampling = 0;
    this.appearing = false;
    this.interactive = true;
    this.time = Date.now();
    this.glGeometry = renderer.createDataBuffer(0);
    this.glViewshed = renderer.createDataBuffer(0);
    this.glShade = renderer.createDataBuffer(0);
    this.registerDisposer(() => {
      renderer.deleteBuffer(this.glGeometry);
      renderer.deleteBuffer(this.glViewshed);
      this.clearViewshed();
      renderer.deleteBuffer(this.glShade);
      if (this.shade) {
        renderer.deleteTexture(this.shade.texture);
      }
    });
    // A day of each path at PATH_STEP_MS, the horizon, and the discs fit
    this.geometry = new ArrayBuffer(512 * LineProgram.bytesNeeded(2));
    this.drawables = [];
    this.planned = -1;
    this.plannedRadius = 0;
  }

  setTime(time: number): void {
    if (time !== this.time) {
      this.time = time;
      this.redraw();
      this.loadShade();
    }
  }

  /** Shades the view by what the sun lights at the map's time. */
  setSunlight(sunlight: boolean): void {
    if (sunlight !== this.sunlight) {
      this.sunlight = sunlight;
      this.redraw();
      this.loadShade();
    }
  }

  /** Shades the view by what the moon lights at the map's time, once the sun is down. */
  setMoonlight(moonlight: boolean): void {
    if (moonlight !== this.moonlight) {
      this.moonlight = moonlight;
      this.redraw();
      this.loadShade();
    }
  }

  /** Puts the pin at the center of the screen on the next viewport, unless it is already on it. */
  appear(): void {
    this.appearing = true;
  }

  /** Describes the sky at the pin for the click menu, if a point is near the pin or the subject. */
  getReadingsNear(point: S2LatLng, time: number): Array<{name: string; value: string}> {
    return this.pin && (this.isNear(this.pin, point) || this.isNear(this.subject, point))
        ? getSkyReadings(this.pin, time, this.terrain, this.sighting)
        : [];
  }

  setViewshed(mode: ViewshedMode): void {
    if (mode !== this.viewshedMode) {
      this.viewshedMode = mode;
      this.clearViewshed();
      this.redraw();
      this.loadViewshed();
    }
  }

  // Off for the drawing tools, so that a press on the pin places a vertex instead.
  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
  }

  override viewportChanged(bounds: S2LatLngRect, zoom: number): void {
    // Mercator from 0 to 1 with y south, which is what the elevation worker reads tiles in
    const toWorld = (lat: number, lng: number): [number, number] => [
      (lng + Math.PI) / (2 * Math.PI),
      0.5 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / (2 * Math.PI),
    ];
    const [x0, y0] = toWorld(bounds.lat().hi(), bounds.lng().lo());
    const [x1, y1] = toWorld(bounds.lat().lo(), bounds.lng().hi());
    this.view = {x0, y0, x1, y1, zoom};
    this.loadShade();
    if (!this.appearing) {
      return;
    }
    this.appearing = false;
    const onScreen = (point: S2LatLng|undefined) =>
        point !== undefined && bounds.contains(S2LatLngRect.fromPoint(point));
    const pin = onScreen(this.pin) ? undefined : this.camera.center;
    const [x, y] = projectS2LatLng(pin ?? this.pin!);
    const subject =
        onScreen(this.subject)
            ? undefined
            : unprojectS2LatLng(
                x
                    + Math.min(
                        SUBJECT_OFFSET_PX * this.camera.inverseWorldRadius,
                        // Mercator x is longitude over pi, stretched by 1 / cos(latitude)
                        SimpleS2.earthMetersToAngle(MAX_SUBJECT_OFFSET_M).radians() / Math.PI
                            / Math.cos((pin ?? this.pin!).latRadians())),
                y);
    this.place(pin, subject);
  }

  // The subject sits on top, so it wins a press on both.
  override dragStart(point: S2LatLng, px: [number, number], source: EventSource): boolean {
    this.dragging =
        !this.interactive
            ? undefined
            : this.isNear(this.subject, point)
                ? 'subject'
                : this.isNear(this.pin, point) ? 'pin' : undefined;
    return this.dragging !== undefined;
  }

  override drag(point: S2LatLng, source: EventSource): void {
    if (this.dragging === 'subject') {
      this.moveSubject(point);
    } else {
      this.movePin(point);
    }
  }

  // Sampling the terrain takes a moment, so a drag only does it once it lets go.
  override dragEnd(point: S2LatLng, moved: boolean, source: EventSource): void {
    if (moved) {
      if (this.dragging === 'pin') {
        this.loadSkyline();
      }
      if (this.dragging === this.viewshedMode) {
        this.loadViewshed();
      }
      this.loadSighting();
      if (this.pin && this.subject) {
        source.trigger(
            SKY_PINS_MOVED, {pin: formatPin(this.pin), subject: formatPin(this.subject)});
      }
    }
    this.dragging = undefined;
  }

  /**
   * Puts the pins where saved values put them, as lat,lng degrees. Pins already there stay put,
   * so that their terrain doesn't load again.
   */
  setPins(pin: string|undefined, subject: string|undefined): void {
    const moved = (from: S2LatLng|undefined, to: string|undefined) =>
        from && formatPin(from) === to ? undefined : parsePin(to);
    this.place(moved(this.pin, pin), moved(this.subject, subject));
  }

  override loadingData(): boolean {
    return this.sampling > 0;
  }

  override render(planner: Planner): void {
    if (this.generation !== this.planned
        || this.camera.inverseWorldRadius !== this.plannedRadius) {
      this.plan();
      this.planned = this.generation;
      this.plannedRadius = this.camera.inverseWorldRadius;
    }
    planner.add(this.drawables);
  }

  private place(pin: S2LatLng|undefined, subject: S2LatLng|undefined): void {
    if (pin) {
      this.movePin(pin);
      this.loadSkyline();
    }
    if (subject) {
      this.moveSubject(subject);
    }
    if (pin || subject) {
      this.loadSighting();
    }
    if ((pin && this.viewshedMode === 'pin') || (subject && this.viewshedMode === 'subject')) {
      this.loadViewshed();
    }
  }

  private movePin(pin: S2LatLng): void {
    this.pin = pin;
    this.terrain = undefined;
    this.sighting = undefined;
    if (this.viewshedMode === 'pin') {
      this.clearViewshed();
    }
    this.redraw();
  }

  private moveSubject(subject: S2LatLng): void {
    this.subject = subject;
    this.sighting = undefined;
    if (this.viewshedMode === 'subject') {
      this.clearViewshed();
    }
    this.redraw();
  }

  // From the pin, its eye looks at the ground. Of the subject, the subject itself looks at a
  // person's eye, which is the same line of sight run the other way.
  private loadViewshed(): void {
    const mode = this.viewshedMode;
    const source = mode === 'pin' ? this.pin : mode === 'subject' ? this.subject : undefined;
    if (!source) {
      return;
    }
    const [sourceHeight, targetHeight] = mode === 'pin' ? [EYE_METERS, 0] : [0, EYE_METERS];
    const stillWanted = () =>
        this.viewshedMode === mode && (mode === 'pin' ? this.pin : this.subject) === source;
    this.sample(this.elevations.trace({
      latDegrees: source.latDegrees(),
      lngDegrees: source.lngDegrees(),
      sourceHeight,
      targetHeight,
      of: 'viewshed',
    }))
        .then(({images}) => {
          if (stillWanted()) {
            this.planViewshed(images);
            this.redraw();
          }
        }, e => {
          console.error(e);
        });
  }

  // One image per band of the trace, which the bilinear filter softens at the edges of
  private planViewshed(images: ViewshedImage[]): void {
    this.clearViewshed();
    const buffer = new ArrayBuffer(BillboardProgram.bytesNeeded() * images.length);
    let offset = 0;
    for (const {x, y, size, pixels, rgba} of images) {
      const texture = this.renderer.createTexture();
      this.renderer.uploadTexture(new ImageData(rgba, pixels, pixels), texture);
      this.viewshedTextures.push(texture);
      // From the worker's 0 to 1 with y south to mercator's -1 to 1 with y north
      const {byteSize, drawable} =
          this.renderer.billboardProgram.plan(
              [2 * (x + size / 2) - 1, 1 - 2 * (y + size / 2)],
              [0, 0],
              [2 * size, 2 * size],
              /* angle= */ 0,
              VIEWSHED,
              Z_VIEWSHED,
              /* atlasIndex= */ 0,
              /* atlasSize= */ [1, 1],
              buffer,
              offset,
              this.glViewshed,
              texture);
      this.viewshed.push(drawable);
      offset += byteSize;
    }
    this.renderer.uploadData(buffer, offset, this.glViewshed);
  }

  // Mapterhorn's tiles are 512 pixels, so the DEM zoom whose pixels match the screen's is one less.
  private loadShade(): void {
    const view = this.view;
    const light = this.getLight();
    if (!light || !view || view.zoom < MIN_SUNLIGHT_ZOOM || view.x1 <= view.x0) {
      if (this.shade) {
        this.renderer.deleteTexture(this.shade.texture);
        this.shade = undefined;
        this.redraw();
      }
      return;
    }
    if (this.shading !== 'idle') {
      this.shading = 'stale';
      return;
    }
    this.shading = 'busy';
    this.sample(this.elevations.shade({...view, zoom: Math.round(view.zoom) - 1, ...light}))
        .finally(() => {
          const stale = this.shading === 'stale';
          this.shading = 'idle';
          if (stale) {
            this.loadShade();
          }
        })
        .then(({x, y, width, height, pixels, rgba}) => {
          if (!this.getLight()) {
            return;
          }
          const texture = this.renderer.createTexture();
          this.renderer.uploadTexture(new ImageData(rgba, pixels[0], pixels[1]), texture);
          const buffer = new ArrayBuffer(BillboardProgram.bytesNeeded());
          // From the worker's 0 to 1 with y south to mercator's -1 to 1 with y north
          const {byteSize, drawable} =
              this.renderer.billboardProgram.plan(
                  [2 * (x + width / 2) - 1, 1 - 2 * (y + height / 2)],
                  [0, 0],
                  [2 * width, 2 * height],
                  /* angle= */ 0,
                  SHADOW,
                  Z_SHADOW,
                  /* atlasIndex= */ 0,
                  /* atlasSize= */ [1, 1],
                  buffer,
                  /* offset= */ 0,
                  this.glShade,
                  texture);
          this.renderer.uploadData(buffer, byteSize, this.glShade);
          if (this.shade) {
            this.renderer.deleteTexture(this.shade.texture);
          }
          this.shade = {drawable, texture};
          this.redraw();
        }, e => {
          console.error(e);
        });
  }

  // The moon once the sun is past civil twilight, which is when it is the brighter light, or else
  // the sun. Undefined when neither is asked for at this time.
  private getLight(): {azimuth: number; altitude: number; brightness: number}|undefined {
    const center = this.camera.center;
    const [lat, lng] = [center.latRadians(), center.lngRadians()];
    const sun = getSunPosition(this.time, lat, lng);
    if (this.moonlight && sun.altitude < CIVIL_TWILIGHT) {
      // getMoonPosition already includes refraction.
      const {azimuth, altitude} = getMoonPosition(this.time, lat, lng);
      return {azimuth, altitude, brightness: getMoonPhase(this.time).illumination};
    } else if (this.sunlight) {
      return {azimuth: sun.azimuth, altitude: getApparentAltitude(sun.altitude), brightness: 1};
    } else {
      return undefined;
    }
  }

  // Counts the request in sampling while it is out, so loadingData covers it.
  private sample<T>(request: Promise<T>): Promise<T> {
    this.sampling += 1;
    this.redraw();
    return request.finally(() => {
      this.sampling -= 1;
      this.redraw();
    });
  }

  private clearViewshed(): void {
    for (const texture of this.viewshedTextures) {
      this.renderer.deleteTexture(texture);
    }
    this.viewshedTextures = [];
    this.viewshed = [];
  }

  private loadSighting(): void {
    const pin = this.pin;
    const subject = this.subject;
    if (!pin || !subject) {
      return;
    }
    const [lat0, lng0] = [pin.latDegrees(), pin.lngDegrees()];
    const [lat1, lng1] = [subject.latDegrees(), subject.lngDegrees()];
    const distance = haversineMeters(lat0, lng0, lat1, lng1);
    // The pin, the subject, and the ground between them a z13 pixel apart, like the viewshed
    // steps, since only nearer terrain can hide the subject. Past the viewshed's reach we sample
    // just the two ends, or else one sighting walks z13 tiles across a state.
    const checked = distance <= VIEWSHED_BANDS[VIEWSHED_BANDS.length - 1].toMeters;
    const steps = checked ? Math.ceil(distance / SIGHTING_STEP_METERS) : 1;
    const samples = new Float64Array(2 * (steps + 1));
    for (let i = 0; i <= steps; ++i) {
      // Straight in degrees, which is close enough to the great circle over a few kilometers
      samples[2 * i] = lat0 + (lat1 - lat0) * i / steps;
      samples[2 * i + 1] = lng0 + (lng1 - lng0) * i / steps;
    }
    this.sample(this.elevations.sample(samples, SIGHTING_ZOOM, 'sighting'))
        .then(meters => {
          if (this.pin !== pin || this.subject !== subject) {
            return;
          }
          const eye = meters[0] + EYE_METERS;
          const altitude = getElevationAngle(eye, meters[steps], distance);
          let hidden = checked ? false : undefined;
          for (let i = 1; i < steps; ++i) {
            if (getElevationAngle(eye, meters[i], distance * i / steps) > altitude) {
              hidden = true;
              break;
            }
          }
          this.sighting = {
            azimuth: getBearing(lat0, lng0, lat1, lng1),
            altitude,
            meters: distance,
            hidden,
          };
          this.redraw();
        }, e => {
          // A later sighting replacing this one rejects it too.
          if (this.pin === pin && this.subject === subject) {
            console.error(e);
          }
        });
  }

  private loadSkyline(): void {
    const pin = this.pin;
    if (!pin) {
      return;
    }
    this.sample(this.elevations.trace({
      latDegrees: pin.latDegrees(),
      lngDegrees: pin.lngDegrees(),
      sourceHeight: EYE_METERS,
      targetHeight: 0,
      of: 'skyline',
    }))
        .then(({skyline}) => {
          if (this.pin === pin) {
            this.terrain = skyline;
            this.redraw();
          }
        }, e => {
          console.error(e);
        });
  }

  private isNear(pin: S2LatLng|undefined, point: S2LatLng): boolean {
    if (!pin) {
      return false;
    }
    const [x, y] = projectS2LatLng(point);
    const [px, py] = projectS2LatLng(pin);
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
    const toChart = (azimuth: number, altitude: number): [number, number] => {
      const r = chartRadius * (1 - altitude / (Math.PI / 2));
      return [x + r * Math.sin(azimuth), y + r * Math.cos(azimuth)];
    };
    const chart = ({azimuth, altitude}: SkyPosition) => toChart(azimuth, Math.max(altitude, 0));
    const terrain = this.terrain;
    // The parts of a day's path above the horizon, ending on the ring where it rises and sets. A
    // part behind the terrain is hidden, so the bright parts of the arc are when you can see it.
    const noon = getSunTimes(this.time, lat, lng).noon;
    const arcs = (position: Position, fill: RgbaU32, hiddenFill: RgbaU32): Line[] => {
      const runs: Line[] = [];
      let points: number[] = [];
      // Unset until the run has a point above the horizon
      let hidden: boolean|undefined;
      const end = () => {
        if (points.length >= 4) {
          runs.push({
            fill: hidden ? hiddenFill : fill,
            stroke: hidden ? HIDDEN_CASING : CASING,
            radius: PATH_RADIUS_PX,
            points,
          });
        }
        points = [];
        hidden = undefined;
      };
      let previous: SkyPosition|undefined;
      for (let t = noon - 12 * HOUR_MS; t <= noon + 12 * HOUR_MS; t += PATH_STEP_MS) {
        const now = position(t, lat, lng);
        if (previous && (previous.altitude < 0) !== (now.altitude < 0)) {
          const f = previous.altitude / (previous.altitude - now.altitude);
          const azimuth = lerpAngle(previous.azimuth, now.azimuth, f);
          points.push(...toChart(azimuth, 0));
          if (now.altitude < 0) {
            end();
          }
        }
        if (now.altitude >= 0) {
          const point = chart(now);
          const nowHidden = isHidden(terrain, now);
          if (hidden !== undefined && hidden !== nowHidden) {
            // The two parts share a vertex so the arc has no gap.
            points.push(...point);
            end();
          }
          hidden = nowHidden;
          points.push(...point);
        }
        previous = now;
      }
      end();
      return runs;
    };

    const sun = getSunPosition(this.time, lat, lng);
    const moon = getMoonPosition(this.time, lat, lng);
    const lines: Line[] = [];
    for (const [body, fill] of [[moon, MOON], [sun, SUN]] as const) {
      if (body.altitude >= 0) {
        const points = [x, y, ...chart(body)];
        const dashed = isHidden(terrain, body);
        lines.push({fill, stroke: CASING, radius: SIGHT_RADIUS_PX, points, dashed});
      }
    }
    const subject = this.subject && projectS2LatLng(this.subject);
    if (subject) {
      const dashed = this.sighting?.hidden ?? false;
      // White like the subject's pin, so it doesn't read as the slate moon line
      const points = [x, y, ...subject];
      lines.push({fill: SUBJECT_FILL, stroke: SKYLINE, radius: 1.5, points, dashed});
    }
    const ring = [];
    for (let i = 0; i <= 64; ++i) {
      ring.push(...toChart(i / 64 * 2 * Math.PI, 0));
    }
    lines.push({fill: HORIZON, stroke: HORIZON, radius: 1, points: ring});
    if (terrain) {
      const skyline = [];
      for (let a = 0; a <= SKYLINE_AZIMUTHS; ++a) {
        const altitude = Math.max(terrain[a % SKYLINE_AZIMUTHS], LOWEST_SKYLINE);
        skyline.push(...toChart(a / SKYLINE_AZIMUTHS * 2 * Math.PI, altitude));
      }
      lines.push({fill: SKYLINE, stroke: CASING, radius: SKYLINE_RADIUS_PX, points: skyline});
    }
    lines.push(
        ...arcs(getMoonPosition, MOON, MOON_HIDDEN),
        ...arcs(getSunPosition, SUN, SUN_HIDDEN));
    // Drawn like the subject's pin on the map so the two read as the same thing
    if (this.sighting) {
      const {azimuth, altitude} = this.sighting;
      const at = toChart(azimuth, Math.max(altitude, LOWEST_SKYLINE));
      lines.push(dot(at, SUBJECT_FILL, SKYLINE, SUBJECT_RADIUS_PX));
    }
    lines.push(dot([x, y], PIN_FILL, CASING, PIN_RADIUS_PX));
    if (subject) {
      lines.push(dot(subject, SUBJECT_FILL, SKYLINE, SUBJECT_RADIUS_PX));
    }
    lines.push(
        dot(chart(moon), isHidden(terrain, moon) ? MOON_BELOW : MOON_DISC, MOON, DISC_RADIUS_PX),
        dot(chart(sun), isHidden(terrain, sun) ? SUN_BELOW : SUN, CASING, DISC_RADIUS_PX));

    this.geometry =
        growBuffer(
            this.geometry,
            lines.reduce((bytes, {points}) =>
                bytes + LineProgram.bytesNeeded(points.length / 2), 0));
    const drawables: Drawable[] = [];
    let offset = 0;
    for (const {fill, stroke, radius, points, dashed} of lines) {
      const result =
          LineProgram.push(
              fill, stroke, radius, dashed ? 'dashed' : 'solid', points, this.geometry, offset);
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
    drawables.push(...this.viewshed);
    if (this.shade) {
      drawables.push(this.shade.drawable);
    }
    this.drawables = drawables;
  }
}

// The sun and moon at a spot and time as rows for the click menu, with when each clears the
// terrain once that has loaded
function getSkyReadings(
    point: S2LatLng,
    time: number,
    terrain: Float32Array|undefined,
    sighting: Sighting|undefined): Array<{name: string; value: string}> {
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

  // Where the sun or moon crosses the subject's direction, and how far above it it is then
  const lineUp = (name: string, position: Position) => {
    if (!sighting) {
      return;
    }
    const crossing = getCrossing(position, sunTimes.noon, lat, lng, sighting.azimuth);
    if (crossing) {
      const above = crossing.altitude - sighting.altitude;
      const offset =
          Math.abs(above) < ON_SUBJECT
              ? 'on it'
              : `${formatDegrees(above)} ${above > 0 ? 'above' : 'below'} it`;
      rows.push({name, value: `${clock.format(crossing.time)}, ${offset}`});
    }
  };

  if (sighting) {
    const hidden = sighting.hidden ? ', behind terrain' : '';
    rows.push({
      name: 'Subject',
      value:
          `${formatDistance(sighting.meters)}, ${formatBearing(sighting.azimuth)}, `
              + formatAngle(sighting.altitude) + hidden,
    });
  }
  rows.push({name: 'Sun', value: formatPosition(getSunPosition(time, lat, lng))});
  at('Sunrise', sunTimes.sunrise, getSunPosition);
  at('Sunset', sunTimes.sunset, getSunPosition);
  during('Sun visible', getVisibleSpan(getSunPosition, sunTimes.noon, lat, lng, terrain));
  lineUp('Sun lines up', getSunPosition);
  during('Golden hour', sunTimes.morningGolden, sunTimes.eveningGolden);
  during('Blue hour', sunTimes.morningBlue, sunTimes.eveningBlue);
  const waxing = phase.phase < 0.5 ? 'waxing' : 'waning';
  const lit = `${WHOLE.format(phase.illumination * 100)}% lit, ${waxing}`;
  rows.push({name: 'Moon', value: `${lit}, ${formatPosition(getMoonPosition(time, lat, lng))}`});
  at('Moonrise', moonTimes.moonrise, getMoonPosition);
  at('Moonset', moonTimes.moonset, getMoonPosition);
  during('Moon visible', getVisibleSpan(getMoonPosition, sunTimes.noon, lat, lng, terrain));
  lineUp('Moon lines up', getMoonPosition);
  return rows;
}

// The first and last times in the day around noon that something is above the terrain
function getVisibleSpan(
    position: Position, noon: number, lat: number, lng: number, terrain: Float32Array|undefined):
    {start: number; end: number}|undefined {
  if (!terrain) {
    return undefined;
  }
  let start;
  let end;
  for (let t = noon - 12 * HOUR_MS; t <= noon + 12 * HOUR_MS; t += VISIBLE_STEP_MS) {
    if (!isHidden(terrain, position(t, lat, lng))) {
      start ??= t;
      end = t;
    }
  }
  return start !== undefined && end !== undefined ? {start, end} : undefined;
}

function isHidden(terrain: Float32Array|undefined, {azimuth, altitude}: SkyPosition): boolean {
  return altitude < 0 || (terrain !== undefined && altitude < getSkylineAt(terrain, azimuth));
}

// The first time in the day around noon that something above the horizon crosses an azimuth
function getCrossing(
    position: Position, noon: number, lat: number, lng: number, azimuth: number):
    {time: number; altitude: number}|undefined {
  // Within half a turn, so a crossing shows as the sign changing near zero
  const offset = (t: number) => wrapAngle(position(t, lat, lng).azimuth - azimuth);
  const start = noon - 12 * HOUR_MS;
  let previous = offset(start);
  for (let t = start + VISIBLE_STEP_MS; t <= noon + 12 * HOUR_MS; t += VISIBLE_STEP_MS) {
    const now = offset(t);
    if ((previous < 0) !== (now < 0) && Math.abs(now - previous) < Math.PI / 2) {
      const at = t - VISIBLE_STEP_MS * now / (now - previous);
      const {altitude} = position(at, lat, lng);
      if (altitude >= 0) {
        return {time: at, altitude};
      }
    }
    previous = now;
  }
  return undefined;
}

// A zero length segment, which the cap program draws as a circle
function dot([x, y]: Vec2, fill: RgbaU32, stroke: RgbaU32, radius: number): Line {
  return {fill, stroke, radius, points: [x, y, x, y]};
}

// The angle a fraction of the way from a to b, the short way around
function lerpAngle(a: number, b: number, f: number): number {
  return a + wrapAngle(b - a) * f;
}

// The same angle within half a turn of zero
function wrapAngle(angle: number): number {
  const turn = 2 * Math.PI;
  return (angle % turn + 1.5 * turn) % turn - turn / 2;
}

function formatPosition({azimuth, altitude}: SkyPosition): string {
  const height = `${formatDegrees(altitude)} ${altitude < 0 ? 'below the horizon' : 'up'}`;
  return `${height}, ${formatBearing(azimuth)}`;
}

// Six decimal places of a degree is a tenth of a meter.
function formatPin(pin: S2LatLng): string {
  return `${pin.latDegrees().toFixed(6)},${pin.lngDegrees().toFixed(6)}`;
}

function parsePin(text: string|undefined): S2LatLng|undefined {
  const [lat, lng] = (text ?? '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? S2LatLng.fromDegrees(lat, lng) : undefined;
}

function formatAngle(altitude: number): string {
  return `${formatDegrees(altitude)} ${altitude < 0 ? 'down' : 'up'}`;
}

function formatDegrees(radians: number): string {
  return `${WHOLE.format(Math.abs(radians) * 180 / Math.PI)}°`;
}

function formatBearing(azimuth: number): string {
  const degrees = azimuth * 180 / Math.PI;
  return `${WHOLE.format(degrees)}° ${COMPASS[Math.round(degrees / 22.5) % 16]}`;
}
