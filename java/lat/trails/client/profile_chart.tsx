import * as corgi from 'external/dev_april_corgi+/js/corgi';

import { formatDistance, formatHeight } from './measurements';

// In SVG units, which the chart scales to its container's width
const CHART_WIDTH = 300;
const CHART_HEIGHT = 140;
const PLOT_LEFT = 44;
const PLOT_RIGHT = CHART_WIDTH - 8;
const PLOT_TOP = 10;
const PLOT_BOTTOM = CHART_HEIGHT - 22;

/**
 * Draws elevation against distance. Source names whose samples the pointer is over, for the
 * controller's profileHovered.
 */
export function ProfileChart({distanceMeters, hovered, meters, source}: {
  distanceMeters: number[];
  hovered: number|undefined;
  meters: number[];
  source: 'line'|'measure';
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

  // A touch that the browser takes for a pan is canceled and leaves, so horizontal drags stay ours
  // and only vertical ones scroll the sidebar.
  return (
    <svg
        className="bg-slate-50 rounded touch-pan-y w-full"
        data={{left: PLOT_LEFT, right: PLOT_RIGHT, source, width: CHART_WIDTH}}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        unboundEvents={{
          pointerdown: 'profileHovered',
          pointerleave: 'profileLeft',
          pointermove: 'profileHovered',
        }}
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

/** A line dialog's profile, which has to load when the line carries no elevations of its own. */
export type LineProfileState =
    {status: 'loading'|'failed'}
    |{status: 'loaded'; distanceMeters: number[]; meters: number[]; hovered: number|undefined};

export function LineProfile({state}: {state: LineProfileState}) {
  if (state.status === 'loaded') {
    return (
      <ProfileChart
          distanceMeters={state.distanceMeters}
          hovered={state.hovered}
          meters={state.meters}
          source="line"
      />
    );
  }

  return (
    <div className="bg-gray-100 flex h-24 items-center justify-center rounded text-gray-500">
      {state.status === 'failed' ? 'Unable to load elevations' : 'Loading elevations...'}
    </div>
  );
}
