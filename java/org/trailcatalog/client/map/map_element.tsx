import { S2Polygon } from 'java/org/trailcatalog/s2';
import * as corgi from 'js/corgi';

import { LatLngRect, LatLngZoom } from '../common/types';

import { MapController } from './map_controller';

export const MapElement = ({camera, overlay}: {
  camera: LatLngRect|LatLngZoom;
  overlay?: {
    polygon?: S2Polygon;
  };
}) => {
  return <>
    <div
        js={corgi.bind({
          controller: MapController,
          args: {camera, overlay: overlay ?? {}},
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
        <a
            className="pointer-events-auto"
            href="https://www.maptiler.com/copyright/"
            target="_blank">
          MapTiler
        </a>
        {' · Data © '}
        <a
            className="pointer-events-auto"
            href="https://www.openstreetmap.org/copyright"
            target="_blank">
          OpenStreetMap contributors
        </a>
      </div>
    </div>
  </>;
};
