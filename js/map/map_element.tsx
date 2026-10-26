import { S2Polygon } from 'java/org/trailcatalog/s2';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Link } from 'external/dev_april_corgi+/js/emu/button';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';
import { IndeterminantLinear } from 'external/dev_april_corgi+/js/emu/progress';

import { Copyright, LatLngRect, LatLngZoom } from './common/types';

import { MapController, State } from './map_controller';

export function MapElement({
    camera,
    className,
    compactCopyright,
    height,
    interactive,
    ref,
  }: {
    camera: LatLngRect|LatLngZoom|undefined;
    className?: string;
    // Shrinks the credits to a button in the bottom right, for a phone where a line of them would
    // cover the map
    compactCopyright?: boolean;
    height?: string;
    interactive?: boolean;
    ref?: string,
  },
  state: State|undefined,
  updateState: (newState: State) => void,
) {
  if (!state) {
    state = {
      copyrights: [],
      loadingData: false,
    };
  }

  return <>
    <div
        js={corgi.bind({
          controller: MapController,
          ref,
          state: [state, updateState],
          args: {
            camera,
            interactive: interactive ?? true,
          },
          events: {
            render: 'wakeup',
          },
        })}
        className={
          `${height ? height : "h-full"} relative select-none touch-none w-full`
              + (className ? ` ${className}` : "")
        }
    >
      {/* We set tabIndex so the canvas can pull focus off of inputs */}
      <canvas className="h-full w-full focus-visible:outline-none" tabindex="-1" />
      {state.loadingData ? <IndeterminantLinear /> : <></>}
      {compactCopyright
          ? <button
                ariaLabel="Credits"
                className="
                    absolute
                    bg-white/80
                    bottom-3
                    flex
                    items-center
                    justify-center
                    right-3
                    rounded-full
                    size-8
                    text-slate-700
                    z-20
                "
                unboundEvents={{click: 'showCopyrights'}}
            >
              <svg className="fill-current size-5" viewBox="0 -960 960 960">
                <path d={INFO_PATH} />
              </svg>
            </button>
          : <div className="
                absolute
                bg-[#fffffffa]
                bottom-0
                p-0.5
                pointer-events-none
                right-0
                select-none
                text-slate-700
                text-xs
                z-20
            ">
              <CopyrightNotices copyrights={state.copyrights} />
            </div>
      }
    </div>
  </>;
}

// Material Symbols Rounded info, under the Apache License 2.0
const INFO_PATH =
    'M483.18-280q12.82 0 21.32-8.63 8.5-8.62 8.5-21.37v-180q0-12.75-8.68-21.38-8.67-8.62-21.5-8.62-12.82 0-21.32 8.62-8.5 8.63-8.5 21.38v180q0 12.75 8.68 21.37 8.67 8.63 21.5 8.63Zm-3.2-314q14.02 0 23.52-9.2T513-626q0-14.45-9.48-24.22-9.48-9.78-23.5-9.78t-23.52 9.78Q447-640.45 447-626q0 13.6 9.48 22.8 9.48 9.2 23.5 9.2Zm.29 514q-82.74 0-155.5-31.5Q252-143 197.5-197.5t-86-127.34Q80-397.68 80-480.5t31.5-155.66Q143-709 197.5-763t127.34-85.5Q397.68-880 480.5-880t155.66 31.5Q709-817 763-763t85.5 127Q880-563 880-480.27q0 82.74-31.5 155.5Q817-252 763-197.68q-54 54.31-127 86Q563-80 480.27-80Zm.23-60Q622-140 721-239.5t99-241Q820-622 721.19-721T480-820q-141 0-240.5 98.81T140-480q0 141 99.5 240.5t241 99.5Zm-.5-340Z';

function CopyrightNotices({copyrights}: {copyrights: Copyright[]}) {
  if (copyrights.length === 0) {
    return <></>;
  }

  const unique = new Map<string, Copyright & {short: string}>();
  for (const c of copyrights.filter(hasShort)) {
    const key = `${c.short}|${c.url}`;
    // Several layers credit OpenStreetMap, and the one naming its provider says the most
    if (!unique.get(key)?.provider) {
      unique.set(key, c);
    }
  }
  const shorts = [...unique.values()];
  shorts.sort((a, b) => a.short < b.short ? -1 : a.short === b.short ? 0 : 1);
  const notices = shorts.flatMap(c => [
    ...(c.provider ? [creditLink(c.provider.name, c.provider.url), ' '] : []),
    c.publicDomain ? '' : '© ',
    creditLink(c.short, c.url),
    ', ',
  ]);
  notices.pop();
  return <>
    {notices}
    {' '}
    <Link
        className="pointer-events-auto"
        unboundEvents={{
          corgi: [
            [ACTION, 'showCopyrights'],
          ],
        }}
    >
      (more)
    </Link>
  </>;
}

function creditLink(text: string, url: string|undefined) {
  return url
      ? <>
          <a
              className="pointer-events-auto"
              href={url}
              target="_blank">
            {text}
          </a>
        </>
      : text;
}

function hasShort(c: Copyright): c is Copyright & {short: string} {
  if (c.short === undefined) {
    return false;
  } else {
    return true;
  }
}

