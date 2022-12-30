import { checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { FabricIcon, FabricIconName } from 'js/dino/fabric';

import { formatDistance, formatHeight, formatTemperature, shouldUseImperial } from './common/formatters';
import { metersToFeet } from './common/math';
import { formatWeatherCode } from './common/weather';
import { SELECTION_CHANGED } from './map/events';
import { MapElement } from './map/map_element';

import { BoundaryCrumbs } from './boundary_crumbs';
import { initialData, TrailId } from './data';
import { Header } from './page';
import { setTitle } from './title';
import { TrailDetailController, State } from './trail_detail_controller';
import { TrailPopup } from './trail_popup';
import { containingBoundariesFromRaw, pathProfilesInTrailFromRaw, trailFromRaw } from './trails';

export function TrailDetailElement({trailId}: {
  trailId: TrailId;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    const rawTrail = initialData('trail', {trail_id: trailId});
    let trail;
    if (rawTrail) {
      trail = trailFromRaw(rawTrail);
    }

    const rawContainingBoundaries = initialData('boundaries_containing_trail', {trail_id: trailId});
    let containingBoundaries;
    if (rawContainingBoundaries) {
      containingBoundaries = containingBoundariesFromRaw(rawContainingBoundaries);
    }

    const rawPathProfiles = initialData('path_profiles_in_trail', {trail_id: trailId});
    let pathProfiles;
    if (rawPathProfiles) {
      pathProfiles = pathProfilesInTrailFromRaw(rawPathProfiles);
    }

    state = {
      containingBoundaries,
      pathProfiles,
      pinned: false,
      selectedCardPosition: [-1, -1],
      selectedTrails: [],
      trail,
    };
  }

  setTitle(state.trail?.name);

  return <>
    <div className="flex flex-col h-full items-center">
      <Header />
      <div
          js={corgi.bind({
            controller: TrailDetailController,
            args: {trailId},
            events: {
              corgi: [
                [SELECTION_CHANGED, 'selectionChanged'],
              ],
              render: 'wakeup',
            },
            key: JSON.stringify(trailId),
            state: [state, updateState],
          })}
          className="h-full max-w-6xl px-4 my-8 w-full"
      >
        {state.containingBoundaries && state.trail
            ? <Content {...state} />
            : "Loading..."
        }
      </div>
    </div>
  </>;
}

function Content(state: State) {
  const containingBoundaries = checkExists(state.containingBoundaries);
  const trail = checkExists(state.trail);
  const distance = formatDistance(trail.lengthMeters);
  const elevationDown = formatHeight(trail.elevationDownMeters);
  const elevationUp = formatHeight(trail.elevationUpMeters);
  let elevationHigh;
  let elevationLow;
  if (state.elevation) {
    const [minMeters, maxMeters] = state.elevation.extremes;
    elevationHigh = formatHeight(maxMeters);
    elevationLow = formatHeight(minMeters);
  }
  let temperature;
  let weather;
  if (state.weather) {
    temperature = formatTemperature(state.weather.temperatureCelsius);
    const wc = formatWeatherCode(state.weather.weatherCode);
    weather = {
      icon: wc.icon,
      label: `${wc.label} • ${temperature.value}`,
    };
  }

  let isOneWay;
  if (trail.paths.length === 1) {
    isOneWay = true;
  } else {
    isOneWay = (trail.paths[0] & ~1n) !== (trail.paths[trail.paths.length - 1] & ~1n);
  }

  let trailDetails;
  if (state.selectedTrails.length > 0) {
    trailDetails =
        <TrailPopup
            position={state.selectedCardPosition}
            trails={state.selectedTrails}
        />;
  } else {
    trailDetails = <></>;
  }

  return [
    <header className="font-bold font-sans text-3xl">
      {trail.name}
    </header>,
    <aside>
      <BoundaryCrumbs boundaries={containingBoundaries} />
    </aside>,
    <div className="bg-tc-gray-100 h-0.5 my-4 w-full" />,
    <aside className="flex flex-wrap items-stretch">
      <NumericCrumb
          icon="CharticulatorLine"
          label={isOneWay ? "One-way distance" : "Round-trip distance"}
          value={distance.value}
          unit={distance.unit}
      />
      <NumericDivider />
      <NumericCrumb
          icon="Market"
          label="Ascent"
          value={elevationUp.value}
          unit={elevationUp.unit}
      />
      <NumericDivider />
      <NumericCrumb
          icon="MarketDown"
          label="Descent"
          value={elevationDown.value}
          unit={elevationDown.unit}
      />
      <NumericDivider />
      <NumericCrumb
          icon="SortUp"
          label="Highest point"
          value={elevationHigh?.value ?? ''}
          unit={elevationHigh?.unit ?? ''}
      />
      <NumericDivider />
      <NumericCrumb
          icon="SortDown"
          label="Lowest point"
          value={elevationLow?.value ?? ''}
          unit={elevationLow?.unit ?? ''}
      />
      <NumericDivider />
      <NumericCrumb
          icon={weather?.icon ?? 'Checkbox'}
          label="Current weather"
          value={weather?.label ?? ''}
          unit={temperature?.unit ?? ''}
      />
    </aside>,
    <div className="relative">
      <MapElement
          active={{trails: [trail]}}
          camera={trail.bound}
          className="my-8"
          height="h-[32rem]"
          overlays={{point: state.elevation?.cursor}}
      />
      {trailDetails ?? <></>}
    </div>,
    state.elevation ? <ElevationGraph {...state} /> : <svg></svg>,
  ];
}

function NumericCrumb({
  icon,
  label,
  value,
  unit,
}: {
  icon: FabricIconName,
  label: corgi.VElementOrPrimitive,
  value: string,
  unit: string,
}) {
  return <>
    <div className="min-w-[192px]">
      <div>{label}</div>
      <div>
        <FabricIcon name={icon} />
        {' '}
        <span className="text-lg">{value}</span>
        {' '}
        <span className="text-sm">{unit}</span>
      </div>
    </div>
  </>;
}

function NumericDivider() {
  return <>
    <div className="bg-tc-gray-100 mx-2 w-0.5"></div>
  </>;
}

function ElevationGraph(state: State) {
  const elevation = checkExists(state.elevation);
  const [width, height] = elevation.resolution;

  const [minMeters, maxMeters] = elevation.extremes;
  let min;
  let max;
  if (shouldUseImperial()) {
    min = metersToFeet(minMeters);
    max = metersToFeet(maxMeters);
  } else {
    min = minMeters;
    max = maxMeters;
  }
  const gridEvery = Math.ceil((max - min) / 8 / 100) * 100;
  const gridLines = [];
  const gridText = [];
  const lowestGrid = Math.floor((min + gridEvery - 1) / gridEvery) * gridEvery;
  const highestGrid = Math.floor(max / gridEvery) * gridEvery;
  const scale = height / (max - min);
  for (let y = lowestGrid; y <= highestGrid; y += gridEvery) {
    const ry = height - scale * (y - min);
    gridLines.push(<line x1="0" y1={ry} x2={width} y2={ry} />);
    gridText.push(<text x="0" y={ry}>{y}</text>);
  }

  let indicator;
  if (elevation.cursorFraction !== undefined) {
    const x = elevation.cursorFraction * width;
    indicator = <line x1={x} y1="0" x2={x} y2={height} />;
  } else {
    indicator = <line x1="0" y1="0" x2="0" y2="0" />;
  }

  return <>
    <svg
        unboundEvents={{
          'pointermove': 'moveElevationCursor',
        }}
        viewBox={`0 0 ${width} ${height}`}>
      <g className="stroke-gray-300">
        <g style="stroke-dasharray: 8">
          {gridLines}
        </g>
        {gridText}
        {indicator}
      </g>
      <polyline fill="none" points={elevation.heights} stroke="black" stroke_width="2" />
    </svg>
  </>;
}

