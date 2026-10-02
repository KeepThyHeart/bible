import { describe, it, expect } from 'vitest';
import { ensureReferenceLocales, getLocalizedReferenceParser, setExtraReferenceLocales } from './localizedReferenceParser';

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

  it('parses the UI language once its data has loaded, and still accepts English', async () => {
    await ensureReferenceLocales(['zh-Hans', 'es']);
    const zh = getLocalizedReferenceParser('zh-Hans');
    expect(zh.parse('约翰福音3:16').book).toBe(43);
    expect(zh.parse('John 3:16').book).toBe(43);
    expect(zh.format(zh.parse('John 3:16'))).toBe('约翰福音3:16');
    expect(getLocalizedReferenceParser('es').parse('Génesis 1:1').book).toBe(1);
  });

  it('also accepts the installed Bibles\' languages, still showing UI-language names', async () => {
    expect(getLocalizedReferenceParser('en').parse('Juan 3:16').fuzzyMatch).toBeTruthy(); // only a typo guess before
    setExtraReferenceLocales(['es']);
    await ensureReferenceLocales(['es']);
    const parser = getLocalizedReferenceParser('en');
    const ref = parser.parse('Juan 3:16');
    expect(ref.book).toBe(43);
    expect(ref.fuzzyMatch).toBeUndefined();
    expect(parser.format(ref)).toBe('John 3:16');
    setExtraReferenceLocales([]);
  });
});
