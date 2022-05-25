import * as corgi from 'js/corgi';

import { MapController } from './map_controller';

export const MapElement = ({camera, filter}: {
  camera: {lat: number; lng: number; zoom: number;};
  filter?: {boundary?: number};
}) => {
  return <>
    <div
        js={corgi.bind({
          controller: MapController,
          args: {camera, filter: filter ?? {}},
          events: {
            render: 'wakeup',
          },
        })}
        className="h-full relative select-none touch-none w-full">
      <canvas className="h-full w-full" />
      <div className="
          absolute
          bg-white-translucent
          bottom-0
          p-0.5
          pointer-events-none
          right-0
          select-none
          text-slate-700
          text-xs
      ">
        Maps ©{' '}
        <a className="pointer-events-auto" href="https://www.thunderforest.com">
          Thunderforest
        </a>,
        Data ©{' '}
        <a className="pointer-events-auto" href="https://www.openstreetmap.org/copyright">
          OpenStreetMap contributors
        </a>
      </div>
    </div>
  </>;
};
