// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  allocateRoomCode,
  generateHostToken,
  generatePlayerId,
  generateRoomCode,
  generateSessionToken,
  hashToken,
  hashesEqual,
  normaliseRoomCode,
  verifyToken,
} from './codes.js';

/**
 * The real implementations still run; they are wrapped so that two things can
 * be asserted that are otherwise invisible: which byte values a code was built
 * from, and whether a comparison went through the constant-time path.
 */
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    default: actual,
    randomBytes: vi.fn(actual.randomBytes),
    timingSafeEqual: vi.fn(actual.timingSafeEqual),
  };
});

/**
 * `randomBytes` is overloaded, and the callback form — which returns nothing —
 * is the one an unannotated mock resolves to. Naming the synchronous form is
 * what lets a byte sequence be posed for it.
 */
const randomBytesMock = vi.mocked(randomBytes as (size: number) => Buffer);

/** Every glyph that a projector at the back of a room turns into another one. */
const AMBIGUOUS = ['0', 'O', '1', 'I', 'L', 'U', 'A', 'B', 'G', 'S', 'T', 'Q', 'Z'];

describe('room codes', () => {
  it('excludes the glyphs that are misread off a screen', () => {
    for (const glyph of AMBIGUOUS) {
      expect(ROOM_CODE_ALPHABET).not.toContain(glyph);
    }
  });

  it('holds each character once, in upper case', () => {
    expect(ROOM_CODE_ALPHABET).toBe(ROOM_CODE_ALPHABET.toUpperCase());
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('has a length that divides a byte, which is what makes masking unbiased', () => {
    expect(ROOM_CODE_ALPHABET.length & (ROOM_CODE_ALPHABET.length - 1)).toBe(0);
    expect(256 % ROOM_CODE_ALPHABET.length).toBe(0);
  });

  /**
   * The property that matters: every one of the 256 values a random byte can
   * take maps to a character, and each character is reached by the same number
   * of them. A modulo over an alphabet of any other size fails this, and the
   * symptom is codes with a predictable first character.
   */
  it('maps every possible byte value to a character, evenly', () => {
    const everyByte = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
    randomBytesMock.mockReturnValueOnce(everyByte);

    const code = generateRoomCode(256);

    const counts = new Map<string, number>();
    for (const character of code) counts.set(character, (counts.get(character) ?? 0) + 1);
    expect(counts.size).toBe(ROOM_CODE_ALPHABET.length);
    for (const character of ROOM_CODE_ALPHABET) {
      expect(counts.get(character)).toBe(256 / ROOM_CODE_ALPHABET.length);
    }
  });

  it('generates codes of the asked-for length using only the alphabet', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(generateRoomCode(7)).toHaveLength(7);
    for (const character of code) expect(ROOM_CODE_ALPHABET).toContain(character);
  });

  it('reaches every character across many real codes', () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 500; attempt += 1) {
      for (const character of generateRoomCode()) seen.add(character);
    }
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
  });

  it('widens rather than looping forever when short codes are all taken', () => {
    const taken = (code: string): boolean => code.length === ROOM_CODE_LENGTH;
    expect(allocateRoomCode(taken).length).toBe(ROOM_CODE_LENGTH + 1);
  });

  it('allocates a code the registry does not already hold', () => {
    const used = new Set(['AAAAA']);
    const code = allocateRoomCode((candidate) => used.has(candidate));
    expect(used.has(code)).toBe(false);
  });
});

describe('normalising a typed code', () => {
  it('accepts the spacing and case a phone keyboard produces', () => {
    const code = generateRoomCode();
    expect(normaliseRoomCode(code.toLowerCase())).toBe(code);
    expect(normaliseRoomCode(` ${code.slice(0, 2)}-${code.slice(2)} `)).toBe(code);
  });

  it('rejects anything that is not a code', () => {
    expect(normaliseRoomCode('C0DE2')).toBeNull();
    expect(normaliseRoomCode('CDE')).toBeNull();
    expect(normaliseRoomCode('CDEFHJKMC')).toBeNull();
    expect(normaliseRoomCode(42)).toBeNull();
    expect(normaliseRoomCode(null)).toBeNull();
    expect(normaliseRoomCode(undefined)).toBeNull();
  });
});

describe('tokens', () => {
  it('issues distinct, url-safe secrets', () => {
    const tokens = new Set([
      generateSessionToken(),
      generateSessionToken(),
      generateHostToken(),
      generateHostToken(),
    ]);
    expect(tokens.size).toBe(4);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      // 256 bits of base64url, unpadded.
      expect(token).toHaveLength(43);
    }
  });

  it('issues distinct player ids', () => {
    expect(generatePlayerId()).not.toBe(generatePlayerId());
  });

  it('stores a digest rather than the token', () => {
    const token = generateSessionToken();
    const stored = hashToken(token);
    expect(stored).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(stored).not.toContain(token);
    expect(hashToken(token)).toBe(stored);
    expect(hashToken(generateSessionToken())).not.toBe(stored);
  });

  it('verifies the right token and refuses everything else', () => {
    const token = generateSessionToken();
    const stored = hashToken(token);
    expect(verifyToken(token, stored)).toBe(true);
    expect(verifyToken(generateSessionToken(), stored)).toBe(false);
    expect(verifyToken('', stored)).toBe(false);
    expect(verifyToken(undefined, stored)).toBe(false);
    expect(verifyToken({ token }, stored)).toBe(false);
  });

  /**
   * A comparison that returns early on the first differing character tells an
   * attacker how much of a guess was right, which turns guessing a token from
   * hopeless into a search one character deep at a time.
   */
  it('compares digests in constant time rather than character by character', () => {
    const stored = hashToken('the real one');
    const nearMiss = `0${stored.slice(1)}`;
    vi.mocked(timingSafeEqual).mockClear();

    expect(hashesEqual(nearMiss, stored)).toBe(false);

    expect(vi.mocked(timingSafeEqual)).toHaveBeenCalledTimes(1);
    const [left, right] = vi.mocked(timingSafeEqual).mock.calls[0] ?? [];
    expect(Buffer.from(left as ArrayBufferView as Buffer)).toHaveLength(stored.length);
    expect(Buffer.from(right as ArrayBufferView as Buffer)).toHaveLength(stored.length);
  });

  it('refuses a mismatched length without reaching the comparison', () => {
    // `timingSafeEqual` throws on unequal lengths, so the guard has to come
    // first; lengths are not a secret here, every digest is the same size.
    vi.mocked(timingSafeEqual).mockClear();
    expect(hashesEqual('short', hashToken('anything'))).toBe(false);
    expect(vi.mocked(timingSafeEqual)).not.toHaveBeenCalled();
  });

  it('verifies through the constant-time path', () => {
    const token = generateSessionToken();
    vi.mocked(timingSafeEqual).mockClear();
    expect(verifyToken(token, hashToken(token))).toBe(true);
    expect(vi.mocked(timingSafeEqual)).toHaveBeenCalledTimes(1);
  });
});
