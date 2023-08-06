import process from 'process';

import { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyCookie, { FastifyCookieOptions } from '@fastify/cookie';
import { Pool } from 'pg'

import { checkExists } from 'js/common/asserts';
import { serve } from 'js/server/server';

import { App } from '../client/app';
import { ExpiredCredentialError, LoginEnforcer } from './auth';
import { Encrypter } from './encrypter';
import * as oidc from './oidc';

const COOKIE_SECRET = checkExists(process.env.COOKIE_SECRET);
const DEBUG = process.env.DEBUG !== 'false';

const encrypter = new Encrypter(COOKIE_SECRET);
const loginEnforcer = new LoginEnforcer(encrypter);
const pgPool = new Pool();

async function initialize(server: FastifyInstance): Promise<void> {
  server.register(fastifyCookie, {
    secret: COOKIE_SECRET,
    parseOptions: {
      httpOnly: true,
      path: '/',
      secure: !DEBUG,
    },
  });

  server.addHook('preHandler', async (request, reply) => {
    let maybeUserId;
    try {
      maybeUserId = loginEnforcer.checkLogin(request);
      // TODO(april): we should check the user against the database
    } catch (e: unknown) {
      if (e instanceof ExpiredCredentialError) {
        console.log('expired');
        reply.redirect(`/login/${e.issuerEndpoint}`);
        return reply;
      } else {
        throw e;
      }
    }

    request.userId = maybeUserId ?? '';
  });

  await oidc.addGoogle(server, encrypter, loginEnforcer, pgPool);
}

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
    <script src="/static/client.js"></script>
  </body>
</html>
`;
}

(async () => {
  await serve(App as any, page, initialize);
})();
