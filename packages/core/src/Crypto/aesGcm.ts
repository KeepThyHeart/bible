import { AuthError } from './errors';

/** Key material must be 32 bytes (AES-256); nonces 12 bytes; tags are 16 bytes appended to the ciphertext. */
export const AES_KEY_LEN = 32;
export const AES_NONCE_LEN = 12;
export const AES_TAG_LEN = 16;

function checkKey(key: Uint8Array): void {
  if (key.length !== AES_KEY_LEN) throw new RangeError('AES-256-GCM key must be 32 bytes');
}
function checkNonce(nonce: Uint8Array): void {
  if (nonce.length !== AES_NONCE_LEN) throw new RangeError('AES-GCM nonce must be 12 bytes');
}

/** An imported, non-extractable AES-GCM key, reusable across many calls. */
export type AesKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;

export async function importAesKey(key: Uint8Array): Promise<AesKey> {
  checkKey(key);
  return globalThis.crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function aesGcmSealKey(key: AesKey, nonce: Uint8Array, pt: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  checkNonce(nonce);
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad ?? new Uint8Array(0), tagLength: 128 },
    key,
    pt
  );
  return new Uint8Array(ct);
}

export async function aesGcmOpenKey(key: AesKey, nonce: Uint8Array, ct: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  checkNonce(nonce);
  if (ct.length < AES_TAG_LEN) throw new AuthError('Ciphertext shorter than the authentication tag');
  try {
    const pt = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad ?? new Uint8Array(0), tagLength: 128 },
      key,
      ct
    );
    return new Uint8Array(pt);
  } catch {
    throw new AuthError('Authentication failed');
  }
}

/** AES-256-GCM seal. Returns `ciphertext || tag`. */
export async function aesGcmSeal(key: Uint8Array, nonce: Uint8Array, pt: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  return aesGcmSealKey(await importAesKey(key), nonce, pt, aad);
}

/** AES-256-GCM open of `ciphertext || tag`. Throws `AuthError` on any failure. */
export async function aesGcmOpen(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  return aesGcmOpenKey(await importAesKey(key), nonce, ct, aad);
}
