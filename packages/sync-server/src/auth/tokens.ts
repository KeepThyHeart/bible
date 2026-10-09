/**
 * Secrets on the server side: session and email tokens (32 random bytes, b64url, stored only as SHA-256) and
 * constant-time comparisons. Nothing here logs or returns a secret except `newToken`, whose plain value goes
 * to the client exactly once.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN_BYTES = 32;
/** b64url of 32 bytes, no padding. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const B64URL_RE = /^[A-Za-z0-9_-]*$/;

export function sha256(data: Uint8Array | string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

export function hmacSha256(key: Uint8Array, data: Uint8Array | string): Uint8Array {
  return new Uint8Array(createHmac('sha256', key).update(data).digest());
}

/** Strict b64url decode (no padding, alphabet checked, canonical). Undefined on anything else. */
export function b64urlToBytes(s: unknown): Uint8Array | undefined {
  if (typeof s !== 'string' || !B64URL_RE.test(s) || s.length % 4 === 1) return undefined;
  const b = Buffer.from(s, 'base64url');
  if (b.toString('base64url') !== s) return undefined;
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

export function bytesToB64url(b: Uint8Array): string {
  return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64url');
}

/** A fresh token: the plain value for the client and the hash for the database. */
export function newToken(random: (n: number) => Uint8Array): { token: string; hash: Uint8Array } {
  const raw = random(TOKEN_BYTES);
  if (raw.length !== TOKEN_BYTES) throw new Error('random source returned the wrong length');
  return { token: bytesToB64url(raw), hash: sha256(raw) };
}

/** Hash of a token presented by a client, or undefined when it is not a well-formed token. */
export function hashPresentedToken(token: unknown): Uint8Array | undefined {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return undefined;
  const raw = b64urlToBytes(token);
  return raw && raw.length === TOKEN_BYTES ? sha256(raw) : undefined;
}

/**
 * Constant-time equality of two SHA-256 digests. Inputs of another length never match, but are still compared
 * against a same-length dummy so the time does not depend on them.
 */
export function digestEquals(a: Uint8Array, b: Uint8Array): boolean {
  const ok = a.length === 32 && b.length === 32;
  const x = ok ? a : new Uint8Array(32);
  const y = ok ? b : new Uint8Array(32);
  return timingSafeEqual(x, y) && ok;
}

/** A dummy digest to compare against when the account does not exist (keeps the work equal). */
export const DUMMY_DIGEST = sha256('kth-sync-dummy-auth-hash');

/**
 * Checks a client auth key (b64url of 32 bytes) against a stored SHA-256. Always hashes and compares once, even
 * for a malformed key or a missing account, so timing does not reveal which case failed.
 */
export function checkAuthKey(presented: unknown, stored: Uint8Array | undefined): boolean {
  const raw = b64urlToBytes(presented);
  const wellFormed = raw !== undefined && raw.length === 32;
  const digest = sha256(wellFormed ? raw : new Uint8Array(32));
  const match = digestEquals(digest, stored ?? DUMMY_DIGEST);
  return match && wellFormed && stored !== undefined;
}
