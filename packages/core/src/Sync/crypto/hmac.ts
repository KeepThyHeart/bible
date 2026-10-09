/**
 * HMAC-SHA-256 over WebCrypto (plan-refresh item 21; W1-B implements). Core Crypto has no HMAC, so it lives here,
 * next to its only user (`deriveRecordId`), and the Crypto barrel is left alone. Use `asBufferSource` from
 * `../../Crypto/webcrypto` when handing bytes to `crypto.subtle`.
 */
import { notImplemented } from '../notImplemented';

/** HMAC-SHA-256(key, data): 32 bytes. */
export function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  throw notImplemented(key, data);
}
