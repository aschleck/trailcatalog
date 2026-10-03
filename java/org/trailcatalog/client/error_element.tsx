import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { setStatusCode } from 'external/dev_april_corgi+/js/server/ssr_aware';

export function ErrorElement({statusCode}: {statusCode: number}) {
  setStatusCode(statusCode);

  return <>
    <div className="p-4">
      <p>
        {statusCode === 404 ? 'There is nothing here.' : 'Something went wrong loading this page.'}
      </p>
      <p><a className="underline" href="/">Back to the map</a></p>
    </div>
  </>;
}
