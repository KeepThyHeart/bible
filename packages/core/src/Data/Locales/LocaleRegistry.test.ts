import { describe, it, expect } from 'vitest';
import {
  LOCALE_REGISTRY,
  resolveLocaleDescriptor,
  directionForTag,
} from './LocaleRegistry';

describe('LOCALE_REGISTRY', () => {
  it('lists every planned locale exactly once', () => {
    const tags = LOCALE_REGISTRY.map((d) => d.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toEqual([
      'en', 'zh-Hans', 'es', 'hi', 'ar', 'fr', 'ru', 'pt-BR', 'id', 'bn', 'ur', 'ja', 'vi', 'tr',
    ]);
  });

  it('marks exactly the two RTL locales', () => {
    const rtl = LOCALE_REGISTRY.filter((d) => d.direction === 'rtl').map((d) => d.tag);
    expect(rtl.sort()).toEqual(['ar', 'ur']);
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
