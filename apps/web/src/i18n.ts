import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { directionForTag } from '@bible/core/browser';

import ui from './locales/en/ui.json';
import books from './locales/en/books.json';
import booksShort from './locales/en/booksShort.json';
import modules from './locales/en/modules.json';
import help from './locales/en/help.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { ui, books, booksShort, modules, help },
    },
    fallbackLng: 'en',
    defaultNS: 'ui',
    ns: ['ui', 'books', 'booksShort', 'modules', 'help'],

    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
    },

    interpolation: {
      // Preact already escapes — except at a `dangerouslySetInnerHTML` sink,
      // which is exactly where it does not. Several help and settings strings
      // carry markup and are rendered that way; those are safe because their
      // text is ours. A string that interpolates a *value* into such a sink is
      // not: `search.noKeywordResults` takes a module abbreviation, which comes
      // from a third-party module's metadata. Pass any such string through
      // `utils/sanitize` at the sink.
      escapeValue: false,
    },

    // Fall back to English for missing keys so partial translations are usable
    missingKeyHandler: import.meta.env.DEV
      ? (_lngs: readonly string[], _ns: string, key: string) => {
          console.warn(`[i18n] Missing key: ${key}`);
        }
      : false,
  });

/**
 * Languages this app has no planned locale for (see `@bible/core`'s
 * `LOCALE_REGISTRY`) but that a browser can still report via
 * `navigator.language`, and that are genuinely RTL - kept as a fallback so
 * the document direction is still correct even with no catalog to match.
 */
const OTHER_RTL_LANGUAGES = ['he', 'fa'];

/** Update the document's lang and dir attributes to match the current language */
export function syncDocumentLang(): void {
  const lng = i18n.language || 'en';
  document.documentElement.lang = lng;
  // RTL support: resolved through the shared locale registry, which matches
  // on the primary subtag - so a region variant like `ar-EG` still resolves
  // to Arabic's `rtl` direction instead of silently falling through to ltr.
  const primary = lng.split('-')[0];
  const isRtl = directionForTag(lng) === 'rtl' || OTHER_RTL_LANGUAGES.includes(primary);
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
}

i18n.on('languageChanged', syncDocumentLang);

export default i18n;
