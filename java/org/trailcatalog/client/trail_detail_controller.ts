import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';
import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { CorgiEvent, DOM_POINTER } from 'external/dev_april_corgi+/js/corgi/events';
import { HistoryService } from 'external/dev_april_corgi+/js/corgi/history/history_service';

import { S2LatLng, S2Point, SimpleS2 } from 'java/org/trailcatalog/s2';
import { unprojectS2LatLng } from 'js/map/camera';
import { Vec2 } from 'js/map/common/types';

import { MapDataService } from './data/map_data_service';
import { ACTIVE_PALETTE, ERROR_PALETTE } from './map/colors';
import { Boundary, ElevationProfile, Trail } from './models/types';

import { fetchData, TrailId } from './data';
import * as routes from './routes';
import { containingBoundariesFromRaw, pathProfilesInTrailFromRaw, trailFromRaw } from './trails';
import { Args as VArgs, State as VState, ViewportController } from './viewport_controller';

const ELEVATION_GRAPH_RESOLUTION_WIDTH = 400;

interface LatLngAltitude {
  lat: number;
  lng: number;
  altitude: number;
};

export interface Args extends VArgs {
  trailId: TrailId;
}

export interface TrailData {
  containingBoundaries: Future<Boundary[]>;
  epochDate: Future<Date>;
  pathProfiles: Future<Map<bigint, ElevationProfile>>;
  tags: Future<{[key: string]: string}>;
  trail: Future<Trail>;
  trailId: TrailId;
}

export interface State extends TrailData, VState {
  elevation?: {
    cursor?: LatLngAltitude;
    cursorFraction?: number;
    extremes: [number, number];
    heights: string;
    // The main line's length, which is all of a trail that traces as one line
    lengthMeters: number;
    points: LatLngAltitude[];
    resolution: Vec2;
  },
  weather?: {
    temperatureCelsius: number;
    weatherCode: number;
  };
}

type Deps = typeof TrailDetailController.deps;

export class TrailDetailController extends ViewportController<Args, Deps, State> {

  static deps() {
    return ViewportController.deps();
  }

  private readonly data: MapDataService;
  private readonly navigation: HistoryService;
  private next: TrailData|undefined;
  private readonly shown: Disposable;

  constructor(response: Response<TrailDetailController>) {
    super(response);
    this.data = response.deps.services.mapData;
    this.navigation = response.deps.services.history;
    this.next = undefined;
    this.shown = new Disposable();
    this.registerDisposable(this.shown);
    this.showTrail();
  }

  // The map lives as long as this controller, so we load the next trail here and keep showing the
  // current one until it arrives, or else the map and its tiles would be torn down and rebuilt.
  override updateArgs(newArgs: Args): void {
    super.updateArgs(newArgs);

    const trailId = newArgs.trailId;
    if (isSameTrailId(trailId, this.state.trailId)) {
      this.next = undefined;
      return;
    }
    if (this.next && isSameTrailId(trailId, this.next.trailId)) {
      return;
    }

    const next = loadTrail(trailId);
    this.next = next;
    this.updateState({
      ...this.state,
      selected: [],
    });
    const swap = () => {
      if (this.next !== next) {
        return;
      }
      this.next = undefined;
      this.shown.dispose();
      this.setActive(this.state.trail.value(), false, ACTIVE_PALETTE);
      this.updateState({
        ...this.state,
        ...next,
        elevation: undefined,
        weather: undefined,
      });
      // A failed load renders the error page, which disposes us.
      if (isTrailLoaded(next)) {
        const trail = next.trail.value();
        this.setActive(trail, true, trail.lengthMeters >= 0 ? ACTIVE_PALETTE : ERROR_PALETTE);
        this.showTrail();
      }
    };
    Promise.all(getTrailFutures(next)).then(swap, swap);
  }

