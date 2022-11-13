import { S2Polygon } from 'java/org/trailcatalog/s2';
import * as corgi from 'js/corgi';

import { LatLngRect, LatLngZoom } from '../common/types';
import { Filters } from './layers/map_data';

import { MapController } from './map_controller';

export function MapElement({camera, filters, overlay}: {
  camera: LatLngRect|LatLngZoom;
  filters?: Filters;
  overlay?: {
    polygon?: S2Polygon;
  };
}) {
  return <>
    <div
        js={corgi.bind({
          controller: MapController,
          args: {
            camera,
            filters: filters ?? {},
            overlay: overlay ?? {},
          },
          events: {
            render: 'wakeup',
          },
        })}
        className="h-full relative select-none touch-none w-full"
    >
      <canvas className="h-full w-full" tabIndex="-1" />
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
      </div>
    </div>
  </>;
}
