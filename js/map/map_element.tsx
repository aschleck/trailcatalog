import { S2Polygon } from 'java/org/trailcatalog/s2';
import * as corgi from 'js/corgi';

import { LatLngRect, LatLngZoom } from './common/types';

import { MapController } from './map_controller';

export function MapElement({
  camera,
  className,
  height,
  interactive,
  ref,
}: {
  camera: LatLngRect|LatLngZoom;
  className?: string;
  height?: string;
  interactive?: boolean;
  ref?: string,
}) {
  return <>
    <div
        js={corgi.bind({
          controller: MapController,
          ref,
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
        {'Data ©'}
        <a
            className="pointer-events-auto"
            href="https://www.openstreetmap.org/copyright"
            target="_blank">
          OpenStreetMap contributors
        </a>
        {', Elevation ©'}
        <a
            className="pointer-events-auto"
            href="https://spacedata.copernicus.eu/documents/20126/0/CSCDA_ESA_Mission-specific+Annex.pdf"
            target="_blank">
          Copernicus
        </a>
        {', Maps ©'}
        <a
            className="pointer-events-auto"
            href="https://www.maptiler.com/copyright/"
            target="_blank">
          MapTiler
        </a>
        {', Weather ©'}
        <a
            className="pointer-events-auto"
            href="https://open-meteo.com/"
            target="_blank">
          OpenMeteo
        </a>
      </div>
    </div>
  </>;
}
