/**
 * Identifiers and capabilities for presentation sessions.
 *
 * Three values, with three different jobs, and it matters that they stay
 * distinct:
 *
 *  - **Session id** — not secret. It appears in the controller's URL path so
 *    that the URL still identifies the session if the fragment is stripped by a
 *    chat client or a copy-paste. It grants nothing on its own.
 *  - **Join code** — a low-value capability: it lets a device *watch*. Eight
 *    characters, because someone has to read it off a screen and type it, and
 *    because a QR code is not always practical.
 *  - **Control token** — the real capability: it lets a device *drive the wall*.
 *    256 bits, carried in the URL fragment so it never reaches an access log or
 *    a `Referer` header, and sent as a request header thereafter.
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/**
 * Crockford base32: the digits, minus `I`, `L`, `O` and `U`.
 *
 * `I`/`L` versus `1` and `O` versus `0` are the transcription errors people
 * actually make reading a code off a projector at the back of a room; leaving
 * them out means the ambiguity cannot arise. `U` is excluded by the same
 * encoding, which has the side benefit of keeping accidental words out of the
 * codes we hand to congregations.
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters people type that we should silently accept and fold. */
const CROCKFORD_FOLD: Record<string, string> = { I: '1', L: '1', O: '0' };

export const JOIN_CODE_LENGTH = 8;
const SESSION_ID_LENGTH = 16;

/**
 * A run of Crockford base32 characters from the system CSPRNG.
 *
 * 256 is an exact multiple of 32, so masking a random byte to its low five bits
 * is uniform and needs no rejection sampling. Doing this with `Math.random` or a
 * modulo of a non-power-of-two range is the classic way a "random" code ends up
 * with a predictable prefix.
 */
function randomCrockford(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CROCKFORD_ALPHABET[bytes[i] & 0x1f];
  }
  return out;
}

/** An 8-character join code, in canonical uppercase form. */
export function generateJoinCode(): string {
  return randomCrockford(JOIN_CODE_LENGTH);
}

/** A 16-character opaque session id. Not a secret; safe in a URL path. */
export function generateSessionId(): string {
  return randomCrockford(SESSION_ID_LENGTH);
}

/**
 * A 256-bit control token, base64url encoded.
 *
 * Returned exactly once, at session creation. Only its hash is stored, so there
 * is no way to recover it afterwards and no way for a copy of the database to
 * hand someone live control of a screen.
 */
export function generateControlToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Fold user input into the canonical join code, or null if it cannot be one.
 *
 * People type these from memory, out loud, and off a screen, so this accepts
 * lowercase, spaces and hyphens, and folds the Crockford ambiguities. Anything
 * still unrecognised after that is genuinely not a join code — normalising it
 * further would only turn a typo into a lookup for someone else's session.
 */
export function normalizeJoinCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const stripped = input.toUpperCase().replace(/[\s-]/g, '');
  if (stripped.length !== JOIN_CODE_LENGTH) return null;

  let out = '';
  for (const ch of stripped) {
    const folded = CROCKFORD_FOLD[ch] ?? ch;
    if (!CROCKFORD_ALPHABET.includes(folded)) return null;
    out += folded;
  }
  return out;
}

/** Validate a session id from a URL without touching the database. */
export function isValidSessionId(input: unknown): input is string {
  return typeof input === 'string'
    && input.length === SESSION_ID_LENGTH
    && [...input].every(ch => CROCKFORD_ALPHABET.includes(ch));
}

/**
 * Hash a control token for storage.
 *
 * SHA-256, deliberately, and *not* the scrypt used by `passwordGate.ts`. A slow
 * KDF exists to make guessing a low-entropy human-chosen secret expensive; this
 * token is 256 bits from the system CSPRNG, so there is nothing to guess and
 * the work factor buys nothing. It would, however, be paid on every single
 * intent — every arrow key, every verse advance — and scrypt is tuned to take
 * long enough that presenting would feel broken.
 */
export function hashControlToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time comparison of a presented token against a stored hash.
 *
 * Both sides are hashed first, so they are always the same length and
 * `timingSafeEqual` can never throw on a length mismatch — which would itself
 * leak the length of the expected value.
 */
export function verifyControlToken(token: unknown, storedHash: string): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  const presented = Buffer.from(hashControlToken(token), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(storedHash, 'hex');
  } catch {
    return false;
  }
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
