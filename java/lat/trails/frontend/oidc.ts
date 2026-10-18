import crypto from 'crypto';
import process from 'process';

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretPost,
  Configuration,
  discovery,
  IDToken,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';
import postgres from 'postgres';

import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { loginPage } from '../client/login_page';

import { STATIC_PREFIX } from './assets';
import { LoginEnforcer } from './auth';
import { Encrypter } from './encrypter';

const OIDC_COOKIE = 'oidc';

// We mint a secret for each exchange, so it only has to outlive one request.
const APPLE_SECRET_LIFETIME_S = 5 * 60;

// A login without a return path usually runs in a popup so the page underneath keeps its state.
// window.opener can't tell us whether it did, because OpenStreetMap's Cross-Origin-Opener-Policy
// severs it, so we ask over a BroadcastChannel and the opener acknowledges. Anyone who reached the
// callback in a tab of their own gets no answer, so send them to the map.
//
// Keep in sync with login_popup.ts#LoginPopup.
const FINISHED_PAGE = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"><title>Signed in</title></head>
  <body>
    <script>
      const channel = new BroadcastChannel('login');
      channel.onmessage = e => {
        if (e.data === 'acknowledged') {
          window.close();
        }
      };
      channel.postMessage('signed-in');
      // An opener answers as soon as its event loop reaches the message, so a second of silence
      // means nobody is waiting on this login.
      setTimeout(() => {
        window.location.replace('/');
      }, 1000);
    </script>
  </body>
