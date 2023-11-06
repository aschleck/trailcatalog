import { checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { FlatButton, OutlinedButton } from 'js/dino/button';
import { FabricIcon, FabricIconName } from 'js/dino/fabric';
import { ACTION } from 'js/emu/events';
import { LatLng } from 'js/map/common/types';
import { CLICKED, ZOOMED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';

import { formatDistance, formatHeight, formatTemperature, shouldUseImperial } from './common/formatters';
import { metersToFeet, metersToMiles } from './common/math';
import { formatWeatherCode } from './common/weather';
import { SELECTION_CHANGED } from './map/events';

import { BoundaryCrumbs } from './boundary_crumbs';
import { initialData } from './data';
import { Header } from './page';
import { setTitle } from './title';
import { LoadingController, TrailDetailController, State } from './trail_detail_controller';
import { TrailPopup } from './trail_popup';
import { containingBoundariesFromRaw, pathProfilesInTrailFromRaw, trailFromRaw } from './trails';

const GRAPH_TEXT_SPACE_PX = [0, 32] as const;

export function TrailDetailElement({trailId, parameters}: {
  trailId: string;
  parameters: {[key: string]: string};
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state || trailId !== state.trailId) {
    const wrapped = {readable: trailId};
    const rawTrail = initialData('trail', {trail_id: wrapped});
    let trail;
    if (rawTrail) {
      trail = trailFromRaw(rawTrail);
    }

    const rawEpoch = initialData('epoch', {});

    const rawContainingBoundaries = initialData('boundaries_containing_trail', {trail_id: wrapped});
    let containingBoundaries;
    if (rawContainingBoundaries) {
      containingBoundaries = containingBoundariesFromRaw(rawContainingBoundaries);
    }

    const rawPathProfiles = initialData('path_profiles_in_trail', {trail_id: wrapped});
    let pathProfiles;
    if (rawPathProfiles) {
      pathProfiles = pathProfilesInTrailFromRaw(rawPathProfiles);
    }

    state = {
      containingBoundaries,
      epochDate: rawEpoch ? new Date(rawEpoch.timestampS * 1000) : undefined,
      pathProfiles,
      selected: [],
      selectedCardPosition: [-1, -1],
      trail,
      trailId,
    };
  }

  setTitle(state.trail?.name);

  return <>
    <div className="flex flex-col h-full">
      <Header />

      {state.containingBoundaries && state.trail
          ? <Content trailId={trailId} state={state} updateState={updateState} />
          : <Loading trailId={trailId} state={state} updateState={updateState} />
      }
    </div>
  </>;
}

function Loading({trailId, state, updateState}: {
  trailId: string,
  state: State,
  updateState: (newState: State) => void,
}) {
  return <>
    <div
        js={corgi.bind({
          controller: LoadingController,
          key: JSON.stringify(trailId),
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
  trailId: string,
  state: State,
  updateState: (newState: State) => void,
}) {
  const trail = checkExists(state.trail);
  let trailDetails;
  if (state.selected.length > 0) {
    trailDetails =
        <TrailPopup
            items={state.selected}
            position={state.selectedCardPosition}
        />;
  } else {
    trailDetails = <></>;
  }

  return <>
    <div
        js={corgi.bind({
          controller: TrailDetailController,
          key: JSON.stringify(trailId),
          args: {
            active: {trails: [trail]},
            overlays: {
              bear:
                  !!state.elevation?.cursor
                      ? [state.elevation.cursor.lat, state.elevation.cursor.lng] as LatLng
                      : undefined,
            },
          },
          events: {
            corgi: [
              [CLICKED, 'selectionChanged'],
              [SELECTION_CHANGED, 'selectionChanged'],
              [ZOOMED, 'selectionChanged'],
            ],
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="flex grow overflow-hidden"
    >
      <TrailSidebar state={state} />
      <div className="grow h-full relative">
        <MapElement camera={trail.bound} ref="map" />
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
    </div>
  </>;
}

function TrailSidebar({state}: {state: State}) {
  const containingBoundaries = checkExists(state.containingBoundaries);
  const trail = checkExists(state.trail);
  const valid = trail.lengthMeters >= 0;
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

  const badData =
      <span
          className="
              bg-tc-error-100
              inline-block
              px-3
              py-1
              rounded
              text-tc-error-500
          ">
        OSM data issue
      </span>;

  return <>
    <div className="overflow-y-scroll p-4 text-sm md:w-[32rem]">
      <header className="flex gap-2 items-center">
        <span className="font-bold font-sans text-3xl">
          {trail.name}
        </span>
      </header>
      <aside className="flex flex-wrap gap-2 items-center mt-2 text-tc-gray-400">
        <div className="text-black" unboundEvents={{corgi: [[ACTION, 'browseMap']]}}>
          <OutlinedButton dense={true} icon="Nav2DMapView" label="Browse map" />
        </div>
        <BoundaryCrumbs boundaries={containingBoundaries} />
      </aside>
      <div className="border gap-x-8 gap-y-2 grid p-2 mt-4 [grid-template-columns:_auto_1fr]">
        <div>{isOneWay ? "One-way distance" : "Round-trip distance"}</div>
        <div>
          {valid
              ? <>
                  <FabricIcon name="CharticulatorLine" className="mr-2" />
                  <NumericCrumb value={distance.value} unit={distance.unit} />
                </>
              : badData
          }
        </div>
        <div className="border-b col-span-2 -mx-2"></div>
        <div>Gain and loss</div>
        <div>
          {valid
              ? <>
                  <FabricIcon name="Market" className="mr-2" />
                  <NumericCrumb value={elevationUp.value} unit={elevationUp.unit} />
                  <FabricIcon name="MarketDown" className="ml-4 mr-2" />
                  <NumericCrumb value={elevationDown.value} unit={elevationDown.unit} />
                </>
              : badData
          }
        </div>
        <div className="border-b col-span-2 -mx-2"></div>
        <div>Highest and lowest</div>
        <div>
          <FabricIcon name="SortUp" className="mr-2" />
          <NumericCrumb value={elevationHigh?.value ?? ''} unit={elevationHigh?.unit ?? ''} />
          <FabricIcon name="SortDown" className="ml-4 mr-2" />
          <NumericCrumb value={elevationLow?.value ?? ''} unit={elevationLow?.unit ?? ''} />
        </div>
        <div className="border-b col-span-2 -mx-2"></div>
        <div>Weather</div>
        <div>
          {weather?.icon ? <FabricIcon name={weather.icon} className="mr-2" /> : ''}
          <span>
            <NumericCrumb value={weather?.label ?? ''} unit={temperature?.unit ?? ''} />
          </span>
        </div>
        <div className="border-b col-span-2 -mx-2"></div>
        <div>
          OSM relation
        </div>
        <div>
          <a
              href={`https://www.openstreetmap.org/relation/${trail.sourceRelation}`}
              target="_blank"
          >
            <img
                alt="OpenStreetMap logo"
                className="h-4 inline-block mr-1"
                src="/static/images/icons/osm-logo.svg"
            />
            {trail.sourceRelation}
          </a>
        </div>
        <div className="border-b col-span-2 -mx-2"></div>
        <div>
          Synced
        </div>
        <div>
          {state.epochDate
              // We *need* this be in the pacific time because the client and server generated text
              // *must* match.
              ? state.epochDate.toLocaleDateString(undefined, {timeZone: 'America/Los_Angeles'})
              : 'unknown'
          }
        </div>
      </div>
      {state.elevation
          ? <section className="mt-4">
              <div className="font-medium text-lg">Elevation</div>
              <ElevationGraph {...state} />
            </section>
          : <></>
      }
    </div>
  </>;
}

function NumericCrumb({value, unit}: {value: string; unit: string;}) {
  return <>
    <span className="font-medium mr-0.5">{value}</span>
    <span className="text-tc-gray-400 text-xs">{unit}</span>
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
            dominantBaseline="hanging"
            textAnchor="end"
            x="-8"
            y={-y * scale}
        >
          {y}
        </text>
    );
  }

  const estimatedTextWidth = 11 * Math.ceil(Math.log10(highestGrid));

  const indicateEvery = Math.ceil(length / 7 * 2) / 2;
  const distanceIndicators = [];
  for (let x = 0; x <= length; x += indicateEvery) {
    distanceIndicators.push(
        <text
            dominantBaseline="hanging"
            x={x / length * resWidth}
            y={-lowestGrid * scale + 8}
        >
          {x} {lengthUnit}
        </text>
    );
  }

  const sampleProjectionStyle = [
    'transform:',
    `translateY(${-max * scale}px)`,
    `scaleY(${(max - min) / resHeight * scale})`,
  ].join(' ');

  let indicator;
  if (!!elevation.cursor
      && elevation.cursorFraction !== undefined
      && elevation.cursorFraction >= 0) {
    const x = elevation.cursorFraction * resWidth;
    const y = elevation.cursor.altitude;
    // We follow the same projection routine as the samples do.
    const fy = (maxMeters - y) / (maxMeters - minMeters) * resHeight;
    const scaleY = (max - min) / resHeight * scale;
    const translateY = -max * scale;
    const ypx = scaleY * fy + translateY;
    indicator =
        <circle
            fill="white"
            stroke="black"
            strokeWidth={2}
            cx={x}
            cy={ypx}
            r={7}
        />;
  } else {
    indicator = <circle cx="0" cy="0" r="0" />;
  }

  return <>
    <div className="border py-2 mt-4 rounded">
      <svg
          className={`relative select-none touch-none w-full`}
          unboundEvents={{
            'pointerleave': 'clearElevationCursor',
            'pointermove': 'moveElevationCursor',
          }}
          viewBox={
            [
              -GRAPH_TEXT_SPACE_PX[0] - estimatedTextWidth,
              -highestGrid * scale,
              resWidth + GRAPH_TEXT_SPACE_PX[0] + estimatedTextWidth,
              height + GRAPH_TEXT_SPACE_PX[1],
            ].join(' ')
          }>
        <g className="stroke-tc-gray-400">
          <g style="stroke-dasharray: 4">
            {gridLines}
          </g>
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
            strokeLinejoin="round"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={
              [
                'transform:',
                `translateY(${-max * scale}px)`,
                `scaleY(${(max - min) / resHeight * scale})`,
              ].join(' ')
            }
        />
        {indicator}
      </svg>
    </div>
  </>;
}

