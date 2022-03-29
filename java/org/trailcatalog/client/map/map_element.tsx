import * as corgi from 'js/corgi';

import { MapController } from './map_controller';

export const MapElement = ({lat, lng, zoom}: {lat: number, lng: number, zoom: number}) => {
  return <>
    <div
        jscontroller={MapController}
        onRender={MapController.prototype.wakeup}
        args={{
          lat,
          lng,
          zoom,
        }}
        className="h-full relative w-full">
      <canvas className="h-full w-full" />
      <div className="absolute bg-white-translucent bottom-0 p-0.5 right-0 text-slate-700 text-xs">
        Maps © <a href="https://www.thunderforest.com">Thunderforest</a>,
        Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>
      </div>
    </div>
  </>;
};
