import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import * as corgi from 'js/corgi';

import { LittleEndianView } from './common/little_endian_view';
import { degreesE7ToLatLng, metersToMiles, projectLatLng } from './common/math';
import { LatLng, LatLngRect } from './common/types';
import { initialData } from './common/ssr_aware';
import { SELECTION_CHANGED } from './map/events';
import { Boundary } from './models/types';

import { decodeBase64 } from './base64';
import { BoundaryOverviewController, State } from './boundary_overview_controller';
import { TrailPopup } from './trail_popup';
import { ViewportLayoutElement } from './viewport_layout_element';

export function BoundaryOverviewElement({boundaryId}: {
  boundaryId: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    const raw = initialData({
      type: 'boundary',
      id: boundaryId,
    }) as {
      name: string;
      type: number;
      s2_polygon: string;
    }|undefined;
    let boundary;
    if (raw) {
      boundary =
          new Boundary(
              BigInt(boundaryId),
              raw.name,
              raw.type,
              SimpleS2.decodePolygon(decodeBase64(raw.s2_polygon)));
    }
    state = {
      boundary,
      hovering: undefined,
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
                overlay={{
                  content: trailDetails,
                  polygon: state?.boundary?.polygon,
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

  const boundary = state.boundary;
  return <>
    <div className="m-4 space-y-3">
      <div className="border-b-[1px] border-tc-gray-600 -mx-4" />
      <header className="flex font-bold justify-between text-xl">
        <div>{boundary.name}</div>
      </header>
      <section>
        Relation ID:{' '}
        <a
            title="View relation in OSM"
            href={`https://www.openstreetmap.org/relation/${boundary.sourceRelation}`}
        >{boundary.sourceRelation}</a>
      </section>
    </div>
  </>;
}

