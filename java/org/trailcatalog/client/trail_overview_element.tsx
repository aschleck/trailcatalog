import * as corgi from 'js/corgi';
import { FlatButton, OutlinedButton } from 'js/dino/button';

import { LittleEndianView } from './common/little_endian_view';
import { boundingLlz, degreesE7ToLatLng, metersToMiles, projectLatLng } from './common/math';
import { LatLng, LatLngRect } from './common/types';
import { initialData } from './data';
import { DATA_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { Trail } from './models/types';

import { decodeBase64 } from './base64';
import { boundaryCrumbs } from './boundary_crumbs';
import { DataResponses } from './data';
import { containingBoundariesFromRaw, TrailOverviewController, State } from './trail_overview_controller';
import { TrailPopup } from './trail_popup';
import { ViewportLayoutElement } from './viewport_layout_element';

export function TrailOverviewElement({trailId}: {
  trailId: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    const rawTrail = initialData('trail', {id: trailId});
    let trail;
    if (rawTrail) {
      trail = trailFromRaw(rawTrail);
    }

    const rawContainingBoundaries = initialData('boundaries_containing_trail', {trail_id: trailId});
    let containingBoundaries;
    if (rawContainingBoundaries) {
      containingBoundaries = containingBoundariesFromRaw(rawContainingBoundaries);
    }

    state = {
      containingBoundaries,
      trail,
      hovering: undefined,
      nearbyTrails: undefined,
      selectedCardPosition: [-1, -1],
      selectedTrails: [],
    };
  }

  let parsedId;
  try {
    parsedId = BigInt(trailId);
  } catch {
    return <>Invalid trail ID {trailId}</>;
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
          controller: TrailOverviewController,
          args: {trailId: parsedId},
          events: {
            corgi: [
              [DATA_CHANGED, 'onDataChange'],
              [MAP_MOVED, 'onMove'],
              [SELECTION_CHANGED, 'onSelectionChanged'],
            ],
            render: 'wakeup',
          },
          key: trailId,
          state: [state, updateState],
        })}
        className="flex flex-col h-full"
    >
      {state.trail
          ? <>
            <ViewportLayoutElement
                // Probably we should just pass the bound in directly instead of doing this, alas
                camera={boundingLlz(state.trail.bound)}
                overlay={{content: trailDetails}}
                sidebarContent={<TrailSidebar state={state} />}
            />
          </>
          : "Loading..."
      }
    </div>
  </>;
}

function TrailSidebar({state}: {state: State}) {
  if (!state.trail) {
    return <div>Loading...</div>;
  }

  const containing = state.containingBoundaries;
  const containingLabels = containing ? boundaryCrumbs(containing) : [];

  const nearby = state.nearbyTrails?.length;
  const nearbyLabel = nearby !== undefined ? `Nearby trails (${nearby})` : 'Nearby trails';
  const trail = state.trail;
  return <>
    <div className="my-4 space-y-3">
      <aside className="mx-3">
        <OutlinedButton
            icon="BulletedList"
            label={nearbyLabel}
            unboundEvents={{
              click: 'viewNearbyTrails',
            }}
        />
      </aside>
      <aside className="mx-3 text-tc-gray-300">
        {containingLabels}
      </aside>
      <div className="border-b-[1px] border-tc-gray-600" />
      <header className="flex font-bold justify-between mx-3 text-xl">
        <div>{trail.name}</div>
        <div>
          <OutlinedButton
              dense={true}
              icon="ZoomToFit"
              unboundEvents={{
                click: 'zoomToFit',
              }}
          />
        </div>
      </header>
      <section className="mx-3 text-tc-gray-300">
        Relation ID:{' '}
        <a
            title="View relation in OSM"
            href={`https://www.openstreetmap.org/relation/${trail.sourceRelation}`}
        >{trail.sourceRelation}</a>
      </section>
      <section className="mx-3">
        <span className="font-bold text-2xl">
          {metersToMiles(trail.lengthMeters).toFixed(1)}
        </span>
        {' '}
        <span className="text-sm text-tc-gray-400">
          miles <FlatButton icon="Info12" title="Something important" />
        </span>
      </section>
    </div>
  </>;
}

function trailFromRaw(raw: DataResponses['trail']): Trail {
  const paths = [];
  const pathBuffer = decodeBase64(raw.path_ids);
  const pathStream = new LittleEndianView(pathBuffer);
  for (let i = 0; i < pathBuffer.byteLength; i += 8) {
    paths.push(pathStream.getBigInt64());
  }
  const boundStream = new LittleEndianView(decodeBase64(raw.bound));
  const bound = {
    low: [boundStream.getInt32() / 10_000_000, boundStream.getInt32() / 10_000_000],
    high: [boundStream.getInt32() / 10_000_000, boundStream.getInt32() / 10_000_000],
    brand: 'LatLngRect' as const,
  } as LatLngRect;
  const markerStream = new LittleEndianView(decodeBase64(raw.marker));
  const marker = [
    markerStream.getInt32() / 10_000_000,
    markerStream.getInt32() / 10_000_000,
  ] as LatLng;
  return new Trail(
      BigInt(raw.id),
      raw.name,
      raw.type,
      {low: [0, 0], high: [0, 0], brand: 'PixelRect' as const},
      paths,
      bound,
      marker,
      projectLatLng(marker),
      raw.length_meters);
}
