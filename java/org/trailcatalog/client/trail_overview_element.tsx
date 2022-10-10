import * as corgi from 'js/corgi';
import { FlatButton, OutlinedButton } from 'js/dino/button';
import { FabricIcon } from 'js/dino/fabric';

import { decodeBase64 } from './common/base64';
import { latLngFromBase64E7 } from './common/data';
import { formatDistance } from './common/formatters';
import { LittleEndianView } from './common/little_endian_view';
import { degreesE7ToLatLng, projectLatLng } from './common/math';
import { LatLng, LatLngRect } from './common/types';
import { initialData } from './data';
import { DATA_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { Trail } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
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
      showZoomToFit: false,
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
                camera={state.trail.bound}
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
  const containingLabels = containing ? <BoundaryCrumbs boundaries={containing} /> : <></>;

  const nearby = state.nearbyTrails?.length;
  const trail = state.trail;
  const distance = formatDistance(trail.lengthMeters);
  return <>
    <div className="flex flex-col min-h-full">
      <aside className="border-b mx-3 py-4">
        <a
            className="font-bold no-underline"
            href="/"
            unboundEvents={{
              click: 'viewNearbyTrails',
            }}
        >
          <FabricIcon name="List" />
          {' '}
          <span className="align-top">
            {nearby !== undefined ? `${nearby} nearby trails` : 'Nearby trails'}
          </span>
        </a>
      </aside>
      <section className="border-b grow mx-3 py-4">
        <header className="flex font-bold justify-between pb-1 text-2xl">
          <div>{trail.name}</div>
          <div>
            {state.showZoomToFit
                ?
                    <OutlinedButton
                        dense={true}
                        icon="ZoomToFit"
                        unboundEvents={{
                          click: 'zoomToFit',
                        }}
                    />
                : <></>
            }
          </div>
        </header>
        <aside className="pb-4 text-sm text-tc-gray-400">
          {containingLabels}
        </aside>
        <section>
          <span className="font-bold text-2xl">
            {distance.value}
          </span>
          {' '}
          <span className="text-sm text-tc-gray-400">
            {distance.unit}
          </span>
        </section>
      </section>
      <aside className="mx-3 py-4">
        <section className="text-tc-gray-300">
          Relation ID:{' '}
          <a
              title="View relation in OSM"
              href={`https://www.openstreetmap.org/relation/${trail.sourceRelation}`}
              target="_blank"
          >{trail.sourceRelation}</a>
        </section>
      </aside>
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
  const marker = latLngFromBase64E7(raw.marker);
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
