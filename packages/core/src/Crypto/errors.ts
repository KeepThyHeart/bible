/** Errors raised by the crypto primitives. */

export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** An AEAD tag did not verify: wrong key, or the data was altered. */
export class AuthError extends CryptoError {}

/** KDF parameters are outside the accepted floor/ceiling or malformed. */
export class KdfParamsError extends CryptoError {}
