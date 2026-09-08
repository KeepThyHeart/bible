/**
 * Unit tests for the main process's key resolution.
 *
 * The interesting cases are the ones that decide whether OS chrome - a window
 * title, a file dialog - shows words or a dotted key: an unknown key, a locale
 * the user picked that has no entry, and a placeholder with nothing to fill it.
 * All three are reachable in a shipped build, and none of them may put a key in
 * front of a reader if the English exists.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { t, setMainLocale, getMainLocale, resetMainI18nForTests } from './MainI18n';

describe('MainI18n', () => {
  beforeEach(() => {
    resetMainI18nForTests();
  });

  it('resolves a key from the English catalog on disk', () => {
    // Loaded lazily by `t()`, so this also covers the "nobody called
    // loadMainCatalogs() first" path that a mis-ordered startup would hit.
    expect(t('main.dialog.saveBackup')).toBe('Save Backup File');
  });

  it('substitutes named placeholders', () => {
    expect(t('main.window.bible', { translation: 'KJV' })).toBe('Bible - KJV');
  });

  it('leaves a placeholder alone when no value is supplied for it', () => {
    // Better a visible `{translation}` than an empty title bar or the string
    // "undefined", both of which look like a crash to a user.
    expect(t('main.window.bible', { other: 'x' })).toBe('Bible - {translation}');
  });

  it('returns the key itself for an unknown key, not a bracketed form', () => {
    // `[some.key]` in a window title reads as part of the name; the bare key at
    // least tells whoever reports it what to search for.
    expect(t('main.nope.notAKey')).toBe('main.nope.notAKey');
  });

  it('falls back to English for a locale that has no entry', () => {
    setMainLocale('es');
    expect(t('main.dialog.saveBackup')).toBe('Save Backup File');
  });

  it('ignores a locale code that is not a plain identifier', () => {
    // The value crosses IPC from the renderer and is used to index a map and,
    // in `i18nHandlers`, to build a path.
    setMainLocale('../../etc');
    expect(getMainLocale()).toBe('en');
  });

  it('accepts a region-tagged locale', () => {
    setMainLocale('pt-BR');
    expect(getMainLocale()).toBe('pt-BR');
  });
});
