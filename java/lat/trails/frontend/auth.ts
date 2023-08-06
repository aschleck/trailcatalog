import { FastifyReply, FastifyRequest } from 'fastify';

import { Encrypter } from './encrypter';

const LOGIN_COOKIE = 'logged_in';
const LOGIN_DURATION_MS = 1 * 24 * 60 * 60 * 1000;

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

  checkLogin(request: FastifyRequest): string|undefined {
    const credential = request.cookies[LOGIN_COOKIE];
    if (!credential) {
      return undefined;
    }

    console.log(this.encrypter.decrypt(credential));
    const info = JSON.parse(this.encrypter.decrypt(credential));
    if (new Date().getTime() < info.created + LOGIN_DURATION_MS) {
      return info.id;
    } else {
      throw new ExpiredCredentialError(info.issuerEndpoint);
    }
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
}

