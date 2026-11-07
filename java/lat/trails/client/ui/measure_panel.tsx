import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { VElementOrPrimitive } from 'external/dev_april_corgi+/js/corgi';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { PanelButton, PanelCloseButton, PrimaryButton } from 'js/pika/buttons';

import { RouteStatus } from '../tools/drawing_layer';
import {
  formatArea,
  formatDistance,
  formatHeight,
  pathLengthMeters,
  profileStats,
  ringAreaMeters2,
} from '../tools/measurements';
import { LineStats } from './feature_list';
import { LineProfile, LineProfileState } from './profile_chart';

export interface MeasureState {
  lengthMeters: number;
  vertexCount: number;
  profile: LineProfileState|undefined;
  // Set while routing over terrain
  route: RouteStatus|undefined;
}

/** The steepest grades the terrain router may take, in percent. */
export interface GradeLimitState {
  climbPercent: number;
  descentPercent: number;
}

/**
 * Floats over the map while drawing a line, measuring, or routing over terrain, showing the length
 * and elevation of what is drawn.
 */
export function MeasurePanel({grades, readOnly, state, tool}: {
  grades: GradeLimitState;
  readOnly: boolean;
  state: MeasureState;
  tool: 'line'|'measure'|'terrain';
}) {
  const icon =
      tool === 'line' ? <LineIcon /> : tool === 'terrain' ? <TerrainIcon /> : <MeasureIcon />;
  return (
    <ToolPanel
        icon={icon}
        title={tool === 'line' ? 'Draw a line' : tool === 'terrain' ? 'Route off trail' : 'Measure'}
    >
      {tool === 'terrain' ? <GradeLimits grades={grades} /> : ''}
      {state.route ? <RouteReadout status={state.route} /> : ''}
      {state.vertexCount < 2
          ? <ClickHint />
          : <Readout readOnly={readOnly} state={state} tool={tool} />
      }
    </ToolPanel>
  );
}

/** Floats over the map while drawing an area, showing how much it encloses so far. */
export function AreaPanel({ring}: {
  // The placed vertices and the paths between them as interleaved lat then lng degrees
  ring: Float64Array;
}) {
  // The perimeter runs back to the first vertex.
  const perimeter = pathLengthMeters([...ring, ring[0], ring[1]]);
  return (
    <ToolPanel icon={<AreaIcon />} title="Draw an area">
      {ring.length < 6
          ? <ClickHint />
          : <div className="flex flex-col gap-2">
              <div className="text-gray-700">
                {`${formatArea(ringAreaMeters2(ring))}, ${formatDistance(perimeter)} perimeter`}
              </div>
              <PrimaryButton
                  className="self-start"
                  unboundEvents={{corgi: [[ACTION, 'finishDrawingClicked']]}}
              >
                Finish area
              </PrimaryButton>
            </div>
      }
    </ToolPanel>
  );
}

function ToolPanel({children, icon, title}: {
  children?: VElementOrPrimitive|VElementOrPrimitive[];
  icon: VElementOrPrimitive;
  title: string;
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
        <svg className="fill-current h-5 stroke-current w-5" viewBox="0 0 20 20">
          {icon}
        </svg>
        <span className="font-bold grow">{title}</span>
        <PanelButton
            label="Undo last point"
            unboundEvents={{corgi: [[ACTION, 'undoPointClicked']]}}
        >
          <path d="M7 4 L3 8 L7 12 M3 8 H12 A4 4 0 0 1 12 16 H9" strokeWidth="1.5" />
        </PanelButton>
        <PanelCloseButton unboundEvents={{corgi: [[ACTION, 'toolPanelClosed']]}} />
      </div>
      {children ?? []}
    </div>
  );
}

function ClickHint() {
  return <p className="text-gray-600">Click points on the map</p>;
}

export function LineIcon() {
  return <>
    <polyline
        fill="none"
        points="3,15 8,6 12,11 17,4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
    />
    <circle cx="3" cy="15" r="1.5" />
    <circle cx="8" cy="6" r="1.5" />
    <circle cx="12" cy="11" r="1.5" />
    <circle cx="17" cy="4" r="1.5" />
  </>;
}

export function AreaIcon() {
  return <>
    <polygon fill="none" points="4,5 14,3 17,13 7,16" strokeLinejoin="round" strokeWidth="1.5" />
    <circle cx="4" cy="5" r="1.5" />
    <circle cx="14" cy="3" r="1.5" />
    <circle cx="17" cy="13" r="1.5" />
    <circle cx="7" cy="16" r="1.5" />
  </>;
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

function Readout({readOnly, state, tool}: {
  readOnly: boolean;
  state: MeasureState;
  tool: 'line'|'measure'|'terrain';
}) {
  const profile: LineProfileState = state.profile ?? {status: 'loading'};
  const stats = profile.status === 'loaded' ? profileStats(profile.meters) : undefined;
  return (
    <div className="flex flex-col gap-2">
      <LineStats lengthMeters={state.lengthMeters} climb={stats} />
      <LineProfile source="measure" state={profile} />
      {stats
          ? <div className="text-gray-700">
              {`Min ${formatHeight(stats.minMeters)}, `
                  + `median ${formatHeight(stats.medianMeters)}, `
                  + `max ${formatHeight(stats.maxMeters)}`}
            </div>
          : ''
      }
      {tool === 'line'
          ? <PrimaryButton
                className="self-start"
                unboundEvents={{corgi: [[ACTION, 'finishDrawingClicked']]}}
            >
              Finish line
            </PrimaryButton>
          : readOnly
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
