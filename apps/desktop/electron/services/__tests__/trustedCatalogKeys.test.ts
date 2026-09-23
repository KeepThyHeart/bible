import { describe, it, expect } from 'vitest';

import {
  OFFICIAL_CATALOG_URL_PREFIXES,
  OFFICIAL_PUBLIC_KEYS,
  isSignatureRequired,
  officialCatalogScope,
  resolveExpectedKeys,
} from '../trustedCatalogKeys';

const OFFICIAL_URL = `${OFFICIAL_CATALOG_URL_PREFIXES[0]}catalog.json`;
const THIRD_PARTY_URL = 'https://example.org/catalog.json';
const RECORDED_KEY = 'ab'.repeat(32);
const APPROVED_KEY = 'cd'.repeat(32);

describe('OFFICIAL_PUBLIC_KEYS', () => {
  it('holds only well-formed, distinct Ed25519 keys', () => {
    // A typo here would make every official catalog fail verification.
    for (const key of OFFICIAL_PUBLIC_KEYS) {
      expect(key).toMatch(/^[0-9a-f]{64}$/i);
    }
    const distinct = new Set(OFFICIAL_PUBLIC_KEYS.map((key) => key.toLowerCase()));
    expect(distinct.size).toBe(OFFICIAL_PUBLIC_KEYS.length);
  });
});

describe('resolveExpectedKeys', () => {
  it('pins every official key, not just the first, ignoring the recorded key', () => {
    expect(resolveExpectedKeys(OFFICIAL_URL, RECORDED_KEY)).toEqual(OFFICIAL_PUBLIC_KEYS);
  });

  it('matches the official prefix case-insensitively', () => {
    expect(resolveExpectedKeys(OFFICIAL_URL.toUpperCase())).toEqual(OFFICIAL_PUBLIC_KEYS);
  });

  it('uses the recorded key for other catalogs', () => {
    expect(resolveExpectedKeys(THIRD_PARTY_URL, RECORDED_KEY)).toEqual([RECORDED_KEY]);
  });

  it('accepts any key on first use of other catalogs', () => {
    expect(resolveExpectedKeys(THIRD_PARTY_URL)).toBeUndefined();
  });

  it('adds keys the user approved to the pinned set for the official catalog', () => {
    expect(resolveExpectedKeys(OFFICIAL_URL, RECORDED_KEY, [APPROVED_KEY])).toEqual([
      ...OFFICIAL_PUBLIC_KEYS,
      APPROVED_KEY,
    ]);
  });

  it('ignores approved keys for other catalogs', () => {
    expect(resolveExpectedKeys(THIRD_PARTY_URL, RECORDED_KEY, [APPROVED_KEY])).toEqual([RECORDED_KEY]);
  });
});

describe('officialCatalogScope', () => {
  it('names the official prefix a URL falls under', () => {
    expect(officialCatalogScope(OFFICIAL_URL)).toBe(OFFICIAL_CATALOG_URL_PREFIXES[0]);
  });

  it('is undefined for any other URL', () => {
    expect(officialCatalogScope(THIRD_PARTY_URL)).toBeUndefined();
  });
});

describe('isSignatureRequired', () => {
  it('requires the official catalog to be signed', () => {
    expect(isSignatureRequired(OFFICIAL_URL, false)).toBe(true);
  });

  it('requires other catalogs to stay signed once they have been', () => {
    expect(isSignatureRequired(THIRD_PARTY_URL, false)).toBe(false);
    expect(isSignatureRequired(THIRD_PARTY_URL, true)).toBe(true);
  });
});
