import { describe, it, expect } from 'vitest';
import {
  JOIN_CODE_LENGTH,
  generateControlToken,
  generateJoinCode,
  generateSessionId,
  hashControlToken,
  isValidSessionId,
  normalizeJoinCode,
  verifyControlToken,
} from '../present/tokens';

const AMBIGUOUS = ['I', 'L', 'O', 'U'];

describe('join codes', () => {
  it('generates codes of the advertised length', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateJoinCode()).toHaveLength(JOIN_CODE_LENGTH);
    }
  });

  it('never emits a character people confuse when reading off a screen', () => {
    // The whole point of Crockford base32 here. A code containing O and 0, or
    // I and 1, is a code someone in the back row will type wrong.
    const sample = Array.from({ length: 500 }, generateJoinCode).join('');
    for (const ch of AMBIGUOUS) {
      expect(sample).not.toContain(ch);
    }
  });

  it('does not repeat itself over a realistic number of sessions', () => {
    const codes = new Set(Array.from({ length: 2000 }, generateJoinCode));
    expect(codes.size).toBe(2000);
  });

  it('accepts what people actually type', () => {
    const code = generateJoinCode();
    expect(normalizeJoinCode(code.toLowerCase())).toBe(code);
    expect(normalizeJoinCode(`${code.slice(0, 4)}-${code.slice(4)}`)).toBe(code);
    expect(normalizeJoinCode(` ${code} `)).toBe(code);
  });

  it('folds the Crockford ambiguities rather than rejecting them', () => {
    // Someone reading "1" as "I" should still reach the session.
    expect(normalizeJoinCode('I23456789'.slice(0, 8))).toBe('12345678');
    expect(normalizeJoinCode('OOOOOOOO')).toBe('00000000');
    expect(normalizeJoinCode('llllllll')).toBe('11111111');
  });

  it('rejects anything that cannot be a code', () => {
    expect(normalizeJoinCode('')).toBeNull();
    expect(normalizeJoinCode('SHORT')).toBeNull();
    expect(normalizeJoinCode('WAYTOOLONGCODE')).toBeNull();
    expect(normalizeJoinCode('ABCDEFG!')).toBeNull();
    // U is excluded from the alphabet outright, so it is not a typo we fold.
    expect(normalizeJoinCode('UUUUUUUU')).toBeNull();
    expect(normalizeJoinCode(null)).toBeNull();
    expect(normalizeJoinCode(12345678)).toBeNull();
  });
});

describe('session ids', () => {
  it('round-trips its own output', () => {
    for (let i = 0; i < 20; i++) {
      expect(isValidSessionId(generateSessionId())).toBe(true);
    }
  });

  it('rejects ids that could not have come from us', () => {
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('TOOSHORT')).toBe(false);
    expect(isValidSessionId('../../../etc/passwd')).toBe(false);
    expect(isValidSessionId('IIIIIIIIIIIIIIII')).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
  });

  it('is longer than a join code, so the two cannot be confused', () => {
    expect(generateSessionId().length).toBeGreaterThan(JOIN_CODE_LENGTH);
  });
});

describe('control tokens', () => {
  it('generates distinct, high-entropy tokens', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateControlToken));
    expect(tokens.size).toBe(500);
    // 32 random bytes in base64url.
    expect(generateControlToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('verifies a token against its own hash', () => {
    const token = generateControlToken();
    expect(verifyControlToken(token, hashControlToken(token))).toBe(true);
  });

  it('rejects every near miss', () => {
    const token = generateControlToken();
    const hash = hashControlToken(token);
    expect(verifyControlToken(generateControlToken(), hash)).toBe(false);
    expect(verifyControlToken(token.slice(0, -1), hash)).toBe(false);
    expect(verifyControlToken(`${token}x`, hash)).toBe(false);
    expect(verifyControlToken('', hash)).toBe(false);
    expect(verifyControlToken(undefined, hash)).toBe(false);
  });

  it('survives a stored hash that is not a hash', () => {
    // A corrupt row must answer "no", not throw on every request forever.
    const token = generateControlToken();
    expect(verifyControlToken(token, '')).toBe(false);
    expect(verifyControlToken(token, 'not-hex')).toBe(false);
    expect(verifyControlToken(token, 'ab')).toBe(false);
  });

  it('stores nothing that resembles the token itself', () => {
    const token = generateControlToken();
    expect(hashControlToken(token)).not.toContain(token);
    expect(hashControlToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
