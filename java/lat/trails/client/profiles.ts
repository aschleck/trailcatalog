import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';

import { Elevations } from 'js/map/workers/elevations';

import { RouteStatus } from './drawing_layer';
import { EditableLine } from './features';
import { MeasureState } from './measure_panel';
import { cumulativeMeters, pathLengthMeters, profileSamples, slopeMeters } from './measurements';
import { LineProfileState } from './profile_chart';

type LoadedProfile = Extract<LineProfileState, {status: 'loaded'}>;

/** The samples behind a profile on screen, so hovering it can find the spot on the map. */
export interface ShownSamples {
  // Interleaved lat then lng, in degrees
  latLngDegrees: Float64Array;
  distanceMeters: Float64Array;
}

/** Keeps the measure and terrain tools' length and elevation profile in step with the drawing. */
export class MeasureProfiler {

  // Waits for the pointer to settle before sampling, because the measure tool redraws its cursor
  // segment on every move and each profile fetches tiles.
  private readonly debouncer: Debouncer;
  private _samples: ShownSamples|undefined;
  // Moves with every profile asked for, so that a slow answer for an old drawing is dropped
  private generation: number;
  // The placed path the length and profile describe
  private measured: Float64Array|undefined;

  constructor(
      private readonly elevations: Elevations,
      // The placed part of the measurement as interleaved lat then lng degrees. The segment to the
      // cursor is left out, because the numbers are about what was clicked.
      private readonly path: () => Float64Array,
      private readonly current: () => MeasureState,
      private readonly show: (measure: MeasureState) => void) {
    this.debouncer = new Debouncer(/* delayMs= */ 150, () => {
      this.sample();
    });
    this._samples = undefined;
    this.generation = 0;
    this.measured = undefined;
  }

  get samples(): ShownSamples|undefined {
    return this._samples;
  }

  // Updates the length now, because it is cheap, and the profile once the pointer settles. The
  // drawing changes on every pointer move, and most moves leave the placed part alone.
  changed(route: RouteStatus|undefined): void {
    const shown = this.current().route;
    if (
        route?.routing !== shown?.routing
            || route?.unroutable !== shown?.unroutable
            || route?.failed !== shown?.failed) {
      this.show({...this.current(), route});
    }

    const path = this.path();
    const measured = this.measured;
    if (measured && measured.length === path.length && measured.every((v, i) => v === path[i])) {
      return;
    }
    this.measured = path;
    const lengthMeters = pathLengthMeters(path);
    const vertexCount = path.length / 2;
    this.show({
      ...this.current(),
      lengthMeters,
      vertexCount,
    });
    if (vertexCount >= 2) {
      this.debouncer.trigger();
    } else {
      this.generation += 1;
      this._samples = undefined;
      this.show({lengthMeters, vertexCount, profile: undefined, route});
    }
  }

  // Leaves the last profile up while the next one loads, because each placed point would
  // otherwise blink the chart out.
  private sample(): void {
    const path = this.path();
    if (path.length < 4) {
      return;
    }

    this.generation += 1;
    const generation = this.generation;
    if (this.current().profile?.status !== 'loaded') {
      this.show({...this.current(), profile: {status: 'loading'}});
    }
    sampleDem(this.elevations, path).then(
        ({samples, profile}) => {
          if (generation !== this.generation) {
            return;
          }

          this._samples = samples;
          const distanceMeters = samples.distanceMeters;
          this.show({
            ...this.current(),
            lengthMeters: distanceMeters[distanceMeters.length - 1],
            profile,
          });
        },
        e => {
          console.error(e);
          if (generation === this.generation) {
            this._samples = undefined;
            this.show({...this.current(), profile: {status: 'failed'}});
          }
        });
  }
}

/** Draws the elevation profile of the selected line or the inspected map object. */
export class LineProfiler {

  private _samples: ShownSamples|undefined;
  // Moves with every line profile asked for, so that a slow answer for another line is dropped
  private generation: number;
  // The selected line's arrays as of its profile, which an edit replaces with new ones
  private source: {
    latLngE7: Int32Array;
    elevationCentimeters: Int32Array|undefined;
  }|undefined;

  constructor(
      private readonly elevations: Elevations,
      private readonly current: () => LineProfileState|undefined,
      private readonly show: (profile: LineProfileState) => void) {
    this._samples = undefined;
    this.generation = 0;
    this.source = undefined;
  }

  get samples(): ShownSamples|undefined {
    return this._samples;
  }

  // Drops the selected line's profile, including one still loading.
  forget(): void {
    this.generation += 1;
    this.source = undefined;
    this._samples = undefined;
  }

  // Keeps the selected line's profile in step with its geometry. A line that carries elevations,
  // like an imported track, draws its own so that the chart agrees with the climb above it, and
  // anything else samples the DEM.
  forLine(live: EditableLine): LineProfileState|undefined {
    if (
        live.latLngE7 === this.source?.latLngE7
            && live.elevationCentimeters === this.source.elevationCentimeters) {
      return this.current();
    }

    this.generation += 1;
    this.source = {
      latLngE7: live.latLngE7,
      elevationCentimeters: live.elevationCentimeters,
    };
    const path = Float64Array.from(live.latLngE7, e7 => e7 / 1e7);
    const own = live.elevationCentimeters;
    if (own) {
      const {samples, profile} =
          profileOf(path, cumulativeMeters(path), Array.from(own, cm => cm / 100));
      this._samples = samples;
      return profile;
    }
    return this.sample(path);
  }

  // Samples the DEM, since an object from a map layer has no elevations. Selecting anything
  // forgets the profile, so an answer for an object that has closed is dropped.
  forObject(path: Float64Array): void {
    this.generation += 1;
    this.source = undefined;
    this.show(this.sample(path));
  }

  private sample(path: Float64Array): LineProfileState {
    const generation = this.generation;
    this._samples = undefined;
    sampleDem(this.elevations, path).then(
        ({samples, profile}) => {
          if (generation !== this.generation) {
            return;
          }

          this._samples = samples;
          this.show(profile);
        },
        e => {
          console.error(e);
          if (generation === this.generation) {
            this.show({status: 'failed'});
          }
        });
    return {status: 'loading'};
  }
}

function sampleDem(elevations: Elevations, path: Float64Array):
    Promise<{samples: ShownSamples; profile: LoadedProfile}> {
  const samples = profileSamples(path);
  return elevations.sample(samples.latLngDegrees, samples.zoom)
      .then(meters => profileOf(samples.latLngDegrees, samples.distanceMeters, meters));
}

// Measures the samples' distances along the slope, so that the chart's length agrees with the
// climb.
function profileOf(
    latLngDegrees: Float64Array, groundMeters: ArrayLike<number>, meters: ArrayLike<number>):
    {samples: ShownSamples; profile: LoadedProfile} {
  const distanceMeters = slopeMeters(groundMeters, meters);
  return {
    samples: {latLngDegrees, distanceMeters},
    profile: {
      status: 'loaded',
      distanceMeters: Array.from(distanceMeters),
      meters: Array.from(meters),
      hovered: undefined,
    },
  };
}