  private showTrail(): void {
    const loaded = this.state.trail;
    const trail = loaded.value();
    this.navigation.silentlyReplaceUrl(`/trail/${trail.readableId}`);

    const reference = this.data.addPin({trail: trail.id});
    this.shown.registerDisposable(reference);
    reference.loaded.then(() => {
      if (this.state.trail !== loaded) {
        return;
      }
      this.updateState({
        ...this.state,
        elevation: calculateGraph(this.data, this.state.pathProfiles.value(), trail),
      });
    });

    const center = unprojectS2LatLng(trail.markerPx[0], trail.markerPx[1]);
    fetch(
        'https://api.open-meteo.com/v1/forecast'
            + `?latitude=${center.latDegrees()}`
            + `&longitude=${center.lngDegrees()}`
            + '&current_weather=true')
        .then(response => response.json())
        .then(response => {
          if (this.state.trail !== loaded) {
            return;
          }
          this.updateState({
            ...this.state,
            weather: {
              temperatureCelsius: response.current_weather.temperature,
              weatherCode: response.current_weather.weathercode,
            },
          });
        });
  }

  browseMap() {
    routes.showOverview({camera: this.mapController.cameraLlz}, this.views);
  }

  clearElevationCursor(e: CorgiEvent<typeof DOM_POINTER>) {
    if (!this.state.elevation) {
      return;
    }

    this.updateState({
      ...this.state,
      elevation: {
        ...this.state.elevation,
        cursor: undefined,
        cursorFraction: undefined,
      },
    });
  }

  moveElevationCursor(e: CorgiEvent<typeof DOM_POINTER>) {
    if (!this.state.elevation) {
      return;
    }

    const elevation = this.state.elevation;
    const svg = e.actionElement.element() as SVGSVGElement;
    const transform = checkExists(svg.getScreenCTM()).inverse();
    const p = svg.createSVGPoint();
    p.x = e.detail.clientX;
    p.y = e.detail.clientY;
    const fraction = p.matrixTransform(transform).x / ELEVATION_GRAPH_RESOLUTION_WIDTH;
    // Not exactly accurate (points might be very close at the path edges) but I don't care.
    const point = elevation.points[Math.floor(fraction * elevation.points.length)];

    this.updateState({
      ...this.state,
      elevation: {
        ...elevation,
        cursor: point,
        cursorFraction: fraction,
      },
    });
  }

  zoomToFit(): void {
    this.mapController?.setCamera(this.state.trail.value().bound);
  }
}

export function loadTrail(trailId: TrailId): TrailData {
  return {
    containingBoundaries:
        fetchData('boundaries_containing_trail', {trail_id: trailId})
            .then(containingBoundariesFromRaw),
    epochDate: fetchData('epoch', {}).then(raw => new Date(raw.timestampS * 1000)),
    pathProfiles:
        fetchData('path_profiles_in_trail', {trail_id: trailId}).then(pathProfilesInTrailFromRaw),
    tags: fetchData('trail_tags', {trail_id: trailId}).then(raw => raw.tags),
    trail: fetchData('trail', {trail_id: trailId}).then(trailFromRaw),
    trailId,
  };
}

export function getTrailFutures(data: TrailData): Array<Future<unknown>> {
  return [data.containingBoundaries, data.epochDate, data.pathProfiles, data.tags, data.trail];
}

export function isTrailLoaded(data: TrailData): boolean {
  return getTrailFutures(data).every(f => f.finished && f.ok);
}

export function isSameTrailId(a: TrailId, b: TrailId): boolean {
  return 'numeric' in a
      ? 'numeric' in b && a.numeric === b.numeric
      : 'readable' in b && a.readable === b.readable;
}

