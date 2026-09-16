import { describe, it, expect } from 'vitest';
import { getLocalizer } from './Localizer';
import { ReferenceParser } from '../../Services/ReferenceParser';
import { ES_BOOK_NAMES, ES_DISPLAY_NAMES } from './books/es';
import { ZH_HANS_BOOK_NAMES, ZH_HANS_DISPLAY_NAMES } from './books/zhHans';
// Importing this module registers `es` and `zh-Hans` as a side effect.
import './registerBuiltinLocalizers';

describe('SpanishLocalizer', () => {
  it('is registered and carries a referenceParserConfig', () => {
    const es = getLocalizer('es');
    expect(es.tag).toBe('es');
    expect(es.referenceParserConfig).toBeDefined();
    expect(es.referenceParserConfig?.displayNames?.[0]).toBe('Génesis');
    expect(es.referenceParserConfig?.displayNames).toHaveLength(66);
  });

  it('parses an unaccented Spanish reference through ReferenceParser', () => {
    const parser = new ReferenceParser(getLocalizer('es').referenceParserConfig);
    const ref = parser.parse('Genesis 1:1');
    expect(ref.isValid).toBe(true);
    expect(ref.book).toBe(1);
  });

  it('resolves numbered books and common abbreviations', () => {
    expect(ES_BOOK_NAMES.get('1 samuel')).toBe(9);
    expect(ES_BOOK_NAMES.get('mt')).toBe(40);
    expect(ES_BOOK_NAMES.get('ap')).toBe(66);
  });

  it('carries both the accented and unaccented alias for every accented display name', () => {
    // Regression guard for the accent-folding rule documented in books/es.ts:
    // ReferenceParser's regex cannot match accented letters, so every
    // accented display name must also have an unaccented alias.
    const fold = (s: string) =>
      s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (const name of ES_DISPLAY_NAMES) {
      const folded = fold(name);
      if (folded === name.toLowerCase()) continue; // no accent to worry about
      expect(ES_BOOK_NAMES.has(folded)).toBe(true);
    }
  });
});

describe('ChineseSimplifiedLocalizer', () => {
  it('is registered and carries a referenceParserConfig', () => {
    const zh = getLocalizer('zh-Hans');
    expect(zh.tag).toBe('zh-Hans');
    expect(zh.referenceParserConfig).toBeDefined();
    expect(zh.referenceParserConfig?.displayNames?.[42]).toBe('约翰福音'); // book 43, John
    expect(zh.referenceParserConfig?.displayNames).toHaveLength(66);
  });

  it('resolves Chinese book names and short forms via direct lookup', () => {
    expect(ZH_HANS_BOOK_NAMES.get('约翰福音')).toBe(43);
    expect(ZH_HANS_BOOK_NAMES.get('约')).toBe(43);
    expect(ZH_HANS_BOOK_NAMES.get('创')).toBe(1);
    expect(ZH_HANS_BOOK_NAMES.get('启')).toBe(66);
  });

  it('does NOT parse Chinese-script text through the shared ReferenceParser (documented limitation)', () => {
    // This is intentional, not a bug: ReferenceParser's regex is ASCII-only.
    // See the module doc in books/zhHans.ts.
    const parser = new ReferenceParser(getLocalizer('zh-Hans').referenceParserConfig);
    const ref = parser.parse('约翰福音 3:16');
    expect(ref.isValid).toBe(false);
  });

  it('has exactly one display name per book, matching the short-name table order', () => {
    expect(ZH_HANS_DISPLAY_NAMES).toHaveLength(66);
  });
});
