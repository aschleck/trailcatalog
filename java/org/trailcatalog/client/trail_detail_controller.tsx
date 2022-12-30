import { S2Point } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExists } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { HistoryService } from 'js/corgi/history/history_service';
import { CorgiEvent } from 'js/corgi/events';

import { LatLng, Vec2 } from './common/types';
import { MapDataService } from './data/map_data_service';
import { SELECTION_CHANGED } from './map/events';
import { unprojectS2LatLng } from './map/models/camera';
import { Boundary, ElevationProfile, Path, Trail } from './models/types';

import { fetchData, TrailId } from './data';
import { containingBoundariesFromRaw, pathProfilesInTrailFromRaw, trailFromRaw } from './trails';

interface Args {
  trailId: TrailId;
}

export interface State {
  containingBoundaries?: Boundary[];
  elevation?: {
    cursor?: LatLng;
    cursorFraction?: number;
    extremes: [number, number];
    heights: string;
    points: LatLng[];
    resolution: Vec2;
  }
  pathProfiles?: Map<bigint, ElevationProfile>;
  pinned: boolean;
  selectedCardPosition: Vec2;
  selectedTrails: Trail[];
  trail?: Trail;
  weather?: {
    temperatureCelsius: number;
    weatherCode: number;
  };
}

type Deps = typeof TrailDetailController.deps;

export class TrailDetailController extends Controller<Args, Deps, HTMLElement, State> {

  static deps() {
    return {
      services: {
        data: MapDataService,
        history: HistoryService,
      },
    };
  }

  private readonly data: MapDataService;

  constructor(response: Response<TrailDetailController>) {
    super(response);
    this.data = response.deps.services.data;
    const history = response.deps.services.history;

    const pin = (trail: Trail) => {
      this.data.setPins({trail: trail.id}, true).then(_ => {
        this.updateState({
          ...this.state,
          pinned: true,
        });
      });

      history.silentlyReplaceUrl(`/trail/${trail.readableId}`);

      const center = unprojectS2LatLng(trail.markerPx[0], trail.markerPx[1]);
      fetch(
          'https://api.open-meteo.com/v1/forecast'
              + `?latitude=${center.latDegrees()}`
              + `&longitude=${center.lngDegrees()}`
              + '&current_weather=true')
          .then(response => response.json())
          .then(response => {
            this.updateState({
              ...this.state,
              weather: {
                temperatureCelsius: response.current_weather.temperature,
                weatherCode: response.current_weather.weathercode,
              },
            });
          });
    };

    const trailId = response.args.trailId;
    if (this.state.trail) {
      pin(this.state.trail);
    } else {
      fetchData('trail', {trail_id: trailId}).then(raw => {
        const trail = trailFromRaw(raw);
        this.updateState({
          ...this.state,
          trail,
        });

        pin(trail);
      });
    }

    if (!this.state.containingBoundaries) {
      fetchData('boundaries_containing_trail', {trail_id: trailId}).then(raw => {
        this.updateState({
          ...this.state,
          containingBoundaries: containingBoundariesFromRaw(raw),
        });
      });
    }

    if (!this.state.pathProfiles) {
      fetchData('path_profiles_in_trail', {trail_id: trailId}).then(raw => {
        this.updateState({
          ...this.state,
          pathProfiles: pathProfilesInTrailFromRaw(raw),
        });
      });
    }
  }

  updateState(newState: State) {
    // Yikes!
    if (!(this.state.pathProfiles && this.state.pinned && this.state.trail)
        && (newState.pathProfiles && newState.pinned && newState.trail)) {
      newState.elevation = calculateGraph(this.data, newState.pathProfiles, newState.trail);
    }
    super.updateState(newState);
  }

  moveElevationCursor(e: PointerEvent) {
    if (!this.state.elevation) {
      return;
    }

    const elevation = this.state.elevation;
    const bound = (e.currentTarget as Element).getBoundingClientRect();
    const fraction = (e.clientX - bound.x) / bound.width;
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

  selectionChanged(e: CorgiEvent<typeof SELECTION_CHANGED>): void {
    const {controller, clickPx, selected} = e.detail;

    let trails: Trail[];
    if (selected instanceof Path) {
      trails = controller.listTrailsOnPath(selected);
    } else if (selected instanceof Trail) {
      trails = [selected];
    } else {
      trails = [];
    }

    this.updateState({
      ...this.state,
      selectedCardPosition: clickPx,
      selectedTrails: trails,
    });
  }

  highlightTrail(): void {}
  unhighlightTrail(): void {}
}

export function calculateGraph(
    data: MapDataService,
    pathProfiles: Map<bigint, ElevationProfile>,
    trail: Trail): {
  extremes: [number, number];
  heights: string;
  points: LatLng[];
  resolution: Vec2;
} {
  const resolutionHeight = 300;
  const resolutionWidth = 1200;
  let min = Number.MAX_VALUE;
  let max = Number.MIN_VALUE;
  let length = 0;

  const heights: Vec2[] = [];
  const latLngs: LatLng[] = [];
  let lastPoint: S2Point|undefined = undefined;
  const process = (point: S2Point, sample: number) => {
    const ll = SimpleS2.pointToLatLng(point);
    latLngs.push([ll.latDegrees(), ll.lngDegrees()] as LatLng);
    heights.push([length, sample]);
    min = Math.min(min, sample);
    max = Math.max(max, sample);

    if (lastPoint != null) {
      length += angleToEarthMeters(lastPoint.angle(point));
    }
    lastPoint = point;
  };
  for (let i = 0; i < trail.paths.length; ++i) {
    const pathId = trail.paths[i];
    const path = data.pinnedPaths.get(pathId & ~1n);
    if (!path) {
      console.error(`Path ${pathId} is missing`);
      continue;
    }

    const profile = checkExists(pathProfiles.get(pathId & ~1n));
    const points = calculateSampleLocations(profile.granularityMeters, path.line);
    const samples = profile.samplesMeters;
    const offset = i === 0 ? 0 : 1;

    // I think there are some precision mismatches that can result in a different number of points
    if (samples.length === points.length + 1) {
      console.error(`Path ${pathId}'s points and samples don't match`);
      points.push(points[points.length - 1]);
    }

    if ((pathId & 1n) === 0n) {
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
  const inverseLength = resolutionWidth / length;
  const heightsString = heights.map(([x, y]) => {
    const fx = Math.floor(x * inverseLength);
    const fy = Math.floor((max - y) * inverseHeight);
    return `${fx},${fy}`;
  }).join(' ');
  return {
    extremes: [min, max],
    heights: heightsString,
    points: latLngs,
    resolution: [resolutionWidth, resolutionHeight],
  };
}

function calculateSampleLocations(
    granularityMeters: number, line: Float32Array|Float64Array): S2Point[] {
  const increment = earthMetersToAngle(granularityMeters);
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

// TODO(april): either make S2Earth J2CL compat or move these somewhere
function angleToEarthMeters(radians: number): number {
  return radians * 6371010.0;
}

function earthMetersToAngle(meters: number): number {
  return meters / 6371010.0;
}
