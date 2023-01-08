import { checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { FlatButton } from 'js/dino/button';
import { ACTION } from 'js/dino/events';
import { FabricIcon, FabricIconName } from 'js/dino/fabric';

import { formatDistance, formatHeight, formatTemperature, shouldUseImperial } from './common/formatters';
import { metersToFeet, metersToMiles } from './common/math';
import { formatWeatherCode } from './common/weather';
import { SELECTION_CHANGED } from './map/events';
import { MapElement } from './map/map_element';

import { BoundaryCrumbs } from './boundary_crumbs';
import { initialData, TrailId } from './data';
import { Header } from './page';
import { setTitle } from './title';
import { LoadingController, TrailDetailController, State } from './trail_detail_controller';
import { TrailPopup } from './trail_popup';
import { containingBoundariesFromRaw, pathProfilesInTrailFromRaw, trailFromRaw } from './trails';

const GRAPH_TEXT_SPACE_PX = [64, 32] as const;

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
      selectedCardPosition: [-1, -1],
      selectedTrails: [],
      trail,
    };
  }

  setTitle(state.trail?.name);

  return <>
    <div className="flex flex-col items-center min-h-full">
      <Header />

      {state.containingBoundaries && state.trail
          ? <Content trailId={trailId} state={state} updateState={updateState} />
          : <Loading trailId={trailId} state={state} updateState={updateState} />
      }
    </div>
  </>;
}

