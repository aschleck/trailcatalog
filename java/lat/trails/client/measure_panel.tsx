import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { PanelButton, PanelCloseButton, PrimaryButton } from 'js/pika/buttons';

import { RouteStatus } from './drawing_layer';
import { LineStats } from './feature_list';
import { formatHeight, ProfileStats } from './measurements';
import { ProfileChart } from './profile_chart';

export interface MeasureState {
  lengthMeters: number;
  vertexCount: number;
  profile: {
    distanceMeters: number[];
    meters: number[];
    stats: ProfileStats;
  }|undefined;
  // The profile sample under the pointer
  hovered: number|undefined;
  status: 'idle'|'loading'|'failed';
  // Set while routing over terrain
  route: RouteStatus|undefined;
}

/** The steepest grades the terrain router may take, in percent. */
export interface GradeLimitState {
  climbPercent: number;
  descentPercent: number;
}

/**
 * Floats over the map while measuring, showing the length and elevation of what is drawn. Given
 * grades, it measures a route over terrain and lets them be changed.
 */
export function MeasurePanel({grades, readOnly, state}: {
  grades: GradeLimitState|undefined;
  readOnly: boolean;
  state: MeasureState;
}) {
  return (
    <div className="
        bg-white
        flex
        flex-col
        gap-2
        p-3
        pointer-events-auto
        rounded
        shadow-lg
        shrink-0
        text-gray-900
        text-sm
    ">
      <div className="flex gap-2 items-center">
        <svg className="h-5 stroke-current w-5" viewBox="0 0 20 20">
          {grades ? <TerrainIcon /> : <MeasureIcon />}
        </svg>
        <span className="font-bold grow">{grades ? 'Route off trail' : 'Measure'}</span>
        <PanelButton
            label="Undo last point"
            unboundEvents={{corgi: [[ACTION, 'measureUndoClicked']]}}
        >
          <path d="M7 4 L3 8 L7 12 M3 8 H12 A4 4 0 0 1 12 16 H9" strokeWidth="1.5" />
        </PanelButton>
        <PanelCloseButton unboundEvents={{corgi: [[ACTION, 'measureClosed']]}} />
      </div>
      {grades ? <GradeLimits grades={grades} /> : ''}
      {state.route ? <RouteReadout status={state.route} /> : ''}
      {state.vertexCount < 2
          ? <p className="text-gray-600">
              Click points on the map
            </p>
          : <Readout readOnly={readOnly} state={state} />
      }
    </div>
  );
}

export function MeasureIcon() {
  return (
    <g transform="rotate(-45 10 10)">
      <rect fill="none" height="8" rx="1" strokeWidth="1.5" width="16" x="2" y="6" />
      <path d="M6 6 V9 M10 6 V10 M14 6 V9" fill="none" strokeWidth="1.5" />
    </g>
  );
}

// A peak with a path switching back up it
export function TerrainIcon() {
  return (
    <g fill="none" strokeLinejoin="round">
      <path d="M1 17 L8 5 L11 10 L13 7 L19 17 Z" strokeWidth="1.5" />
      <path d="M6 15 L11 13 L8 11 L10 9" strokeDasharray="1.5 1.5" strokeWidth="1" />
    </g>
  );
}

function GradeLimits({grades}: {grades: GradeLimitState}) {
  return (
    <div className="flex gap-3 items-center whitespace-nowrap">
      <span className="text-gray-700">Max grade</span>
      <GradeInput action="maxClimbChanged" label="Up" percent={grades.climbPercent} />
      <GradeInput action="maxDescentChanged" label="Down" percent={grades.descentPercent} />
    </div>
  );
}

function GradeInput({action, label, percent}: {action: string; label: string; percent: number}) {
  return (
    <label className="flex gap-1 items-center">
      <span className="text-gray-700">{label}</span>
      <input
          ariaLabel={`Max grade ${label.toLowerCase()} in percent`}
          className="border border-gray-300 px-1 rounded w-14"
          min="1"
          step="1"
          type="number"
          value={String(percent)}
          unboundEvents={{change: action}}
      />
      <span className="text-gray-700">%</span>
    </label>
  );
}

function RouteReadout({status}: {status: RouteStatus}) {
  const message =
      status.routing > 0
          ? 'Finding a route...'
          : status.failed > 0
              ? 'Unable to load elevations for the route'
              : status.unroutable > 0
                  ? status.unroutable === 1
                      ? 'Unable to auto-route this segment'
                      : `Unable to auto-route these ${status.unroutable} segments`
                  : '';
  return message ? <p className="text-gray-600">{message}</p> : '';
}

function Readout({readOnly, state}: {readOnly: boolean; state: MeasureState}) {
  const profile = state.profile;
  return (
    <div className="flex flex-col gap-2">
      <LineStats lengthMeters={state.lengthMeters} climb={profile?.stats} />
      {profile
          ? <ProfileChart
                distanceMeters={profile.distanceMeters}
                hovered={state.hovered}
                meters={profile.meters}
                source="measure"
            />
          : <div
                className="bg-gray-100 flex h-24 items-center justify-center rounded text-gray-500"
            >
              {state.status === 'failed' ? 'Unable to load elevations' : 'Loading elevations...'}
            </div>
      }
      {profile
          ? <div className="text-gray-700">
              {`Min ${formatHeight(profile.stats.minMeters)}, `
                  + `median ${formatHeight(profile.stats.medianMeters)}, `
                  + `max ${formatHeight(profile.stats.maxMeters)}`}
            </div>
          : ''
      }
      {readOnly
          ? ''
          : <PrimaryButton
                className="self-start"
                unboundEvents={{corgi: [[ACTION, 'saveMeasurementClicked']]}}
            >
              Save as line
            </PrimaryButton>
      }
    </div>
  );
}
