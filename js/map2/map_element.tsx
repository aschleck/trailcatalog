import { S2Polygon } from 'java/org/trailcatalog/s2';
import * as corgi from 'js/corgi';

import { LatLngRect, LatLngZoom } from './common/types';

import { Copyright, MapController, State } from './map_controller';

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
      <div className="
          absolute
          bg-white-opaque-160
          bottom-0
          p-0.5
          pointer-events-none
          right-0
          select-none
          text-slate-700
          text-[0.625rem]
          z-20
      ">
        <CopyrightNotices copyrights={state.copyrights} />
      </div>
    </div>
  </>;
}

function CopyrightNotices({copyrights}: {copyrights: Copyright[]}) {
  const notices = copyrights.flatMap(c => [
    `${c.contribution} ©`,
    <a
        className="pointer-events-auto"
        href={c.url}
        target="_blank">
      {c.source}
    </a>,
    ', ',
  ]);
  notices.pop();
  return notices;
}
