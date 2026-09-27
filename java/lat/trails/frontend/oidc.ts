import process from 'process';

import { FastifyInstance, FastifyRequest } from 'fastify';
import { generators, Issuer } from 'openid-client';
import postgres from 'postgres';

import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { LoginEnforcer } from './auth';
import { Encrypter } from './encrypter';

const OIDC_COOKIE = 'oidc';

// The login runs in a popup so the page underneath keeps its state, and the opener watches for the
// window to disappear. Anyone who reached the callback in a tab of their own has no opener to
// return to, so send them to the map.
const FINISHED_PAGE = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"><title>Signed in</title></head>
  <body>
    <script>
      if (window.opener) {
        window.close();
      } else {
        window.location.replace('/');
      }
    </script>
  </body>
</html>
`;

export async function addGoogle(
    fastify: FastifyInstance,
    encrypter: Encrypter,
    loginEnforcer: LoginEnforcer,
    sql: postgres.Sql): Promise<void> {
  const issuer = await Issuer.discover('https://accounts.google.com');

  const getCallbackUrl = (request: FastifyRequest) => {
    const protocol = request.headers['x-forwarded-proto'] ?? request.protocol;
    // hostname drops the port, so a dev server on 7069 asks Google to redirect to a URI that is
    // not the one it is listening on.
    const hostname = request.headers['x-forwarded-host'] ?? request.host;
    return `${protocol}://${hostname}/login/google/callback`;
  }

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
          scope: 'openid email profile',
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
      return;
    }

    // TODO(april): we can have a uuid conflict but #yolo
    // EXCLUDED rather than positional parameters because the numbering silently shifts under
    // anything added to the insert.
    const result =
        await sql`
          INSERT INTO users (
                  id, oidc_issuer, oidc_id, display_name, email, picture_url, enabled, last_login)
              VALUES (
                  gen_random_uuid(),
                  ${claims.iss},
                  ${claims.sub},
                  ${checkExists(claims.email)},
                  ${checkExists(claims.email).toLowerCase()},
                  ${claims.picture ?? null},
                  ${true},
                  ${new Date()}
              )
              ON CONFLICT (oidc_issuer, oidc_id)
              DO UPDATE SET
                  display_name = EXCLUDED.display_name,
                  email = EXCLUDED.email,
                  picture_url = EXCLUDED.picture_url,
                  last_login = EXCLUDED.last_login
              RETURNING id
        `;
    loginEnforcer.createFreshLogin(result[0].id, 'google', reply);
    reply.type('text/html').send(FINISHED_PAGE);
  });
}
