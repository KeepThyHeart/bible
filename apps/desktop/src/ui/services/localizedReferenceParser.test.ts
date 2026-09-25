import { describe, it, expect } from 'vitest';
import { getLocalizedReferenceParser } from './localizedReferenceParser';

describe('getLocalizedReferenceParser', () => {
  it('returns a working parser for en that parses "John 3:16"', () => {
    const parser = getLocalizedReferenceParser('en');
    const parsed = parser.parse('John 3:16');
    expect(parsed.isValid).toBe(true);
    expect(parsed.book).toBe(43);
    expect(parsed.chapter).toBe(3);
    expect(parsed.verse).toBe(16);
  });

  it('falls back to English parsing for an unregistered locale tag', () => {
    // 'es' is deliberately NOT used here: this branch already ships a drafted
    // Spanish referenceParserConfig (see registerBuiltinLocalizers.ts), so
    // 'es' no longer exercises the fallback. 'zz' names no real language and
    // has no registered Localizer, so it always falls through to the
    // Intl-only default with an undefined referenceParserConfig.
    const parser = getLocalizedReferenceParser('zz');
    const parsed = parser.parse('John 3:16');
    expect(parsed.isValid).toBe(true);
    expect(parsed.book).toBe(43);
    expect(parsed.chapter).toBe(3);
    expect(parsed.verse).toBe(16);
  });

  it('caches and returns the same instance for the same tag', () => {
    const first = getLocalizedReferenceParser('en');
    const second = getLocalizedReferenceParser('en');
    expect(first).toBe(second);
  });
});
