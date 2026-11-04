/**
 * HMAC-SHA-256 over WebCrypto (plan-refresh item 21). Core Crypto has no HMAC, so it lives here, next to its only
 * user (`deriveRecordId`), and the Crypto barrel is left alone.
 */
import { asBufferSource as bs } from '../../Crypto/webcrypto';

/** HMAC-SHA-256(key, data): 32 bytes. The key must not be empty (WebCrypto refuses zero-length HMAC keys). */
export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (key.length === 0) throw new RangeError('HMAC key must not be empty');
  const subtle = globalThis.crypto.subtle;
  const k = await subtle.importKey('raw', bs(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, bs(data)));
}
