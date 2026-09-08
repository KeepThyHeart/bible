import { describe, it, expect } from 'vitest';
import { directionForLanguage, isRtlLanguage } from './textDirection';

describe('directionForLanguage', () => {
  it('reports the RTL scripture languages as rtl', () => {
    for (const code of ['ar', 'he', 'fa', 'ur', 'syr', 'arc']) {
      expect(directionForLanguage(code)).toBe('rtl');
    }
  });

  it('reports Latin/Greek/CJK module languages as ltr', () => {
    for (const code of ['en', 'es', 'pt-BR', 'ru', 'el', 'grc', 'zh-Hans', 'hi']) {
      expect(directionForLanguage(code)).toBe('ltr');
    }
  });

  it('ignores region and case in the tag', () => {
    expect(directionForLanguage('AR-EG')).toBe('rtl');
    expect(directionForLanguage('he_IL')).toBe('rtl');
    expect(directionForLanguage('en_US')).toBe('ltr');
  });

  it('honours an RTL script subtag over the language subtag', () => {
    // Azerbaijani/Kurdish/Punjabi are written in both directions depending on
    // the script, so the script subtag has to win.
    expect(directionForLanguage('pa-Arab')).toBe('rtl');
    expect(directionForLanguage('ku-Latn')).toBe('ltr');
  });

  it('falls back to ltr for missing or unknown codes', () => {
    expect(directionForLanguage(undefined)).toBe('ltr');
    expect(directionForLanguage(null)).toBe('ltr');
    expect(directionForLanguage('')).toBe('ltr');
    expect(directionForLanguage('qqq')).toBe('ltr');
  });

  it('isRtlLanguage mirrors directionForLanguage', () => {
    expect(isRtlLanguage('ar')).toBe(true);
    expect(isRtlLanguage('en')).toBe(false);
  });
});
