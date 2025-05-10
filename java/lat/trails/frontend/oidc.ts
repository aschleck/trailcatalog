import process from 'process';

import { FastifyInstance, FastifyRequest } from 'fastify';
import { generators, Issuer } from 'openid-client';
import { Pool } from 'pg'

import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { LoginEnforcer } from './auth';
import { Encrypter } from './encrypter';

const OIDC_COOKIE = 'oidc';

export async function addGoogle(
    fastify: FastifyInstance,
    encrypter: Encrypter,
    loginEnforcer: LoginEnforcer,
    pgPool: Pool): Promise<void> {
  const issuer = await Issuer.discover('https://accounts.google.com');

  const getCallbackUrl =
      (request: FastifyRequest) =>
          `${request.protocol}://${request.hostname}/login/google/callback`;

  const client = new issuer.Client({
    client_id: checkExists(process.env.OAUTH2_GOOGLE_CLIENT_ID),
    client_secret: checkExists(process.env.OAUTH2_GOOGLE_SECRET),
    response_types: ['code'],
  });

  fastify.get('/login/google', async (request, reply) => {
    const codeVerifier = generators.codeVerifier();
    reply.setCookie(OIDC_COOKIE, encrypter.encrypt(codeVerifier), {
      httpOnly: true,
    });

    reply.redirect(
        client.authorizationUrl({
          code_challenge: generators.codeChallenge(codeVerifier),
          code_challenge_method: 'S256',
          redirect_uri: getCallbackUrl(request),
          scope: 'openid email',
        }));
  });

  fastify.get('/login/google/callback', async function (request, reply) {
    const codeVerifier = encrypter.decrypt(checkExists(request.cookies[OIDC_COOKIE]));
    reply.clearCookie(OIDC_COOKIE);

    const params = client.callbackParams(request.originalUrl);
    const tokenSet =
        await client.callback(
            getCallbackUrl(request), params, {code_verifier: codeVerifier});
    const claims = tokenSet.claims();

    if (!claims.email_verified) {
      reply.code(403).send('Email is unverified');
    }

    // TODO(april): we can have a uuid conflict but #yolo
    const result =
        await pgPool.query(
            'INSERT INTO users (id, oidc_issuer, oidc_id, display_name, enabled, last_login) '
                + 'VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) '
                + 'ON CONFLICT (oidc_issuer, oidc_id) '
                + 'DO UPDATE SET display_name = $3, last_login = $5 '
                + 'RETURNING id',
            [claims.iss, claims.sub, claims.email, true, new Date()]);
    loginEnforcer.createFreshLogin(result.rows[0].id, 'google', reply);
    reply.redirect('/');
  });
}
