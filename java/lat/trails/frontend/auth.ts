import { FastifyReply, FastifyRequest } from 'fastify';

import { Encrypter } from './encrypter';

const LOGIN_COOKIE = 'logged_in';
const LOGIN_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
// Renewing on every request would re-encrypt and resend the cookie with each tile fetch, so we only
// renew after the cookie has become old.
const LOGIN_RENEWAL_MS = 1 * 24 * 60 * 60 * 1000;

interface SerializedLogin {
  created: number;
  id: string;
  issuerEndpoint: string;
}

export class ExpiredCredentialError extends Error {

  constructor(readonly issuerEndpoint: string) {
    super();
  }
}

export class LoginEnforcer {

  constructor(private readonly encrypter: Encrypter) {
  }

  checkLogin(request: FastifyRequest, reply: FastifyReply): string|undefined {
    const credential = request.cookies[LOGIN_COOKIE];
    if (!credential) {
      return undefined;
    }

    const info: SerializedLogin = JSON.parse(this.encrypter.decrypt(credential));
    const now = new Date().getTime();
    if (now >= info.created + LOGIN_DURATION_MS) {
      throw new ExpiredCredentialError(info.issuerEndpoint);
    }

    if (now >= info.created + LOGIN_RENEWAL_MS) {
      this.createFreshLogin(info.id, info.issuerEndpoint, reply);
    }
    return info.id;
  }

  createFreshLogin(id: string, issuerEndpoint: string, reply: FastifyReply): void {
    const created = new Date().getTime();
    const login: SerializedLogin = {
      created,
      id,
      issuerEndpoint,
    };

    const serialized = this.encrypter.encrypt(JSON.stringify(login));
    reply.setCookie(LOGIN_COOKIE, serialized, {
      maxAge: LOGIN_DURATION_MS / 1000,
    });
  }

  logout(reply: FastifyReply): void {
    reply.clearCookie(LOGIN_COOKIE);
  }
}

