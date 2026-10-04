import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { RelationCategory } from 'java/org/trailcatalog/models/categories';
import { FlatButton, OutlinedButton } from 'js/dino/button';
import { FabricIcon, FabricIconName } from 'js/dino/fabric';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';
import { LatLng } from 'js/map/common/types';
import { CLICKED, ZOOMED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';

import { formatDistance, formatHeight, formatTemperature, getUnitSystem, shouldUseImperial } from 'js/units/formatters';
import { formatCount, metersToFeet, metersToMiles } from 'js/units/formatters';
import { formatWeatherCode } from './common/weather';
import { SELECTION_CHANGED } from './map/events';

import { BoundaryCrumbs } from './boundary_crumbs';
import { failedStatusCode, fetchData } from './data';
import { ErrorElement } from './error_element';
import { Header } from './page';
import { setTitle } from './title';
import { TrailDetailController, State } from './trail_detail_controller';
import { TrailIssue } from './trail_issue';
import { TrailPopup } from './trail_popup';
import { containingBoundariesFromRaw, pathProfilesInTrailFromRaw, trailFromRaw } from './trails';

// The graph holds its height before the elevation loads, or else the map shrinks under the camera
// when it arrives.
const ELEVATION_GRAPH_CLASSES = 'border-t border-tc-gray-200 h-48 shrink-0';
const FACT_CELL_CLASSES = 'border-b border-tc-gray-200 flex items-center min-h-12 px-4 py-2';

export function TrailDetailElement({trailId, parameters}: {
  trailId: string;
  parameters: {[key: string]: string};
}, inState: State|undefined, updateState: (newState: State) => void) {
  if (!inState || trailId !== inState.trailId) {
    const wrapped = {readable: trailId};
    inState = {
      containingBoundaries:
          fetchData('boundaries_containing_trail', {trail_id: wrapped})
              .then(containingBoundariesFromRaw),
      epochDate: fetchData('epoch', {}).then(raw => new Date(raw.timestampS * 1000)),
      layers: [],
      pathProfiles:
          fetchData('path_profiles_in_trail', {trail_id: wrapped})
              .then(pathProfilesInTrailFromRaw),
      selected: [],
      selectedCardPosition: [-1, -1],
      tags: fetchData('trail_tags', {trail_id: wrapped}).then(raw => raw.tags),
      trail: fetchData('trail', {trail_id: wrapped}).then(trailFromRaw),
      trailId,
    };
  }
  const state = inState;

  setTitle(state.trail.finished && state.trail.ok ? state.trail.value().name : undefined);

  const futures = [
    state.containingBoundaries,
    state.epochDate,
    state.pathProfiles,
    state.tags,
    state.trail,
  ];
  const failedCode = failedStatusCode(futures);
  let ready;
  if (failedCode === undefined && futures.some(f => !f.finished)) {
    // A rejection has to re-render too, or else the page sits on Loading forever and Node exits
    // on the unhandled rejection.
    const rerender = () => {
      updateState(state);
    };
    Promise.all(futures).then(rerender, rerender);
    ready = false;
  } else {
    ready = true;
  }

  return <>
    <div className="flex flex-col h-full">
      <Header />

      {failedCode !== undefined
          ? <ErrorElement statusCode={failedCode} />
          : ready
              ? <Content trailId={trailId} state={state} updateState={updateState} />
              : 'Loading...'
      }
    </div>
  </>;
}

function Content({trailId, state, updateState}: {
  trailId: string,
  state: State,
  updateState: (newState: State) => void,
}) {
  const trail = state.trail.value();
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

  let bear;
  if (state.elevation?.cursor) {
    bear = [state.elevation.cursor.lat, state.elevation.cursor.lng] as const as LatLng;
  } else {
    bear = undefined;
  }

  return <>
    <div
        js={corgi.bind({
          controller: TrailDetailController,
          key: JSON.stringify(trailId),
          args: {
            active: {trails: [trail]},
            overlays: {
              bear,
            },
            units: getUnitSystem(),
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
        className="flex flex-col-reverse grow md:flex-row md:overflow-hidden"
    >
      <TrailSidebar state={state} />
      <div className="flex flex-col grow md:h-full md:min-w-0">
        <div className="grow min-h-[50vh] relative md:min-h-0">
          <MapElement camera={trail.bound} ref="map" />
          <div className="absolute flex flex-col gap-2 right-2 top-2">
            <div unboundEvents={{corgi: [[ACTION, 'zoomToFit']]}}>
              <FlatButton
                  ariaLabel="Recenter trail"
                  className="bg-white"
                  icon="ZoomToFit"
                  title="Recenter trail"
              />
            </div>
            <div unboundEvents={{corgi: [[ACTION, 'browseMap']]}}>
              <FlatButton
                  ariaLabel="Browse the map"
                  className="bg-white"
                  icon="ScaleVolume"
                  title="Browse the map"
              />
            </div>
          </div>
          {trailDetails ?? <></>}
        </div>
        {state.elevation
            ? <ElevationGraph {...state} />
            : <div className={ELEVATION_GRAPH_CLASSES} />
        }
      </div>
    </div>
  </>;
}

function TrailSidebar({state}: {state: State}) {
  const containingBoundaries = state.containingBoundaries.value();
  const trail = state.trail.value();
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

  const tags = state.tags.value();

  return <>
    <div className="p-4 text-sm md:overflow-y-auto md:w-[24rem]">
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
      <div
          className="
              border-t
              border-tc-gray-200
              grid
              -mx-4
              mt-4
              [grid-template-columns:_5fr_4fr_4fr]
          "
      >
        {valid
            ? <></>
            : <FactRow label="Data status">
                <div className="relative">
                  <TrailIssue
                      label="1 issue with trail data"
                      position="pt-1 right-0 top-full md:w-72"
                      sourceRelation={trail.sourceRelation}
                  />
                </div>
              </FactRow>
        }
        <FactRow label={isOneWay ? "One-way distance" : "Round-trip distance"}>
          {valid
              ? <>
                  <FabricIcon name="CharticulatorLine" className="mr-2" />
                  <NumericCrumb value={distance.value} unit={distance.unit} />
                </>
              : <Unknown />
          }
        </FactRow>
        <FactRow label="Trail type">
          {trailTypeLabel(trail.type)}
        </FactRow>
        <FactPairRow
            label="Ascent & descent"
            left={
              valid
                  ? <>
                      <FabricIcon name="Market" className="mr-2" />
                      <NumericCrumb value={elevationUp.value} unit={elevationUp.unit} />
                    </>
                  : <Unknown />
            }
            right={
              valid
                  ? <>
                      <FabricIcon name="MarketDown" className="mr-2" />
                      <NumericCrumb value={elevationDown.value} unit={elevationDown.unit} />
                    </>
                  : <Unknown />
            }
        />
        <FactPairRow
            label="Highest & lowest"
            left={
              <>
                <FabricIcon name="SortUp" className="mr-2" />
                <NumericCrumb
                    value={elevationHigh?.value ?? ''}
                    unit={elevationHigh?.unit ?? ''}
                />
              </>
            }
            right={
              <>
                <FabricIcon name="SortDown" className="mr-2" />
                <NumericCrumb value={elevationLow?.value ?? ''} unit={elevationLow?.unit ?? ''} />
              </>
            }
        />
        <FactRow label="Weather">
          {weather?.icon ? <FabricIcon name={weather.icon} className="mr-2" /> : ''}
          <span>
            <NumericCrumb value={weather?.label ?? ''} unit={temperature?.unit ?? ''} />
          </span>
        </FactRow>
        {tags['operator']
            ? <FactRow label="Operator">{tags['operator']}</FactRow>
            : <></>
        }
        <FactRow label="OSM relation">
          <a
              className="underline"
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
        </FactRow>
        {tags['website']
            ? <FactRow label="Website">
                <a className="underline" href={tags['website']} target="_blank">
                  <FabricIcon name="Globe" className="mr-1 text-tc-highlight-3" />
                  Website
                </a>
              </FactRow>
            : <></>
        }
        <FactRow label="Synced">
          {
              // We *need* this be in the pacific time because the client and server generated text
              // *must* match.
              state.epochDate.value()
                  .toLocaleDateString(undefined, {timeZone: 'America/Los_Angeles'})
          }
        </FactRow>
      </div>
    </div>
  </>;
}

function FactRow({children, label}: {
  children?: corgi.VElementOrPrimitive|corgi.VElementOrPrimitive[];
  label: string;
}) {
  return <>
    <FactLabel label={label} />
    <div className={`${FACT_CELL_CLASSES} col-span-2`}><div>{children ?? []}</div></div>
  </>;
}

function FactPairRow({label, left, right}: {
  label: string;
  left: corgi.VElementOrPrimitive;
  right: corgi.VElementOrPrimitive;
}) {
  return <>
    <FactLabel label={label} />
    <div className={`${FACT_CELL_CLASSES} border-r`}><div>{left}</div></div>
    <div className={FACT_CELL_CLASSES}><div>{right}</div></div>
  </>;
}

function FactLabel({label}: {label: string}) {
  return <>
    <div className={`${FACT_CELL_CLASSES} border-r text-tc-gray-400`}>{label}</div>
  </>;
}

function Unknown() {
  return <>
    <span className="text-tc-gray-400">Unknown</span>
  </>;
}

function trailTypeLabel(type: number): string {
  switch (type) {
    case RelationCategory.TRAIL_BICYCLE:
      return 'Bicycle';
    case RelationCategory.TRAIL_CANOE:
      return 'Canoe';
    case RelationCategory.TRAIL_FOOT:
      return 'Foot';
    case RelationCategory.TRAIL_HIKING:
      return 'Hiking';
    case RelationCategory.TRAIL_HORSE:
      return 'Horse';
    case RelationCategory.TRAIL_INLINE_SKATES:
      return 'Inline skating';
    case RelationCategory.TRAIL_MTB:
      return 'Mountain biking';
    case RelationCategory.TRAIL_PISTE:
      return 'Piste';
    case RelationCategory.TRAIL_RUNNING:
      return 'Running';
    case RelationCategory.TRAIL_SKIING:
      return 'Skiing';
    default:
      return 'Trail';
  }
}

function NumericCrumb({value, unit}: {value: string; unit: string;}) {
  return <>
    <span className="font-medium">{value}</span>
    <span className="ml-1 text-tc-gray-400">{unit}</span>
  </>;
}

function ElevationGraph(state: State) {
  const elevation = checkExists(state.elevation);
  const [resWidth, resHeight] = elevation.resolution;
  const [minMeters, maxMeters] = elevation.extremes;

  let heightUnit;
  let length;
  let lengthUnit;
  let toHeight;
  if (shouldUseImperial()) {
    heightUnit = 'ft';
    length = metersToMiles(elevation.lengthMeters);
    lengthUnit = 'mi';
    toHeight = metersToFeet;
  } else {
    heightUnit = 'm';
    length = elevation.lengthMeters / 1000;
    lengthUnit = 'km';
    toHeight = (meters: number) => meters;
  }

  const step = niceStep((toHeight(maxMeters) - toHeight(minMeters)) / 4);
  const lowest = Math.floor(toHeight(minMeters) / step) * step;
  const highest = Math.max(Math.ceil(toHeight(maxMeters) / step) * step, lowest + step);
  const topPercent = (height: number) => (highest - height) / (highest - lowest) * 100;

  const gridLines = [];
  const heightLabels = [];
  for (let y = lowest; y <= highest; y += step) {
    gridLines.push(
        <div
            className="absolute border-t border-dotted border-tc-gray-400 inset-x-0"
            style={`top: ${topPercent(y)}%`}
        />
    );
    heightLabels.push(
        <span
            className="absolute right-3 -translate-y-1/2 whitespace-nowrap"
            style={`top: ${topPercent(y)}%`}
        >
          {formatCount(y)} {heightUnit}
        </span>
    );
  }

  const lengthStep = niceStep(length / 6);
  const lengthLabels = [];
  // i * lengthStep rather than a running sum, or else 0.1 + 0.2 prints as 0.30000000000000004.
  for (let i = 0; i * lengthStep <= length; ++i) {
    const x = Number((i * lengthStep).toFixed(2));
    lengthLabels.push(
        <span
            className="absolute mt-1 top-full -translate-x-1/2 whitespace-nowrap"
            style={`left: ${x / length * 100}%`}
        >
          {x} {lengthUnit}
        </span>
    );
  }

  // The samples span minMeters to maxMeters over the height of the resolution, so the grid's wider
  // range is the same linear map carried past both ends.
  const viewTop = (toHeight(maxMeters) - highest) / (toHeight(maxMeters) - toHeight(minMeters));
  const viewHeight = (highest - lowest) / (toHeight(maxMeters) - toHeight(minMeters));

  let cursor;
  if (elevation.cursor
      && elevation.cursorFraction !== undefined
      && 0 <= elevation.cursorFraction
      && elevation.cursorFraction <= 1) {
    const left = elevation.cursorFraction * 100;
    cursor = <>
      <div className="absolute border-l border-tc-gray-400 inset-y-0" style={`left: ${left}%`} />
      <div
          className="
              absolute
              bg-white
              border-2
              border-black
              h-3
              -translate-x-1/2
              -translate-y-1/2
              rounded-full
              w-3
          "
          style={`left: ${left}%; top: ${topPercent(toHeight(elevation.cursor.altitude))}%`}
      />
    </>;
  } else {
    cursor = <></>;
  }

  return <>
    <div
        className={
          `${ELEVATION_GRAPH_CLASSES} flex pb-7 pr-8 pt-4 select-none text-tc-gray-400 text-xs`
        }
    >
      <div className="relative shrink-0 w-20">
        {heightLabels}
      </div>
      <div className="grow relative">
        {gridLines}
        {lengthLabels}
        <svg
            className="absolute h-full inset-0 overflow-visible touch-none w-full"
            preserveAspectRatio="none"
            unboundEvents={{
              'pointerleave': 'clearElevationCursor',
              'pointermove': 'moveElevationCursor',
            }}
            viewBox={[0, viewTop * resHeight, resWidth, viewHeight * resHeight].join(' ')}
        >
          <polyline
              fill="none"
              points={elevation.heights}
              stroke="black"
              strokeLinejoin="round"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="absolute inset-0 pointer-events-none">
          {cursor}
        </div>
      </div>
    </div>
  </>;
}

// The smallest 1, 2, or 5 times a power of ten that is at least the given step.
function niceStep(raw: number): number {
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-3))));
  for (const multiple of [1, 2, 5]) {
    if (multiple * power >= raw) {
      return multiple * power;
    }
  }
  return 10 * power;
}
