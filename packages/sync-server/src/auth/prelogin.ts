/**
 * Pre-login KDF parameters. Unknown emails get a fake but stable salt, HMAC(serverSecret, "prelogin\0" + email)
 * truncated to 16 bytes, with the default cost, in exactly the same JSON shape (and key order) as a real account,
 * so the endpoint does not reveal who has an account.
 */
import { Crypto, type Sync } from '@bible/core';
import { bytesToB64url, hmacSha256 } from './tokens';

export const FAKE_SALT_BYTES = 16;

/** Canonical key order for every KDF JSON the server sends. */
export function canonicalKdf(k: Sync.KdfParamsJson): Sync.KdfParamsJson {
  return { id: k.id, v: k.v, m: k.m, t: k.t, p: k.p, salt: k.salt };
}

/**
 * Residual leak, accepted: the fake salt is stable per (secret, email) while a real account's salt changes when its
 * password is reset or rotated, so an observer who polls prelogin over time can tell "salt changed" (real account)
 * from "never changes" (unknown). Closing it needs per-account server-side salt state; not v1.
 */
export function fakeKdf(serverSecret: Uint8Array, normalisedEmail: string,
  cost: { m: number; t: number; p: number } = Crypto.DEFAULT_KDF): Sync.KdfParamsJson {
  const mac = hmacSha256(serverSecret, `prelogin\0${normalisedEmail}`);
  const { m, t, p } = cost;
  return canonicalKdf({ id: 'argon2id', v: 19, m, t, p, salt: bytesToB64url(mac.subarray(0, FAKE_SALT_BYTES)) });
}
