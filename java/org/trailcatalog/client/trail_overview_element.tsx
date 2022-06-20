import * as corgi from 'js/corgi';
import { FlatButton, OutlinedButton } from 'js/dino/button';

import { degreesE7ToLatLng, metersToMiles, projectLatLng } from './common/math';
import { initialData } from './common/ssr_aware';
import { MAP_MOVED } from './map/events';
import { Trail } from './models/types';

import { TrailOverviewController, State } from './trail_overview_controller';
import { ViewportLayoutElement } from './viewport_layout_element';

export function TrailOverviewElement({trailId}: {
  trailId: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    const raw = initialData({
      type: 'trail',
      id: trailId,
    }) as {
      name: string;
      type: number;
      path_ids: string;
      center_degrees: {
        lat: number;
        lng: number;
      };
      length_meters: number;
    }|undefined;
    let trail;
    if (raw) {
      const center = degreesE7ToLatLng(raw.center_degrees.lat, raw.center_degrees.lng);
      trail =
          new Trail(
              BigInt(trailId),
              raw.name,
              raw.type,
              {low: [0, 0], high: [0, 0]},
              [],
              center,
              projectLatLng(center),
              raw.length_meters);
    }
    state = {
      trail,
    };
  }

  let parsedId;
  try {
    parsedId = BigInt(trailId);
  } catch {
    return <>Invalid trail ID {trailId}</>;
  }

  let trailSidebar;
  if (state.trail) {
    trailSidebar = <TrailSidebar trail={state.trail} />;
  } else {
    trailSidebar = "Loading...";
  }

  return <>
    <div
        js={corgi.bind({
          controller: TrailOverviewController,
          args: {trailId: parsedId},
          events: {
            corgi: [
              [MAP_MOVED, 'onMove'],
            ],
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="flex flex-col h-full"
    >
      <ViewportLayoutElement
          camera={
            state.trail
                ? {lat: state.trail.center[0], lng: state.trail.center[1], zoom: 12}
                : undefined
          }
          sidebarContent={trailSidebar}
      />
    </div>
  </>;
}

function TrailSidebar({trail}: {trail: Trail}) {
  return <>
    <div className="m-4 space-y-3">
      <aside>
        <OutlinedButton
            icon="BulletedList"
            label="Nearby trails"
            unboundEvents={{
              click: 'viewNearbyTrails',
            }}
        />
      </aside>
      <div className="border-b-[1px] border-tc-gray-600 -mx-4" />
      <header className="flex font-bold justify-between text-xl">
        <div>{trail.name}</div>
        <div><OutlinedButton dense={true} icon="ZoomToFit" /></div>
      </header>
      <section>
        Relation ID:{' '}
        <a 
            title="View relation in OSM"
            href={`https://www.openstreetmap.org/relation/${trail.sourceRelation}`}
        >{trail.sourceRelation}</a>
      </section>
      <section>
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
