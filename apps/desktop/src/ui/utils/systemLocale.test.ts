import { describe, it, expect } from 'vitest';
import { matchSystemLocale } from './systemLocale';

const OFFERED = ['en', 'es', 'ar', 'fa-IR', 'he-IL', 'hi', 'pt-BR', 'ru', 'zh-Hans', 'xx-pseudo', 'xx-rtl'];

describe('matchSystemLocale', () => {
  it.each([
    [['en-US'], 'en'],
    [['es-MX'], 'es'],
    [['pt-BR'], 'pt-BR'],
    [['pt-PT'], 'pt-BR'],
    [['pt'], 'pt-BR'],
    [['fa'], 'fa-IR'],
    [['he'], 'he-IL'],
    [['iw-IL'], 'he-IL'],
    [['zh-CN'], 'zh-Hans'],
    [['zh-SG'], 'zh-Hans'],
    [['zh'], 'zh-Hans'],
    [['ru_RU'], 'ru'],
    [['EN-gb'], 'en'],
  ])('%j -> %s', (preferred, expected) => {
    expect(matchSystemLocale(preferred, OFFERED)).toBe(expected);
  });

  it('does not offer Simplified Chinese for Traditional', () => {
    expect(matchSystemLocale(['zh-TW'], OFFERED)).toBeUndefined();
    expect(matchSystemLocale(['zh-Hant-HK'], OFFERED)).toBeUndefined();
  });

  it("follows the user's order, skipping languages we lack", () => {
    expect(matchSystemLocale(['fr-FR', 'ja', 'es-ES', 'en-US'], OFFERED)).toBe('es');
  });

  it('prefers the matching region when several share a language', () => {
    expect(matchSystemLocale(['pt-PT'], ['pt-BR', 'pt-PT'])).toBe('pt-PT');
    expect(matchSystemLocale(['pt-AO'], ['pt-BR', 'pt-PT'])).toBe('pt-BR');
  });

  it('returns undefined with no match, no preferences, or junk', () => {
    expect(matchSystemLocale(['ja-JP'], OFFERED)).toBeUndefined();
    expect(matchSystemLocale([], OFFERED)).toBeUndefined();
    expect(matchSystemLocale(['not a tag!'], OFFERED)).toBeUndefined();
  });

  it('never picks a pseudo-locale', () => {
    expect(matchSystemLocale(['xx-pseudo', 'xx'], OFFERED)).toBeUndefined();
  });
});