function Loading({trailId, state, updateState}: {
  trailId: TrailId,
  state: State,
  updateState: (newState: State) => void,
}) {
  return <>
    <div
        js={corgi.bind({
          controller: LoadingController,
          args: {trailId},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="h-full max-w-6xl px-4 my-8 w-full"
    >
      Loading...
    </div>
  </>;
}

function Content({trailId, state, updateState}: {
  trailId: TrailId,
  state: State,
  updateState: (newState: State) => void,
}) {
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

  return <>
    <div
        js={corgi.bind({
          controller: TrailDetailController,
          events: {
            corgi: [
              [SELECTION_CHANGED, 'selectionChanged'],
            ],
            render: 'wakeup',
          },
          key: JSON.stringify(trailId),
          state: [state, updateState],
        })}
        className="h-full max-w-6xl px-4 my-6 w-full"
    >
      <header className="font-bold font-sans text-3xl">
        {trail.name}
      </header>
      <aside className="flex gap-2 mt-2 text-tc-gray-400">
        <BoundaryCrumbs boundaries={containingBoundaries} />
        •
        <div>
          <a href={`https://www.openstreetmap.org/relation/${trail.sourceRelation}`}>
            <img
                alt="OpenStreetMap logo"
                className="h-[1em] inline-block mr-1"
                src="/static/images/icons/osm-logo.svg"
            />
            Relation {trail.sourceRelation}
          </a>
        </div>
      </aside>
      <div className="bg-tc-gray-100 h-0.5 mt-4 w-full" />
      <aside className="flex flex-wrap items-stretch mt-4">
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
      </aside>
      <div className="mt-8 relative">
        <MapElement
            active={{trails: [trail]}}
            camera={trail.bound}
            height="h-[32rem]"
            ref="map"
            overlays={{
              point: state.elevation?.cursor
            }}
        />
        <div className="absolute flex flex-col gap-2 right-2 top-2">
          <div unboundEvents={{corgi: [[ACTION, 'zoomToFit']]}}>
            <FlatButton ariaLabel="Zoom to trail" className="bg-white" icon="ZoomToFit" />
          </div>
          <div unboundEvents={{corgi: [[ACTION, 'browseMap']]}}>
            <FlatButton ariaLabel="Browse the map" className="bg-white" icon="ScaleVolume" />
          </div>
        </div>
        {trailDetails ?? <></>}
      </div>
      {state.elevation ? <ElevationGraph {...state} /> : <svg></svg>}
    </div>
  </>;
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
    <div className="min-w-[142px]">
      <div>{label}</div>
      <div className="mt-2">
        <FabricIcon name={icon} className="mr-2" />
        <span className="mr-0.5 text-lg">{value}</span>
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
  const trail = checkExists(state.trail);
  const elevation = checkExists(state.elevation);
  const [resWidth, resHeight] = elevation.resolution;

  // SVG has a flipped y coordinate, so we do everything negatively to flip properly. The controller
  // calculates points in a particular resolution, so we determine what elevations we want to show
  // and then transform the points into our frame.

  const [minMeters, maxMeters] = elevation.extremes;
  let length;
  let lengthUnit;
  let min;
  let max;
  if (shouldUseImperial()) {
    length = metersToMiles(trail.lengthMeters);
    lengthUnit = 'mi';
    min = metersToFeet(minMeters);
    max = metersToFeet(maxMeters);
  } else {
    length = trail.lengthMeters / 1000;
    lengthUnit = 'km';
    min = minMeters;
    max = maxMeters;
  }

  const gridEvery = Math.ceil((max - min) / 8 / 100) * 100;
  const gridLines = [];
  const gridText = [];
  const rawLowestGrid = (Math.floor(min / gridEvery) - 1) * gridEvery;
  // It's weird to show negative elevation values for trails that go to sea level.
  const lowestGrid = min >= 0 ? Math.max(0, rawLowestGrid) : rawLowestGrid;
  const highestGrid = (Math.ceil(max / gridEvery) + 1) * gridEvery;
  const height = 300;
  const scale = 300 / (highestGrid - lowestGrid);
  for (let y = lowestGrid; y <= highestGrid; y += gridEvery) {
    gridLines.push(<line x1="0" y1={-y * scale} x2={resWidth} y2={-y * scale} />);
    gridText.push(
        <text
            dominant_baseline="hanging"
            text_anchor="end"
            x="-8"
            y={-y * scale}
        >
          {y}
        </text>
    );
  }

  const indicateEvery = Math.ceil(length / 7 * 2) / 2;
  const distanceIndicators = [];
  for (let x = 0; x <= length; x += indicateEvery) {
    distanceIndicators.push(
        <text
            dominant_baseline="hanging"
            x={x / length * resWidth}
            y={-lowestGrid * scale + 8}
        >
          {x} {lengthUnit}
        </text>
    );
  }

  let indicator;
  if (elevation.cursorFraction !== undefined && elevation.cursorFraction >= 0) {
    const x = elevation.cursorFraction * resWidth;
    indicator = <line x1={x} y1={-lowestGrid * scale} x2={x} y2={-highestGrid * scale} />;
  } else {
    indicator = <line x1="0" y1="0" x2="0" y2="0" />;
  }

  return <>
    <svg
        className="select-none touch-none"
        unboundEvents={{
          'pointerleave': 'clearElevationCursor',
          'pointermove': 'moveElevationCursor',
        }}
        viewBox={
          [
            -GRAPH_TEXT_SPACE_PX[0],
            -highestGrid * scale,
            resWidth + GRAPH_TEXT_SPACE_PX[0],
            height + GRAPH_TEXT_SPACE_PX[1],
          ].join(' ')
        }>
      <g className="stroke-tc-gray-400">
        <g style="stroke-dasharray: 4">
          {gridLines}
        </g>
        {indicator}
      </g>
      <g className="fill-tc-gray-400">
        {gridText}
      </g>
      <g className="fill-black">
        {distanceIndicators}
      </g>
      <polyline
          fill="none"
          points={elevation.heights}
          stroke="black"
          stroke_width={2}
          vector_effect="non-scaling-stroke"
          style={
            [
              'transform:',
              `translateY(${-max * scale}px)`,
              `scaleY(${(max - min) / resHeight * scale})`,
            ].join(' ')
          }
      />
    </svg>
  </>;
}

