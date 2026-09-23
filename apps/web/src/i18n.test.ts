import { describe, it, expect, beforeEach } from 'vitest';
import i18n, {
  syncDocumentLang,
  resolveSupportedLng,
  availableLocaleInfos,
  selectableLocaleInfos,
  ensureLocaleLoaded,
  changeLocale,
} from './i18n';

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

/**
 * `resolveSupportedLng` is what `i18next-browser-languagedetector`'s
 * `convertDetectedLanguage` calls before i18next ever sees the tag, so this
 * is the single place the "es-MX should behave like es" roadmap question is
 * answered - see `apps/desktop/locales/README.md`.
 */
describe('resolveSupportedLng', () => {
  it('keeps an exact shipped tag, case-insensitively', () => {
    expect(resolveSupportedLng('en')).toBe('en');
    expect(resolveSupportedLng('EN')).toBe('en');
    expect(resolveSupportedLng('zh-Hans')).toBe('zh-Hans');
  });

  it('falls a region variant back to the shipped tag for that language', () => {
    expect(resolveSupportedLng('en-GB')).toBe('en');
    expect(resolveSupportedLng('es-MX')).toBe('es');
  });

  it('falls a variant of a language shipped only under a specific region/script back to it', () => {
    // This wave ships only the Brazilian Portuguese and Simplified Chinese
    // catalogs - a European Portuguese or Traditional Chinese browser still
    // gets the nearest shipped catalog rather than falling straight to
    // English.
    expect(resolveSupportedLng('pt-PT')).toBe('pt-BR');
    expect(resolveSupportedLng('zh-Hant')).toBe('zh-Hans');
  });

  it('falls back to English for a language with no shipped catalog at all, and for empty input', () => {
    expect(resolveSupportedLng('he')).toBe('en');
    expect(resolveSupportedLng('')).toBe('en');
  });
});

describe('availableLocaleInfos / selectableLocaleInfos', () => {
  it('always includes English, complete and never withheld', () => {
    const infos = availableLocaleInfos();
    const en = infos.find((i) => i.code === 'en');
    expect(en).toBeDefined();
    expect(en?.status).toBe('complete');
    expect(en?.direction).toBe('ltr');
    expect(selectableLocaleInfos().some((i) => i.code === 'en')).toBe(true);
  });

  it('orders known locales by the shared roadmap order', () => {
    const codes = availableLocaleInfos().map((i) => i.code);
    // `en` is first in LOCALE_REGISTRY; whatever else this build ships stays
    // in registry order after it.
    expect(codes[0]).toBe('en');
  });
});

describe('ensureLocaleLoaded', () => {
  it('is a no-op for the already-bundled `en`', async () => {
    await expect(ensureLocaleLoaded('en')).resolves.toBeUndefined();
  });

  it('does nothing for a code with no shipped locale folder, and never throws', async () => {
    await expect(ensureLocaleLoaded('xx-does-not-exist')).resolves.toBeUndefined();
    expect(i18n.getResourceBundle('xx-does-not-exist', 'ui')).toBeFalsy();
  });

  it('is safe to call concurrently for the same code', async () => {
    await expect(
      Promise.all([ensureLocaleLoaded('en'), ensureLocaleLoaded('en')]),
    ).resolves.toBeDefined();
  });
});

describe('changeLocale', () => {
  it('switches the active language and re-syncs the document direction', async () => {
    const original = i18n.language;
    try {
      await changeLocale('en');
      expect(i18n.language).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
    } finally {
      await i18n.changeLanguage(original);
    }
  });
});
