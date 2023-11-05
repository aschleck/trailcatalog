import { S2Polygon } from 'java/org/trailcatalog/s2';
import * as corgi from 'js/corgi';
import { IndeterminantLinear } from 'js/dino/progress';

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
      <canvas className="h-full w-full focus-visible:outline-none" tabIndex="-1" />
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
  const shorts =
      copyrights
          .filter(hasShort)
          .map(c => ({
            source: c.short,
            url: c.url,
          }));
  // TODO(april): a link for long form copyright information
  const notices = shorts.flatMap(c => [
    `©`,
    c.url
        ? <>
            <a
                className="pointer-events-auto"
                href={c.url}
                target="_blank">
              {c.source}
            </a>
          </>
        : c.source,
    ', ',
  ]);
  notices.pop();
  return notices;
}

function hasShort(c: Copyright): c is {
  long: string;
  short: string;
  url: string|undefined;
} {
  if (c.short === undefined) {
    return false;
  } else {
    return true;
  }
}