export function calculateGraph(
    data: MapDataService,
    pathProfiles: Map<bigint, ElevationProfile>,
    trail: Trail): {
  extremes: [number, number];
  heights: string;
  lengthMeters: number;
  points: LatLngAltitude[];
  resolution: Vec2;
} {
  const resolutionHeight = 300;
  let min = Number.MAX_VALUE;
  let max = Number.MIN_VALUE;
  let length = 0;

  const heights: Vec2[] = [];
  const latLngs: LatLngAltitude[] = [];
  let lastPoint: S2Point|undefined = undefined;
  const process = (point: S2Point, sample: number) => {
    const ll = S2LatLng.fromPoint(point);
    latLngs.push({lat: ll.latDegrees(), lng: ll.lngDegrees(), altitude: sample});
    heights.push([length, sample]);
    min = Math.min(min, sample);
    max = Math.max(max, sample);

    if (lastPoint != null) {
      length += lastPoint.angle(point) * SimpleS2.EARTH_RADIUS_METERS;
    }
    lastPoint = point;
  };
  // A relation that branches or breaks has no single line through it, so the importer puts its
  // main line first and appends whatever it could not chain on. Two paths that meet share an OSM
  // node and project to the same doubles, so a start that doesn't match the last end is where the
  // main line stopped. Carrying on from there would draw tens of kilometers of straight line
  // across the gap.
  let lastX: number|undefined = undefined;
  let lastY: number|undefined = undefined;
  for (let i = 0; i < trail.paths.length; ++i) {
    const pathId = trail.paths[i];
    const path = data.pinnedPaths.get(pathId & ~1n);
    if (!path) {
      console.error(`Path ${pathId} is missing`);
      continue;
    }

    const line = path.line;
    const forward = (pathId & 1n) === 0n;
    const startX = forward ? line[0] : line[line.length - 2];
    const startY = forward ? line[1] : line[line.length - 1];
    if (lastX !== undefined && (lastX !== startX || lastY !== startY)) {
      break;
    }
    lastX = forward ? line[line.length - 2] : line[0];
    lastY = forward ? line[line.length - 1] : line[1];

    const profile = checkExists(pathProfiles.get(pathId & ~1n));
    const points = calculateSampleLocations(profile.granularityMeters, line);
    const samples = profile.samplesMeters;
    const offset = i === 0 ? 0 : 1;

    // I think there are some precision mismatches that can result in a different number of points
    if (samples.length === points.length + 1) {
      console.error(`Path ${pathId}'s points and samples don't match`);
      points.push(points[points.length - 1]);
    }

    if (forward) {
      for (let j = offset; j < samples.length; ++j) {
        process(points[j], samples[j]);
      }
    } else {
      for (let j = samples.length - 1 - offset; j >= 0; --j) {
        process(points[j], samples[j]);
      }
    }
  }

  const inverseHeight = resolutionHeight / (max - min);
  const inverseLength = ELEVATION_GRAPH_RESOLUTION_WIDTH / length;
  const heightsString = heights.map(([x, y]) => {
    const fx = Math.floor(x * inverseLength);
    // We y-flip here because it makes the transforms in the element simpler.
    const fy = Math.floor((max - y) * inverseHeight);
    return `${fx},${fy}`;
  }).join(' ');
  return {
    extremes: [min, max],
    heights: heightsString,
    lengthMeters: length,
    points: latLngs,
    resolution: [ELEVATION_GRAPH_RESOLUTION_WIDTH, resolutionHeight],
  };
}

function calculateSampleLocations(
    granularityMeters: number, line: Float32Array|Float64Array): S2Point[] {
  const increment = granularityMeters / SimpleS2.EARTH_RADIUS_METERS;
  const points = [];
  let current = 0;
  let previous = unprojectS2LatLng(line[0], line[1]).toPoint();
  let offsetRadians = 0;
  for (let i = 2; i < line.length; i += 2) {
    const next = unprojectS2LatLng(line[i], line[i + 1]).toPoint();
    const length = previous.angle(next);
    let position = offsetRadians;
    while (position < length) {
      const fraction = Math.sin(position) / Math.sin(length);
      const point =
          previous
              .mul(Math.cos(position) - fraction * Math.cos(length))
              .add(next.mul(fraction));
      points.push(point);
      position += increment;
    }
    previous = next;
    offsetRadians = position - length;
  }
  // Always add the last point
  points.push(previous);
  return points;
}
