import crypto from 'crypto';

const CIPHER_ALGORITHM = 'aes-256-gcm';
const CIPHER_AUTH_TAG_LENGTH = 16;
const CIPHER_KEY_LENGTH = 32;
const CIPHER_IV_LENGTH = 16;
const ENCRYPTED_ENCODING = 'base64';

export class Encrypter {

  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(secret.slice(0, CIPHER_KEY_LENGTH), 'utf8');
  }

  encrypt(s: string): string {
    const iv = crypto.randomBytes(CIPHER_IV_LENGTH);
    const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, this.key, iv, {
      authTagLength: CIPHER_AUTH_TAG_LENGTH,
    });
    const encryptedVerifier = Buffer.concat([
      cipher.update(s, 'utf8'),
      cipher.final(),
    ]);

    return Buffer.concat([iv, cipher.getAuthTag(), encryptedVerifier]).toString(ENCRYPTED_ENCODING);
  }

  decrypt(t: string): string {
    const b = Buffer.from(t, ENCRYPTED_ENCODING);
    const iv = b.slice(0, CIPHER_IV_LENGTH);
    const authTag = b.slice(CIPHER_IV_LENGTH, CIPHER_IV_LENGTH + CIPHER_AUTH_TAG_LENGTH);
    const encryptedVerifier = b.slice(CIPHER_IV_LENGTH + CIPHER_AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, this.key, iv, {
      authTagLength: CIPHER_AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    return decipher.update(encryptedVerifier, /* inputEncoding= */ undefined, 'utf8') +
        decipher.final('utf8');
  }
}

