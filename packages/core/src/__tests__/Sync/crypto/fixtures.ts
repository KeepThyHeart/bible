/** Shared fixtures for the SyncCrypto tests (not a test file). */
import { argon2id } from '../../../Crypto';
import type { KdfParams } from '../../../Crypto';

/** The 0078 floor: real Argon2id, but as cheap as the validator allows. */
export const FLOOR = { m: 19456, t: 2, p: 1 } as const;

/** Decomposed "á" on purpose: derivation must NFC-normalise. */
export const PASSWORD = 'Pássword correct horse ✓';

/** Argon2id wrapped in a recorder, so tests can see the master key and the password the KDF received. */
export function recordingKdf() {
  const calls: Array<{ password: string; params: KdfParams; master: Uint8Array }> = [];
  const kdf = async (password: string, params: KdfParams): Promise<Uint8Array> => {
    const master = await argon2id(password, params);
    calls.push({ password, params, master: master.slice() });
    return master;
  };
  return { kdf, calls };
}

/** True when `needle` occurs anywhere in `hay`. */
export function containsBytes(hay: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
