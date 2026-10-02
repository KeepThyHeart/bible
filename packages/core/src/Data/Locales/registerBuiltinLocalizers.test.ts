import { describe, it, expect, beforeAll } from 'vitest';
import { getLocalizer } from './Localizer';
import { ReferenceParser } from '../../Services/ReferenceParser';
import { loadReferenceLocales } from '../../Reference/registry';
import './registerBuiltinLocalizers';

// Locale data loads on demand (task 0077); the apps load the UI language at startup.
beforeAll(async () => {
  await loadReferenceLocales(['es', 'zh-Hans']);
});

describe('SpanishLocalizer', () => {
  it('carries a referenceParserConfig once the Spanish data is loaded', () => {
    const es = getLocalizer('es');
    expect(es.tag).toBe('es');
    expect(es.referenceParserConfig).toBeDefined();
    expect(es.referenceParserConfig?.displayNames?.[0]).toBe('Génesis');
    expect(es.referenceParserConfig?.displayNames).toHaveLength(66);
    expect(es.referenceParserConfig?.locale).toBe('es');
  });

  it('parses Spanish references with and without accents', () => {
    const parser = new ReferenceParser(getLocalizer('es').referenceParserConfig);
    expect(parser.parse('Genesis 1:1').book).toBe(1);
    expect(parser.parse('Génesis 1:1').book).toBe(1);
    expect(parser.parse('Éxodo 20:3').book).toBe(2);
    expect(parser.parse('Primera de Corintios 13:4').book).toBe(46);
  });

  it('resolves numbered books and common abbreviations', () => {
    const names = getLocalizer('es').referenceParserConfig!.bookNames!;
    expect(names.get('1 samuel')).toBe(9);
    expect(names.get('mt')).toBe(40);
    expect(names.get('ap')).toBe(66);
  });

  it('still accepts English input and shows Spanish names', () => {
    const parser = new ReferenceParser(getLocalizer('es').referenceParserConfig);
    const ref = parser.parse('John 3:16');
    expect(ref.book).toBe(43);
    expect(parser.format(ref)).toBe('Juan 3:16');
  });
});

describe('ChineseSimplifiedLocalizer', () => {
  it('carries a referenceParserConfig once the Chinese data is loaded', () => {
    const zh = getLocalizer('zh-Hans');
    expect(zh.tag).toBe('zh-Hans');
    expect(zh.referenceParserConfig).toBeDefined();
    expect(zh.referenceParserConfig?.displayNames?.[42]).toBe('约翰福音'); // book 43, John
    expect(zh.referenceParserConfig?.displayNames).toHaveLength(66);
  });

  it('resolves Chinese book names and short forms via direct lookup', () => {
    const parser = new ReferenceParser(getLocalizer('zh-Hans').referenceParserConfig);
    expect(parser.getBookNumber('约翰福音')).toBe(43);
    expect(parser.getBookNumber('约')).toBe(43);
    expect(parser.getBookNumber('创')).toBe(1);
    expect(parser.getBookNumber('启')).toBe(66);
  });

  it('parses Chinese-script references, with or without spaces and in 章/节 form', () => {
    const parser = new ReferenceParser(getLocalizer('zh-Hans').referenceParserConfig);
    for (const input of ['约翰福音 3:16', '约翰福音3:16', '约3：16', '约翰福音3章16节']) {
      const ref = parser.parse(input);
      expect(ref.isValid, input).toBe(true);
      expect(ref.book).toBe(43);
      expect(ref.verse).toBe(16);
    }
    expect(parser.format(parser.parse('约3:16'))).toBe('约翰福音3:16');
  });

  it('a region tag resolves to the script data (zh-CN -> zh-Hans)', () => {
    expect(getLocalizer('zh-CN').referenceParserConfig?.locale).toBe('zh-Hans');
  });
});

describe('a language with no data', () => {
  it('has no referenceParserConfig, so callers fall back to English', () => {
    expect(getLocalizer('fr').referenceParserConfig).toBeUndefined();
  });
});
