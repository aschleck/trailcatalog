import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { setStatusCode } from 'external/dev_april_corgi+/js/server/ssr_aware';

export function NotFoundElement() {
  setStatusCode(404);

  return <>
    <div className="p-4">
      <p>There is nothing here.</p>
      <p><a href="/">Back to the map</a></p>
    </div>
  </>;
}
