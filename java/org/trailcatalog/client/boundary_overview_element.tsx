import * as corgi from 'js/corgi';
import { OutlinedButton } from 'js/dino/button';

import { LittleEndianView } from './common/little_endian_view';
import { boundingLlz, metersToMiles } from './common/math';
import { s2LatLngRectToTc } from './common/types';
import { initialData } from './data';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { Boundary, Trail } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { boundaryFromRaw, BoundaryOverviewController, containingBoundariesFromRaw, State, trailsInBoundaryFromRaw } from './boundary_overview_controller';
import { TrailListItem } from './trail_list';
import { TrailPopup } from './trail_popup';
import { ViewportLayoutElement } from './viewport_layout_element';

export function BoundaryOverviewElement({boundaryId}: {
  boundaryId: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    const rawBoundary = initialData('boundary', {id: boundaryId});
    let boundary;
    if (rawBoundary) {
      boundary = boundaryFromRaw(rawBoundary);
    }

    const rawContainingBoundaries = initialData('boundaries_containing_boundary', {child_id: boundaryId});
    let containingBoundaries;
    if (rawContainingBoundaries) {
      containingBoundaries = containingBoundariesFromRaw(rawContainingBoundaries);
    }

    const rawTrailsInBoundary = initialData('trails_in_boundary', {boundary_id: boundaryId});
    let trailsInBoundary;
    if (rawTrailsInBoundary) {
      trailsInBoundary = trailsInBoundaryFromRaw(rawTrailsInBoundary);
    }

    state = {
      boundary,
      containingBoundaries,
      trailsInBoundary,
      hovering: undefined,
      nearbyTrails: [],
      selectedCardPosition: [-1, -1],
      selectedTrails: [],
    };
  }

  let parsedId;
  try {
    parsedId = BigInt(boundaryId);
  } catch {
    return <>Invalid boundary ID {boundaryId}</>;
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
          controller: BoundaryOverviewController,
          args: {boundaryId: parsedId},
          events: {
            corgi: [
              [DATA_CHANGED, 'onDataChange'],
              [HOVER_CHANGED, 'onHoverChanged'],
              [MAP_MOVED, 'onMove'],
              [SELECTION_CHANGED, 'onSelectionChanged'],
            ],
            render: 'wakeup',
          },
          key: boundaryId,
          state: [state, updateState],
        })}
        className="flex flex-col h-full"
    >
      {state.boundary
          ? <>
            <ViewportLayoutElement
                camera={boundingLlz(s2LatLngRectToTc(state.boundary.polygon.getRectBound()))}
                overlay={{
                  content: trailDetails,
                  polygon: state.boundary.polygon,
                }}
                sidebarContent={<BoundarySidebar state={state} />}
            />
          </>
          : "Loading..."
      }
    </div>
  </>;
}

function BoundarySidebar({state}: {state: State}) {
  if (!state.boundary) {
    return <div>Loading...</div>;
  }

  const containing = state.containingBoundaries;
  const containingLabels = containing ? <BoundaryCrumbs boundaries={containing} /> : <></>;

  const nearby = state.nearbyTrails?.length;
  const nearbyLabel = nearby !== undefined ? `Nearby trails (${nearby})` : 'Nearby trails';
  const boundary = state.boundary;
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
        <div>{boundary.name}</div>
      </header>
      <section className="mx-3 text-tc-gray-300">
        Relation ID:{' '}
        <a
            title="View relation in OSM"
            href={`https://www.openstreetmap.org/relation/${boundary.sourceRelation}`}
        >{boundary.sourceRelation}</a>
      </section>
      <div className="border-b-[1px] border-tc-gray-600" />
      <section>
        {(state.trailsInBoundary ?? []).map(trail =>
            <TrailListItem
                highlight={state?.hovering?.id === trail.id}
                trail={trail}
            />
        )}
      </section>
    </div>
  </>;
}

