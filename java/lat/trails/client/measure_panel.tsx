import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

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
}

/** Floats over the map while measuring, showing the length and elevation of what is drawn. */
export function MeasurePanel({state}: {state: MeasureState}) {
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
          <g transform="rotate(-45 10 10)">
            <rect fill="none" height="8" rx="1" strokeWidth="1.5" width="16" x="2" y="6" />
            <path d="M6 6 V9 M10 6 V10 M14 6 V9" fill="none" strokeWidth="1.5" />
          </g>
        </svg>
        <span className="font-bold grow">Measure</span>
        <IconButton label="Undo last point" onAction="measureUndoClicked">
          <path d="M7 5 L3 9 L7 13 M3 9 H12 A4 4 0 0 1 12 17 H9" fill="none" strokeWidth="1.5" />
        </IconButton>
        <IconButton label="Close" onAction="measureClosed">
          <path d="M5 5 L15 15 M5 15 L15 5" strokeWidth="1.5" />
        </IconButton>
      </div>
      {state.vertexCount < 2
          ? <p className="text-gray-600">
              Click points on the map
            </p>
          : <Readout state={state} />
      }
    </div>
  );
}

function Readout({state}: {state: MeasureState}) {
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
      <Button
          className="bg-gray-900 hover:bg-gray-700 px-3 py-1 rounded self-start text-white"
          unboundEvents={{corgi: [[ACTION, 'saveMeasurementClicked']]}}
      >
        Save as line
      </Button>
    </div>
  );
}

function IconButton({children, label, onAction}: {
  children?: corgi.VElementOrPrimitive|corgi.VElementOrPrimitive[];
  label: string;
  onAction: string;
}) {
  return (
    <Button
        ariaLabel={label}
        className="hover:bg-black/10 p-1 rounded"
        title={label}
        unboundEvents={{corgi: [[ACTION, onAction]]}}
    >
      <svg className="h-5 stroke-current w-5" viewBox="0 0 20 20">
        {children ?? []}
      </svg>
    </Button>
  );
}
