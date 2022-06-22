import * as corgi from 'js/corgi';
import { FlatButton, OutlinedButton } from 'js/dino/button';

import { LittleEndianView } from './common/little_endian_view';
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
      const pathBuffer = decodeBase64(raw.path_ids);
      const pathStream = new LittleEndianView(pathBuffer);
      const paths = [];
      for (let i = 0; i < pathBuffer.byteLength; i += 8) {
        paths.push(pathStream.getBigInt64());
      }
      trail =
          new Trail(
              BigInt(trailId),
              raw.name,
              raw.type,
              {low: [0, 0], high: [0, 0]},
              paths,
              center,
              projectLatLng(center),
              raw.length_meters);
    }
    state = {
      nearbyTrails: undefined,
      trail,
    };
  }

  let parsedId;
  try {
    parsedId = BigInt(trailId);
  } catch {
    return <>Invalid trail ID {trailId}</>;
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
          sidebarContent={<TrailSidebar state={state} />}
      />
    </div>
  </>;
}

function TrailSidebar({state}: {state: State}) {
  if (!state.trail) {
    return <div>Loading...</div>;
  }

  const nearby = state.nearbyTrails?.length;
  const nearbyLabel = nearby !== undefined ? `Nearby trails (${nearby})` : 'Nearby trails';
  const trail = state.trail;
  return <>
    <div className="m-4 space-y-3">
      <aside>
        <OutlinedButton
            icon="BulletedList"
            label={nearbyLabel}
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

// This and following based on https://developer.mozilla.org/en-US/docs/Glossary/Base64
function decodeBase64(base64: string): ArrayBuffer {
  const nInLen = base64.replace(/=+/, '').length;
  const nOutLen = nInLen / 4 * 3;
  const taBytes = new Uint8Array(nOutLen);

  for (let nMod3, nMod4, nUint24 = 0, nOutIdx = 0, nInIdx = 0; nInIdx < nInLen; nInIdx++) {
    nMod4 = nInIdx & 3;
    nUint24 |= b64ToUint6(base64.charCodeAt(nInIdx)) << 6 * (3 - nMod4);
    if (nMod4 === 3 || nInLen - nInIdx === 1) {
      for (nMod3 = 0; nMod3 < 3 && nOutIdx < nOutLen; nMod3++, nOutIdx++) {
        taBytes[nOutIdx] = nUint24 >>> (16 >>> nMod3 & 24) & 255;
      }
      nUint24 = 0;
    }
  }

  return taBytes.buffer;
}

function b64ToUint6(nChr: number): number {
  return nChr > 64 && nChr < 91 ?
          nChr - 65
      : nChr > 96 && nChr < 123 ?
          nChr - 71
      : nChr > 47 && nChr < 58 ?
          nChr + 4
      : nChr === 43 ?
          62
      : nChr === 47 ?
          63
      :
          0;
}
