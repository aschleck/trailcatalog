import * as corgi from 'js/corgi';

import { Controller } from './controller';

export const MapElement = () => {
  return <div className="relative">
    <canvas jscontroller={Controller} className="h-screen w-screen" />
    <div className="absolute bg-white-translucent bottom-0 p-0.5 right-0 text-slate-700 text-xs">
      Maps © <a href="https://www.thunderforest.com">Thunderforest</a>,
      Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>
    </div>
  </div>;
};
