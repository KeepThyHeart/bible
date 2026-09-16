import { describe, it, expect, beforeEach } from 'vitest';
import i18n, { syncDocumentLang } from './i18n';

/**
 * `syncDocumentLang()` used to compare the exact language tag against a
 * hard-coded RTL list (`['ar', 'he', 'fa', 'ur']`), so a region variant like
 * `ar-EG` silently stayed LTR - a bug flagged in the globalization audit.
 * It now resolves through `@bible/core`'s shared locale registry, which
 * matches on the primary subtag.
 */
describe('syncDocumentLang', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
  });

  function withLanguage(lng: string, run: () => void) {
    const original = i18n.language;
    i18n.language = lng;
    try {
      run();
    } finally {
      i18n.language = original;
    }
  }

  it('sets ltr for English', () => {
    withLanguage('en', () => {
      syncDocumentLang();
      expect(document.documentElement.dir).toBe('ltr');
      expect(document.documentElement.lang).toBe('en');
    });
  });

  it('sets rtl for a bare Arabic tag', () => {
    withLanguage('ar', () => {
      syncDocumentLang();
      expect(document.documentElement.dir).toBe('rtl');
    });
  });

  it('sets rtl for an Arabic region variant (the ar-EG regression)', () => {
    withLanguage('ar-EG', () => {
      syncDocumentLang();
      expect(document.documentElement.dir).toBe('rtl');
    });
  });

  it('sets rtl for Urdu, including a region variant', () => {
    withLanguage('ur-PK', () => {
      syncDocumentLang();
      expect(document.documentElement.dir).toBe('rtl');
    });
  });

  it('still treats Hebrew and Farsi as rtl even though this app has no locale for them', () => {
    withLanguage('he', () => {
      syncDocumentLang();
      expect(document.documentElement.dir).toBe('rtl');
    });
    withLanguage('fa-IR', () => {
      syncDocumentLang();
      expect(document.documentElement.dir).toBe('rtl');
    });
  });
});