</html>
`;

type ProviderName = 'apple'|'google'|'osm';

type CallbackBody = {[key: string]: string}|undefined;

// Apple strays from OIDC: it POSTs the callback cross site, it doesn't take PKCE, it only sends the
// user's name in that POST, and its client secret is a JWT that expires.
interface Provider {
  label: string;
  logo: string;
  issuer: string;
  scope: string;
  // Calls back with a cross site POST, so the pending login cookie has to be SameSite=None and the
  // callback route has to parse a form
  formPost: boolean;
  pkce: boolean;
  clientSecret(config: LoginConfig): string;
  profile(claims: IDToken, body: CallbackBody): Profile;
}

// In the order the login page lists them
const PROVIDERS: {[name in ProviderName]: Provider} = {
  apple: {
    label: 'Apple',
    logo: 'apple_logo.svg',
    issuer: 'https://appleid.apple.com',
    scope: 'openid name email',
    formPost: true,
    pkce: false,
    clientSecret: config => appleClientSecret(checkExists(config.apple)),
    profile: appleProfile,
  },
  google: {
    label: 'Google',
    logo: 'google_logo.svg',
    issuer: 'https://accounts.google.com',
    scope: 'openid email profile',
    formPost: false,
    pkce: true,
    clientSecret: config => checkExists(config.google).client_secret,
    profile: oidcProfile,
  },
  osm: {
    label: 'OpenStreetMap',
    logo: 'osm_logo.svg',
    issuer: 'https://www.openstreetmap.org',
    scope: 'openid',
    formPost: false,
    pkce: true,
    clientSecret: config => checkExists(config.osm).client_secret,
    profile: oidcProfile,
  },
};

// The LOGIN_PROVIDERS environment variable. A provider left out has no login button.
interface LoginConfig {
  apple?: AppleCredentials;
  google?: Credentials;
  osm?: Credentials;
}

interface Credentials {
  client_id: string;
  client_secret: string;
}

// Apple's client secret is a JWT we sign with these, see appleClientSecret.
interface AppleCredentials {
  client_id: string;
  team_id: string;
  key_id: string;
  private_key: string;
}

interface Profile {
  // Undefined keeps whatever the user has, because Apple only sends a name on the first login.
  displayName: string|undefined;
  // Undefined for a provider that doesn't share one, or an address it hasn't verified
  email: string|undefined;
  pictureUrl: string|undefined;
}

interface PendingLogin {
  state: string;
  codeVerifier: string|undefined;
  // Where to go after logging in, or undefined to finish a popup
  returnTo: string|undefined;
}

export async function addProviders(
    fastify: FastifyInstance,
    encrypter: Encrypter,
    loginEnforcer: LoginEnforcer,
    sql: postgres.Sql): Promise<void> {
  const config: LoginConfig = JSON.parse(checkExists(process.env.LOGIN_PROVIDERS));
  const configured = (Object.keys(PROVIDERS) as ProviderName[]).filter(name => config[name]);
  for (const name of configured) {
    await addProvider(name, config, fastify, encrypter, loginEnforcer, sql);
  }

  fastify.get('/login', async (request, reply) => {
    const returnTo = returnPath(request);
    const query = returnTo ? `?return=${encodeURIComponent(returnTo)}` : '';
    reply.type('text/html').send(
        loginPage(
            configured.map(name => ({
              href: `/login/${name}${query}`,
              label: PROVIDERS[name].label,
              logo: `/static/${PROVIDERS[name].logo}`,
            })),
            STATIC_PREFIX));
  });
}

async function addProvider(
    name: ProviderName,
    config: LoginConfig,
    fastify: FastifyInstance,
    encrypter: Encrypter,
    loginEnforcer: LoginEnforcer,
    sql: postgres.Sql): Promise<void> {
  const provider = PROVIDERS[name];
  const clientId = checkExists(config[name]).client_id;
  const server = (await discovery(new URL(provider.issuer), clientId)).serverMetadata();
  // Per request because Apple's client secret expires. openid-client's ClientSecretBasic
  // form-encodes the client ID and secret, and Google rejects that as invalid_client, so every
  // provider gets client_secret_post.
  const configure = () =>
      new Configuration(
          server,
          clientId,
          /* metadata= */ undefined,
          ClientSecretPost(provider.clientSecret(config)));

  const getCallbackUrl = (request: FastifyRequest) => {
    const protocol = request.headers['x-forwarded-proto'] ?? request.protocol;
    // hostname drops the port, so a dev server on 7069 asks the provider to redirect to a URI that
    // is not the one it is listening on.
    const hostname = request.headers['x-forwarded-host'] ?? request.host;
    return `${protocol}://${hostname}/login/${name}/callback`;
  }

  fastify.get(`/login/${name}`, async (request, reply) => {
    const pending: PendingLogin = {
      state: randomState(),
      codeVerifier: provider.pkce ? randomPKCECodeVerifier() : undefined,
      returnTo: returnPath(request),
    };
    reply.setCookie(OIDC_COOKIE, encrypter.encrypt(JSON.stringify(pending)), {
      httpOnly: true,
      sameSite: provider.formPost ? 'none' : 'lax',
      secure: provider.formPost,
    });

    const parameters: {[key: string]: string} = {
      redirect_uri: getCallbackUrl(request),
      scope: provider.scope,
      state: pending.state,
    };
    if (pending.codeVerifier) {
      parameters.code_challenge = await calculatePKCECodeChallenge(pending.codeVerifier);
      parameters.code_challenge_method = 'S256';
    }
    if (provider.formPost) {
      parameters.response_mode = 'form_post';
    }
    reply.redirect(buildAuthorizationUrl(configure(), parameters).href);
  });

  const callback = async (request: FastifyRequest, reply: FastifyReply) => {
    const pending: PendingLogin =
        JSON.parse(encrypter.decrypt(checkExists(request.cookies[OIDC_COOKIE])));
    reply.clearCookie(OIDC_COOKIE);

    const body = request.body as CallbackBody;
    const callbackUrl = new URL(getCallbackUrl(request));
    for (const [key, value] of Object.entries(body ?? request.query as {[key: string]: string})) {
      callbackUrl.searchParams.append(key, value);
    }
    const tokens =
        await authorizationCodeGrant(configure(), callbackUrl, {
          expectedState: pending.state,
          idTokenExpected: true,
          pkceCodeVerifier: pending.codeVerifier,
        });
    const claims = checkExists(tokens.claims());
    const profile = provider.profile(claims, body);

    const userId = await sql.begin(async sql => {
      // Serializes logins to one account, or else two first logins both miss the SELECT and the
      // second fails the logins primary key.
      const account = `${claims.iss} ${claims.sub}`;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${account}, 0))`;
      const [existing] = await sql`
          SELECT user_id FROM logins WHERE issuer = ${claims.iss} AND subject = ${claims.sub}
      `;

      if (existing) {
        await sql`
            UPDATE users SET
                display_name = COALESCE(${profile.displayName ?? null}, display_name),
                email = COALESCE(${profile.email ?? null}, email),
                picture_url = COALESCE(${profile.pictureUrl ?? null}, picture_url)
                WHERE id = ${existing.user_id}
        `;
        return existing.user_id as string;
      }

      const [created] = await sql`
          INSERT INTO users (id, display_name, email, picture_url, enabled)
              VALUES (
                  gen_random_uuid(),
                  ${profile.displayName ?? profile.email ?? `${provider.label} user`},
                  ${profile.email ?? null},
                  ${profile.pictureUrl ?? null},
                  ${true})
              RETURNING id
      `;
      await sql`
          INSERT INTO logins (issuer, subject, user_id)
              VALUES (${claims.iss}, ${claims.sub}, ${created.id})
      `;
      return created.id as string;
    });

    loginEnforcer.createFreshLogin(userId, name, reply);
    if (pending.returnTo) {
      reply.redirect(pending.returnTo);
    } else {
      reply.type('text/html').send(FINISHED_PAGE);
    }
  };

  if (provider.formPost) {
    // Scoped to this route because any other route that parses forms takes cross site POSTs.
    await fastify.register(async scoped => {
      scoped.addContentTypeParser(
          'application/x-www-form-urlencoded',
          {parseAs: 'string'},
          (request, body, done) => {
            done(null, Object.fromEntries(new URLSearchParams(body as string)));
          });
      scoped.post(`/login/${name}/callback`, callback);
    });
  } else {
    fastify.get(`/login/${name}/callback`, callback);
  }
}

// Reads the return query parameter, keeping only a path on our own origin or else the login would
// redirect anywhere a link told it to.
function returnPath(request: FastifyRequest): string|undefined {
  const value = (request.query as {return?: string}).return;
  if (!value) {
    return undefined;
  }
  const base = 'https://trails.lat';
  const url = new URL(value, base);
  return url.origin === base ? `${url.pathname}${url.search}` : undefined;
}

// https://developer.apple.com/documentation/signinwithapple/incorporating-sign-in-with-apple-into-other-platforms
function appleProfile(claims: IDToken, body: CallbackBody): Profile {
  const user = body?.user ? JSON.parse(body.user) : undefined;
  const name =
      [user?.name?.firstName, user?.name?.lastName].filter(n => !!n).join(' ') || undefined;
  return {
    displayName: name,
    email: verifiedEmail(claims),
    pictureUrl: undefined,
  };
}

// OpenStreetMap only sends preferred_username.
function oidcProfile(claims: IDToken): Profile {
  return {
    displayName: stringClaim(claims, 'name') ?? stringClaim(claims, 'preferred_username'),
    email: verifiedEmail(claims),
    pictureUrl: stringClaim(claims, 'picture'),
  };
}

// Apple sends email_verified as either a boolean or a string.
// https://developer.apple.com/documentation/signinwithapplejs/authorizationi/id_token
function verifiedEmail(claims: IDToken): string|undefined {
  return String(claims.email_verified) === 'true' ? stringClaim(claims, 'email') : undefined;
}

// Claims beyond the registered ones can be any JSON, so we only trust one that is a string.
function stringClaim(claims: IDToken, name: string): string|undefined {
  const value = claims[name];
  return typeof value === 'string' ? value : undefined;
}

// https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret
function appleClientSecret(credentials: AppleCredentials): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {alg: 'ES256', kid: credentials.key_id};
  const payload = {
    iss: credentials.team_id,
    iat: now,
    exp: now + APPLE_SECRET_LIFETIME_S,
    aud: 'https://appleid.apple.com',
    sub: credentials.client_id,
  };
  const signed = [header, payload]
      .map(part => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.');
  const signature = crypto.sign('sha256', Buffer.from(signed), {
    // JWS wants r and s concatenated, not node's default DER
    dsaEncoding: 'ieee-p1363',
    key: credentials.private_key,
  });
  return `${signed}.${signature.toString('base64url')}`;
}
