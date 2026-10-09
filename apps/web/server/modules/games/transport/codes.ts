/**
 * Room codes, session tokens and host tokens.
 *
 * These are the only secrets in the system and the only string a person has to
 * copy off a screen, so the two halves of this file pull in opposite
 * directions: codes are short and forgiving, tokens are long and unforgiving.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type HostToken,
  type PlayerId,
  type RoomCode,
  type SessionToken,
} from '../../../../src/modules/games/shared/protocol.js';

/**
 * The code alphabet, chosen twice over — the values themselves live in
 * `src/shared/protocol.ts` so the join form can validate a code before a
 * round trip, not only after one.
 *
 * First for legibility: a code is read off a projector at the back of a room
 * and typed on a phone, so every glyph that survives that trip badly is gone —
 * 0 and O, 1 and I and L, U (heard as "you" when the code is read aloud), plus
 * the pairs that only look alike on a low-contrast screen: 8/B, 6/G, 5/S, 2/Z,
 * 9/Q, 7/T, 4/A.
 *
 * Second for uniformity, which is a correctness property rather than a
 * cosmetic one. Turning a random byte into an index with `%` is uniform only
 * when the alphabet length divides 256. For any other length the low indices
 * are reachable from one more byte value than the high ones, and the bias is
 * not subtle in aggregate: it is how a "random" code develops a predictable
 * prefix. Sixteen characters divides 256 exactly, so the low nibble of a
 * random byte is a uniform index by construction — no modulo, no rejection
 * sampling, no loop that could in principle not terminate.
 */
export { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH };

/** Valid only because the alphabet length is a power of two; asserted below. */
const ROOM_CODE_MASK = ROOM_CODE_ALPHABET.length - 1;

if ((ROOM_CODE_ALPHABET.length & ROOM_CODE_MASK) !== 0) {
  throw new Error('room code alphabet must have a power-of-two length for unbiased masking');
}

/** How far the allocator will widen a code before giving up on collisions. */
const MAX_ROOM_CODE_LENGTH = 8;
const ATTEMPTS_PER_LENGTH = 64;

/** 256 bits, so guessing is not a strategy and neither is a birthday attack. */
const TOKEN_BYTES = 32;

/** Shorter, because a player id is an identifier and not a credential. */
const PLAYER_ID_BYTES = 9;

export function generateRoomCode(length: number = ROOM_CODE_LENGTH): RoomCode {
  let code = '';
  // Iterating the buffer yields numbers; indexing it would yield `number |
  // undefined` under the project's strict index checking for no benefit.
  for (const byte of randomBytes(length)) {
    code += ROOM_CODE_ALPHABET.charAt(byte & ROOM_CODE_MASK);
  }
  return code;
}

/**
 * Codes are only unique among rooms that are alive right now, so uniqueness is
 * the registry's question to answer and this takes it as a predicate. Widening
 * the code rather than looping forever means a server holding an improbable
 * number of rooms degrades into longer codes instead of into a hang.
 */
export function allocateRoomCode(
  isTaken: (code: RoomCode) => boolean,
  length: number = ROOM_CODE_LENGTH
): RoomCode {
  for (let width = length; width <= MAX_ROOM_CODE_LENGTH; width += 1) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_LENGTH; attempt += 1) {
      const code = generateRoomCode(width);
      if (!isTaken(code)) return code;
    }
  }
  throw new Error('unable to allocate an unused room code');
}

/**
 * Codes arrive from a phone keyboard, so the input is lowercase as often as
 * not and may carry the spaces or hyphens someone added to make it readable.
 * Anything left that is not in the alphabet is a typo rather than a code:
 * returning null here is what turns it into a clean "no such room" instead of
 * a lookup that quietly cannot match.
 */
export function normaliseRoomCode(raw: unknown): RoomCode | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s-]/g, '').toUpperCase();
  if (cleaned.length < 4 || cleaned.length > MAX_ROOM_CODE_LENGTH) return null;
  for (const character of cleaned) {
    if (!ROOM_CODE_ALPHABET.includes(character)) return null;
  }
  return cleaned;
}

export function generateSessionToken(): SessionToken {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function generateHostToken(): HostToken {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Opens a screen stream and nothing else — see `HostToken`'s own doc comment
 * in the protocol. Same entropy as the owner token: it is never displayed to
 * the room either, only shown as a QR code to whoever is adding a screen.
 */
export function generateDisplayToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function generatePlayerId(): PlayerId {
  return randomBytes(PLAYER_ID_BYTES).toString('base64url');
}

/**
 * Only the hash is ever stored. A room dumped to disk for persistence, or
 * captured in a crash report, must not hand the reader live control of a game
 * in progress — and the token itself is high-entropy random, so a plain digest
 * is the right tool: there is nothing to brute-force and no need for the cost
 * of a password hash.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant time, because the alternative leaks the answer one character at a
 * time. `timingSafeEqual` throws on a length mismatch, so the length check
 * comes first — and lengths are not secret here, every digest is the same
 * size.
 */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyToken(presented: unknown, storedHash: string): boolean {
  if (typeof presented !== 'string' || presented.length === 0) return false;
  return hashesEqual(hashToken(presented), storedHash);
}
