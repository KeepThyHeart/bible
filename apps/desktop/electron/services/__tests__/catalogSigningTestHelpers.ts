/**
 * Software Ed25519 keys and signing helpers for the catalog-trust tests. They
 * produce what `scripts/yubikey-sign.py` writes, minus the YubiKey.
 */

import { createHash, generateKeyPairSync, sign, type KeyObject } from 'crypto';

import { vouchMessage, VOUCH_FORMAT, VOUCH_VERSION, type KeyVouch } from '../CatalogKeyVouches';

export interface TestKey {
  publicKeyHex: string;
  privateKey: KeyObject;
}

export function makeKey(): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyHex: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
    privateKey,
  };
}

/** A `.sig` document: the first key is the primary, the rest go in `signatures`. */
export function signatureDocument(catalog: Buffer, ...keys: TestKey[]): string {
  const digest = createHash('sha256').update(catalog).digest();
  const [primary, ...rest] = keys.map((key) => ({
    publicKey: key.publicKeyHex,
    signature: sign(null, digest, key.privateKey).toString('hex'),
    algorithm: 'ed25519-sha256',
  }));
  return JSON.stringify(rest.length > 0 ? { ...primary, signatures: rest } : primary);
}

export function makeVouch(
  by: TestKey,
  newKey: string,
  scope: string,
  issued = '2027-03-01T12:00:00Z',
): KeyVouch {
  const unsigned = { vouchingKey: by.publicKeyHex, newKey, scope, issued };
  return { ...unsigned, signature: sign(null, vouchMessage(unsigned), by.privateKey).toString('hex') };
}

export function vouchDocument(...vouches: KeyVouch[]): string {
  return JSON.stringify({ format: VOUCH_FORMAT, version: VOUCH_VERSION, vouches });
}
