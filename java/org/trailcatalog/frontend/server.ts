import process from 'process';
import fastifyReplyFrom from '@fastify/reply-from';
import { FastifyInstance } from 'fastify';

import { PageOptions, serve } from 'external/dev_april_corgi+/js/server/server';

import { App } from '../client/app';

import { STATIC_PREFIX } from './assets';

const ROBOTS = `User-agent: *
Allow: /

Sitemap: https://trailcatalog.org/sitemap.xml
`;

// Crawlers only trust a sitemap for the URLs under its own directory, so it has to be served from
// the root rather than from /api/.
// https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
async function initialize(server: FastifyInstance) {
  server.register(fastifyReplyFrom, {
    base: 'http://127.0.0.1:7070',
  });

  server.get('/robots.txt', async (request, reply) => {
    return reply.type('text/plain').send(ROBOTS);
  });

  server.get('/sitemap.xml', (request, reply) => {
    reply.from('/api/sitemap.xml');
  });
}

const ORIGIN = 'https://trailcatalog.org';

function page({canonicalPath, content, escapedData, title}: PageOptions): string {
  return `
<!DOCTYPE html>
<html dir="ltr" lang="en" class="h-full">
  <head>
    <meta charset="utf-8"/>
    <title>${title}</title>
    <meta name="description" content="Organizing trails from OpenStreetMap">
    ${canonicalPath === undefined ? '' : `<link rel="canonical" href="${new URL(canonicalPath, ORIGIN).href}">`}
    <meta
        name="viewport"
        content="height=device-height, initial-scale=1, maximum-scale=1, minimum-scale=1, width=device-width" />
    <link rel="stylesheet" type="text/css" href="${STATIC_PREFIX}/client.css" />
    <link rel="icon" href="/static/images/icons/favicon.ico" type="image/x-icon" />
  </head>
  <body class="h-full">
    <div id="root" class="h-full">${content}</div>
    <script>${process.env.DEBUG ? 'window._DEBUG=true;' : ''}window.INITIAL_DATA=${escapedData}</script>
    <script type="module" src="${STATIC_PREFIX}/client.js"></script>
  </body>
  <script
      async
      data-goatcounter="https://trailcatalog.goatcounter.com/count"
      src="//gc.zgo.at/count.js"></script>
</html>
`;
}

// Node exits on an unhandled rejection, and a render that drops one would take every other request
// down with it.
process.on('unhandledRejection', reason => {
  console.error('Unhandled rejection', reason);
});

(async () => {
  await serve(App as any, page, {
    defaultTitle: 'Trailcatalog',
    initialize: initialize as any,
    port: 7080,
  });
})();

