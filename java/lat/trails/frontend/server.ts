import process from 'process';

import fastifyCookie, { FastifyCookieOptions } from '@fastify/cookie';
import fastifyReplyFrom from '@fastify/reply-from';
import { FastifyInstance, FastifyRequest } from 'fastify';
import postgres from 'postgres';

import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { PageOptions, serve } from 'external/dev_april_corgi+/js/server/server';

import { App } from '../client/app';
import { DEFAULT_DESCRIPTION } from '../client/overview_element';

import { STATIC_PREFIX } from './assets';
import { ExpiredCredentialError, LoginEnforcer } from './auth';
import { Encrypter } from './encrypter';
import * as oidc from './oidc';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

const COOKIE_SECRET = checkExists(process.env.COOKIE_SECRET);
const DEBUG = process.env.DEBUG === 'true';

// Keep in sync with common/Database.kt#SCHEMA.
const SCHEMA = 'migration_14_bounds';

// A GPX point costs about 45 bytes of JSON across its lat, lng, elevation, and time, so this fits
// saving a track of a million and a half points. Keep in sync with nginx.conf and the trails.lat
// virtual host in production/files/configuration.nix.
const BODY_LIMIT_BYTES = 64 * 1024 * 1024;

const encrypter = new Encrypter(COOKIE_SECRET);
const loginEnforcer = new LoginEnforcer(encrypter);
const sql = postgres({connection: {search_path: SCHEMA}});

async function initialize(server: FastifyInstance): Promise<void> {
  server.decorateRequest('userId', '');

  server.register(fastifyCookie, {
    secret: COOKIE_SECRET,
    parseOptions: {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: !DEBUG,
    },
  });

  server.register(fastifyReplyFrom, {
    base: 'http://127.0.0.1:7051',
  });

  server.route({
    url: '/api/*',
    method: ['GET', 'HEAD', 'POST'],
    handler: (request, reply) => {
      reply.from(request.url, {
        rewriteRequestHeaders: (request, headers) => {
          return {
            'accept': headers['accept'],
            'accept-encoding': headers['accept-encoding'],
            'accept-language': headers['accept-language'],
            'cache-control': headers['cache-control'],
            'if-modified-since': headers['if-modified-since'],
            'if-none-match': headers['if-none-match'],
            'pragma': headers['pragma'],
            'user-agent': headers['user-agent'],
            'x-user-id': request.userId ?? '',
          };
        },
      });
    },
  });

  server.addHook('preHandler', async (request, reply) => {
    let maybeUserId;
    try {
      maybeUserId = loginEnforcer.checkLogin(request, reply);
      // TODO(april): we should check the user against the database
    } catch (e: unknown) {
      if (e instanceof ExpiredCredentialError) {
        // The login route runs this hook too, so a cookie left in place redirects it to itself.
        loginEnforcer.logout(reply);
        reply.redirect(`/login/${e.issuerEndpoint}`);
        return reply;
      } else {
        throw e;
      }
    }

    request.userId = maybeUserId ?? '';
    // corgi's server side render forwards this header to the data server, and the browser never
    // gets to set it because we assign it on every request.
    request.headers['x-user-id'] = request.userId;
  });

  server.get('/logout', async (request, reply) => {
    loginEnforcer.logout(reply);
    reply.redirect('/');
  });

  await oidc.addProviders(server, encrypter, loginEnforcer, sql);
}

const ORIGIN = 'https://trails.lat';

function page(
    {canonicalPath, content, description, escapedData, indexable, title}: PageOptions): string {
  return `
<!DOCTYPE html>
<html dir="ltr" lang="en" class="h-full">
  <head>
    <meta charset="utf-8"/>
    <title>${title}</title>
    <meta name="description" content="${description ?? DEFAULT_DESCRIPTION}">
    ${canonicalPath === undefined ? '' : `<link rel="canonical" href="${ORIGIN}${canonicalPath}">`}
    ${indexable ? '' : '<meta name="robots" content="noindex">'}
    <meta
        name="viewport"
        content="height=device-height, initial-scale=1, maximum-scale=1, minimum-scale=1, width=device-width" />
    <link rel="stylesheet" type="text/css" href="${STATIC_PREFIX}/client.css" />
    <link rel="icon" href="/static/favicon.webp" type="image/webp" />
  </head>
  <body class="h-full">
    <div id="root" class="h-full">${content}</div>
    <script>${DEBUG ? 'window._DEBUG=true;' : ''}window.INITIAL_DATA=${escapedData}</script>
    <script type="module" src="${STATIC_PREFIX}/client.js"></script>
    <script
        async
        data-goatcounter="https://trails-lat.goatcounter.com/count"
        src="//gc.zgo.at/count.js"></script>
  </body>
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
    dataServer: 'http://127.0.0.1:7051/api/data',
    defaultTitle: 'trails.lat',
    fastifyOptions: {
      bodyLimit: BODY_LIMIT_BYTES,
      http2: true,
      logger: {level: 'warn'},
      requestIdHeader: 'x-request-id',
    },
    // I don't get why this needs an any at all
    initialize: initialize as any,
    port: 7050,
  });
})();
