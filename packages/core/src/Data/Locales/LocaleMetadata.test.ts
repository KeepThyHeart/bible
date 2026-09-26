import { describe, it, expect } from 'vitest';
import { parseLocaleMeta } from './LocaleMetadata';

describe('parseLocaleMeta', () => {
  it('parses a well-formed meta.json', () => {
    const info = parseLocaleMeta('es', {
      'locale.name': 'Spanish',
      'locale.nativeName': 'Español',
      'locale.status': 'draft',
      'locale.direction': 'ltr',
    });
    expect(info).toEqual({
      code: 'es',
      name: 'Spanish',
      nativeName: 'Español',
      status: 'draft',
      direction: 'ltr',
    });
  });

  it('accepts the beta tier', () => {
    expect(parseLocaleMeta('ar', { 'locale.status': 'beta' }).status).toBe('beta');
  });

  it('treats a missing or malformed status as draft, never throws', () => {
    expect(parseLocaleMeta('xx', {}).status).toBe('draft');
    expect(parseLocaleMeta('xx', { 'locale.status': 'reviewed' }).status).toBe('draft');
  });

  it('falls back name/nativeName to the code when absent', () => {
    const info = parseLocaleMeta('fr', {});
    expect(info.name).toBe('fr');
    expect(info.nativeName).toBe('fr');
  });

  it('falls back nativeName to name when only name is present', () => {
    const info = parseLocaleMeta('fr', { 'locale.name': 'French' });
    expect(info.nativeName).toBe('French');
  });

  it('defaults direction to ltr for anything but the literal string "rtl"', () => {
    expect(parseLocaleMeta('en', {}).direction).toBe('ltr');
    expect(parseLocaleMeta('ar', { 'locale.direction': 'rtl' }).direction).toBe('rtl');
    expect(parseLocaleMeta('xx', { 'locale.direction': 'RTL' }).direction).toBe('ltr');
  });
});
