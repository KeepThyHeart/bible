/**
 * Internal helpers shared by keys.ts, RecordCipher.ts and ISecretStore.ts. Not exported from `Sync/index.ts`.
 * Error messages here are generic on purpose: they must never carry key, password or plaintext bytes.
 */
import {
  AuthError, aesGcmOpenKey, aesGcmSealKey, b64urlDecode, b64urlEncode, concatBytes, hexDecode, importAesKey,
  utf8Encode,
} from '../../Crypto';
import type { RandomSource } from '../../Crypto';

export const KEY_LEN = 32;
export const NONCE_LEN = 12;
export const TAG_LEN = 16;
/** nonce 12 || ciphertext 32 || tag 16 */
export const WRAPPED_KEY_LEN = NONCE_LEN + KEY_LEN + TAG_LEN;

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;

export function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RangeError('Value out of u32 range');
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

export function readU32be(b: Uint8Array, off: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(off, false);
}

/** 32 lowercase hex chars -> 16 bytes (account ids, record ids). */
export function id16(id: string, what: string): Uint8Array {
  if (typeof id !== 'string' || !HEX32.test(id)) throw new RangeError(`Invalid ${what}`);
  return hexDecode(id);
}

/** 16 lowercase hex chars -> 8 bytes (device ids). */
export function id8(id: string, what: string): Uint8Array {
  if (typeof id !== 'string' || !HEX16.test(id)) throw new RangeError(`Invalid ${what}`);
  return hexDecode(id);
}

export function aad(label: string, ...parts: Uint8Array[]): Uint8Array {
  return concatBytes(utf8Encode(label), ...parts);
}

export function checkKey32(k: Uint8Array, what: string): void {
  if (!(k instanceof Uint8Array) || k.length !== KEY_LEN) throw new RangeError(`${what} must be 32 bytes`);
}

/** Seal arbitrary bytes under a 32-byte key: b64url(nonce || ct || tag). */
export async function sealB64(key: Uint8Array, pt: Uint8Array, ad: Uint8Array, random: RandomSource): Promise<string> {
  checkKey32(key, 'Wrapping key');
  const nonce = random.bytes(NONCE_LEN);
  const ct = await aesGcmSealKey(await importAesKey(key), nonce, pt, ad);
  return b64urlEncode(concatBytes(nonce, ct));
}

/** Open b64url(nonce || ct || tag). Any malformed input or tag failure is an AuthError. */
export async function openB64(key: Uint8Array, wire: string, ad: Uint8Array, message: string): Promise<Uint8Array> {
  checkKey32(key, 'Wrapping key');
  let raw: Uint8Array;
  try {
    raw = b64urlDecode(String(wire));
  } catch {
    throw new AuthError(message);
  }
  if (raw.length < NONCE_LEN + TAG_LEN) throw new AuthError(message);
  try {
    return await aesGcmOpenKey(await importAesKey(key), raw.subarray(0, NONCE_LEN), raw.subarray(NONCE_LEN), ad);
  } catch {
    throw new AuthError(message);
  }
}

/** Wrap a 32-byte key. */
export async function wrapKey(wrapping: Uint8Array, key: Uint8Array, ad: Uint8Array, random: RandomSource): Promise<string> {
  checkKey32(key, 'Wrapped key');
  return sealB64(wrapping, key, ad, random);
}

/** Unwrap a 32-byte key; wrong length / bad tag / malformed wire => AuthError(message). */
export async function unwrapKey(wrapping: Uint8Array, wire: string, ad: Uint8Array, message: string): Promise<Uint8Array> {
  let raw: Uint8Array;
  try {
    raw = b64urlDecode(String(wire));
  } catch {
    throw new AuthError(message);
  }
  if (raw.length !== WRAPPED_KEY_LEN) throw new AuthError(message);
  const k = await openB64(wrapping, wire, ad, message);
  if (k.length !== KEY_LEN) throw new AuthError(message);
  return k;
}

/** Best-effort wipe of transient secrets (JS gives no guarantee, but it shortens their life in the heap). */
export function wipe(...bufs: Array<Uint8Array | undefined>): void {
  for (const b of bufs) b?.fill(0);
}
