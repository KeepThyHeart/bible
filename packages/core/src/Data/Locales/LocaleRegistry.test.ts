import { describe, it, expect } from 'vitest';
import {
  LOCALE_REGISTRY,
  resolveLocaleDescriptor,
  directionForTag,
  uiDirection,
  isKnownUiLocale,
} from './LocaleRegistry';

describe('LOCALE_REGISTRY', () => {
  it('lists every planned locale exactly once', () => {
    const tags = LOCALE_REGISTRY.map((d) => d.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toEqual([
      'en', 'zh-Hans', 'es', 'hi', 'ar', 'fr', 'ru', 'pt-BR', 'id', 'bn', 'ur', 'ja', 'vi', 'tr', 'he-IL', 'fa-IR',
    ]);
  });

  it('marks exactly the RTL locales', () => {
    const rtl = LOCALE_REGISTRY.filter((d) => d.direction === 'rtl').map((d) => d.tag);
    expect(rtl.sort()).toEqual(['ar', 'fa-IR', 'he-IL', 'ur']);
  });

  it('gives Persian native digits and Hebrew Latin digits by default', () => {
    expect(resolveLocaleDescriptor('fa-IR')).toMatchObject({ defaultDigitSystem: 'native', nativeNumberingSystem: 'arabext' });
    expect(resolveLocaleDescriptor('he-IL')).toMatchObject({ defaultDigitSystem: 'latin', script: 'Hebr' });
  });
});

describe('resolveLocaleDescriptor', () => {
  it('resolves an exact tag', () => {
    expect(resolveLocaleDescriptor('zh-Hans')?.englishName).toBe('Chinese (Simplified)');
  });

  it('resolves a region variant to its primary-subtag entry', () => {
    // The bug this fixes: `apps/web/src/i18n.ts` used to compare the exact
    // tag against a hard-coded RTL list, so `ar-EG` fell through to LTR.
    expect(resolveLocaleDescriptor('ar-EG')?.tag).toBe('ar');
    expect(resolveLocaleDescriptor('ar-EG')?.direction).toBe('rtl');
    expect(resolveLocaleDescriptor('ur-PK')?.direction).toBe('rtl');
  });

  it('returns undefined for an unplanned or malformed tag', () => {
    expect(resolveLocaleDescriptor('xx-pseudo')).toBeUndefined();
    expect(resolveLocaleDescriptor('klingon')).toBeUndefined();
  });
});

describe('directionForTag', () => {
  it('defaults to ltr for anything unresolved, never throws', () => {
    expect(directionForTag('xx-pseudo')).toBe('ltr');
    expect(directionForTag('')).toBe('ltr');
  });

  it('reports rtl for Arabic and Urdu, including region variants', () => {
    expect(directionForTag('ar')).toBe('rtl');
    expect(directionForTag('ar-EG')).toBe('rtl');
    expect(directionForTag('ur')).toBe('rtl');
  });
});

describe('RTL wave tags (task 0076)', () => {
  it('resolves a bare or other-region tag to the regional entry', () => {
    expect(resolveLocaleDescriptor('he')?.tag).toBe('he-IL');
    expect(resolveLocaleDescriptor('fa')?.tag).toBe('fa-IR');
    expect(resolveLocaleDescriptor('fa-AF')?.tag).toBe('fa-IR');
    expect(resolveLocaleDescriptor('HE-il')?.tag).toBe('he-IL');
    expect(resolveLocaleDescriptor('ar-SA')?.tag).toBe('ar');
  });

  it('uiDirection uses the registry first and the fallback only for unknown tags', () => {
    expect(uiDirection('he-IL')).toBe('rtl');
    expect(uiDirection('fa', 'ltr')).toBe('rtl');
    expect(uiDirection('en', 'rtl')).toBe('ltr');
    expect(uiDirection('xx-rtl', 'rtl')).toBe('rtl');
    expect(uiDirection('xx-pseudo')).toBe('ltr');
    expect(isKnownUiLocale('xx-rtl')).toBe(false);
    expect(isKnownUiLocale('ar-EG')).toBe(true);
  });
});
