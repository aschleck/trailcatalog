import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Button } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { formatDistance, formatHeight, ProfileStats } from './measurements';

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

// In SVG units, which the chart scales to the panel's width
const CHART_WIDTH = 300;
const CHART_HEIGHT = 140;
const PLOT_LEFT = 44;
const PLOT_RIGHT = CHART_WIDTH - 8;
const PLOT_TOP = 10;
const PLOT_BOTTOM = CHART_HEIGHT - 22;

/** Floats over the map while measuring, showing the length and elevation of what is drawn. */
export function MeasurePanel({state}: {state: MeasureState}) {
  return (
    <div className="
        absolute
        bg-white
        flex
        flex-col
        gap-2
        p-3
        right-2
        rounded
        shadow-lg
        text-gray-900
        text-sm
        top-2
        w-80
        z-10
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
      <div>
        <div className="text-gray-600">Length</div>
        <div className="text-base">{formatDistance(state.lengthMeters)}</div>
      </div>
      <div className="text-gray-600">Elevation profile</div>
      {profile
          ? <Chart
                distanceMeters={profile.distanceMeters}
                hovered={state.hovered}
                meters={profile.meters}
            />
          : <div
                className="bg-gray-100 flex h-24 items-center justify-center rounded text-gray-500"
            >
              {state.status === 'failed' ? 'Unable to load elevations' : 'Loading elevations...'}
            </div>
      }
      {profile
          ? <div className="grid grid-cols-2 gap-x-2 text-gray-700">
              <span>{`Climb ${formatHeight(profile.stats.upMeters)}`}</span>
              <span>{`Descent ${formatHeight(profile.stats.downMeters)}`}</span>
              <span className="col-span-2">
                {`Min ${formatHeight(profile.stats.minMeters)}, `
                    + `median ${formatHeight(profile.stats.medianMeters)}, `
                    + `max ${formatHeight(profile.stats.maxMeters)}`}
              </span>
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

function Chart({distanceMeters, hovered, meters}: {
  distanceMeters: number[];
  hovered: number|undefined;
  meters: number[];
}) {
  const total = distanceMeters[distanceMeters.length - 1] || 1;
  let low = Math.min(...meters);
  let high = Math.max(...meters);
  // A flat profile would divide by zero, so it gets a few meters of room.
  if (high - low < 10) {
    low -= 5;
    high += 5;
  }

  const x = (d: number) => PLOT_LEFT + (PLOT_RIGHT - PLOT_LEFT) * d / total;
  const y = (m: number) => PLOT_BOTTOM - (PLOT_BOTTOM - PLOT_TOP) * (m - low) / (high - low);
  let line = '';
  for (let i = 0; i < meters.length; ++i) {
    line += `${i === 0 ? 'M' : 'L'}${x(distanceMeters[i]).toFixed(1)} ${y(meters[i]).toFixed(1)} `;
  }
  const area = `${line}L${PLOT_RIGHT} ${PLOT_BOTTOM} L${PLOT_LEFT} ${PLOT_BOTTOM} Z`;

  return (
    <svg
        className="bg-slate-50 rounded w-full"
        data={{left: PLOT_LEFT, right: PLOT_RIGHT, width: CHART_WIDTH}}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        unboundEvents={{pointerleave: 'profileLeft', pointermove: 'profileHovered'}}
    >
      <path d={area} fill="#93c5fd" fillOpacity="0.5" />
      <path d={line} fill="none" stroke="#1d4ed8" strokeWidth="1.5" />
      <path
          d={`M${PLOT_LEFT} ${PLOT_TOP} H${PLOT_RIGHT} M${PLOT_LEFT} ${PLOT_BOTTOM} H${PLOT_RIGHT}`}
          stroke="#cbd5e1"
          strokeWidth="1"
      />
      {hovered !== undefined
          ? <Hover
                x={x(distanceMeters[hovered])}
                y={y(meters[hovered])}
                label={formatHeight(meters[hovered])}
            />
          : ''
      }
      <text className="fill-gray-600 text-[10px]" x="2" y={PLOT_TOP + 4}>
        {formatHeight(high)}
      </text>
      <text className="fill-gray-600 text-[10px]" x="2" y={PLOT_BOTTOM + 4}>
        {formatHeight(low)}
      </text>
      <text className="fill-gray-600 text-[10px]" x={PLOT_LEFT} y={CHART_HEIGHT - 6}>0</text>
      <text
          className="fill-gray-600 text-[10px]"
          textAnchor="middle"
          x={(PLOT_LEFT + PLOT_RIGHT) / 2}
          y={CHART_HEIGHT - 6}
      >
        {formatDistance(total / 2)}
      </text>
      <text
          className="fill-gray-600 text-[10px]"
          textAnchor="end"
          x={PLOT_RIGHT}
          y={CHART_HEIGHT - 6}
      >
        {formatDistance(total)}
      </text>
    </svg>
  );
}

// A line down to the axis, a dot on the profile, and the elevation in a box above it, kept inside
// the plot at either edge.
function Hover({label, x, y}: {label: string; x: number; y: number}) {
  const width = 8 + 6 * label.length;
  const left = Math.min(Math.max(x - width / 2, PLOT_LEFT), PLOT_RIGHT - width);
  const top = Math.max(y - 26, 0);
  return (
    <g>
      <path d={`M${x} ${y} V${PLOT_BOTTOM}`} stroke="#1d4ed8" strokeWidth="1.5" />
      <circle cx={x} cy={y} fill="#1d4ed8" r="4" stroke="white" strokeWidth="1.5" />
      <rect fill="#1f2937" height="16" rx="3" width={width} x={left} y={top} />
      <text
          className="fill-white text-[10px]"
          textAnchor="middle"
          x={left + width / 2}
          y={top + 11}
      >
        {label}
      </text>
    </g>
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
