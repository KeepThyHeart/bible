import { utf8Encode } from './bytes';
import { asBufferSource as bs } from './webcrypto';

/** HKDF-SHA-256 (RFC 5869). `info` is a UTF-8 label such as "kth-backup-kek-v1". */
export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string | Uint8Array,
  len: number
): Promise<Uint8Array> {
  if (!Number.isInteger(len) || len < 1 || len > 255 * 32) throw new RangeError('Invalid HKDF output length');
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', bs(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: bs(salt), info: bs(typeof info === 'string' ? utf8Encode(info) : info) },
    key,
    len * 8
  );
  return new Uint8Array(bits);
}
