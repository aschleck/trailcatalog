import process from 'process';

import { serve } from 'external/dev_april_corgi+/js/server/server';

import { App } from '../client/app';

function page(content: string, title: string, initialData: string): string {
  return `
<!DOCTYPE html>
<html dir="ltr" lang="en" class="h-full">
  <head>
    <meta charset="utf-8"/>
    <title>${title}</title>
    <meta name="description" content="Organizing trails from OpenStreetMap">
    <meta
        name="viewport"
        content="height=device-height, initial-scale=1, maximum-scale=1, minimum-scale=1, width=device-width" />
    <link rel="stylesheet" type="text/css" href="/static/client.css" />
    <link rel="icon" href="/static/images/icons/favicon.ico" type="image/x-icon" />
  </head>
  <body class="h-full">
    <div id="root" class="h-full">${content}</div>
    <script>${process.env.DEBUG ? 'window._DEBUG=true;' : ''}window.INITIAL_DATA=${initialData}</script>
    <script type="module" src="/static/client.js"></script>
  </body>
  <script
      async
      data-goatcounter="https://trailcatalog.goatcounter.com/count"
      src="//gc.zgo.at/count.js"></script>
</html>
`;
}

(async () => {
  await serve(App as any, page, {
    defaultTitle: 'Trailcatalog',
    port: 7080,
  });
})();

