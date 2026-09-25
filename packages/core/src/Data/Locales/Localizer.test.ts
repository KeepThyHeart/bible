import { describe, it, expect, afterEach } from 'vitest';
import {
  EnglishLocalizer,
  createIntlLocalizer,
  getLocalizer,
  registerLocalizer,
} from './Localizer';

describe('EnglishLocalizer', () => {
  it('carries the real English book-name table, not a stub', () => {
    expect(EnglishLocalizer.referenceParserConfig?.displayNames?.length).toBe(66);
    expect(EnglishLocalizer.referenceParserConfig?.bookNames?.get('genesis')).toBe(1);
  });

  it('is ltr with Western digits by default', () => {
    expect(EnglishLocalizer.direction).toBe('ltr');
    expect(EnglishLocalizer.defaultDigitSystem).toBe('latin');
  });
});

describe('getLocalizer', () => {
  it('never returns undefined and never throws for an unplanned tag', () => {
    expect(() => getLocalizer('xx-pseudo')).not.toThrow();
    expect(getLocalizer('xx-pseudo')).toBeTruthy();
  });

  it('falls back to a generic Intl-backed localizer for a planned tag with no custom class registered', () => {
    // `fr` has no `registerLocalizer()` call anywhere yet - this is exactly
    // the "infrastructure works before any language-specific class exists"
    // case the interface is for.
    const fr = getLocalizer('fr');
    expect(fr.tag).toBe('fr');
    expect(fr.direction).toBe('ltr');
    expect(fr.referenceParserConfig).toBeUndefined();
    expect(fr.formatNumber(1234.5)).toContain('234');
  });

  it('reads direction and digit defaults from the shared locale registry for Arabic', () => {
    const ar = getLocalizer('ar');
    expect(ar.direction).toBe('rtl');
    expect(ar.defaultDigitSystem).toBe('native');
  });

  it('resolves a region variant through its primary subtag', () => {
    expect(getLocalizer('ar-EG').direction).toBe('rtl');
  });
});

describe('registerLocalizer', () => {
  afterEach(() => {
    // Restore the generic fallback so this test cannot leak into others.
    registerLocalizer(createIntlLocalizer('es'));
  });

  it('lets a language plug in a fuller Localizer that getLocalizer then returns', () => {
    const custom = createIntlLocalizer('es', {
      referenceParserConfig: { displayNames: Array(66).fill('Libro') },
    });
    registerLocalizer(custom);
    expect(getLocalizer('es')).toBe(custom);
    expect(getLocalizer('es').referenceParserConfig?.displayNames?.[0]).toBe('Libro');
  });
});

describe('formatNumber digit systems', () => {
  it('renders Western digits when digitSystem is "latin"', () => {
    const ar = getLocalizer('ar');
    expect(ar.formatNumber(316, { digitSystem: 'latin' })).toBe('316');
  });

  it("renders Arabic-Indic digits for Arabic's native default", () => {
    const ar = getLocalizer('ar');
    const native = ar.formatNumber(316);
    expect(native).not.toBe('316');
    expect(/[٠-٩]/.test(native)).toBe(true);
  });

  it('lets a call override the locale default in either direction', () => {
    const en = getLocalizer('en');
    expect(en.defaultDigitSystem).toBe('latin');
    // en has no native numbering system, so a "native" override degrades to latn.
    expect(en.formatNumber(316, { digitSystem: 'native' })).toBe('316');
  });
});

describe('collation and case (Turkish dotted/dotless I)', () => {
  it('uppercases "i" to the dotted İ under Turkish rules, not ASCII "I"', () => {
    const tr = getLocalizer('tr');
    expect(tr.toLocaleUpperCase('i')).toBe('İ');
    expect(tr.toLocaleLowerCase('I')).toBe('ı');
  });

  it('plain English case folding is unaffected', () => {
    const en = getLocalizer('en');
    expect(en.toLocaleUpperCase('i')).toBe('I');
  });

  it('exposes locale-aware comparison for user-visible sorting', () => {
    const en = getLocalizer('en');
    expect(en.compare('a', 'b')).toBeLessThan(0);
  });
});
