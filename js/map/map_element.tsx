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
    height,
    interactive,
    ref,
  }: {
    camera: LatLngRect|LatLngZoom|undefined;
    className?: string;
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
      <div className="
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
    </div>
  </>;
}

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

