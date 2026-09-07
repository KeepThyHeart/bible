import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

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

/** Update the document's lang and dir attributes to match the current language */
export function syncDocumentLang(): void {
  const lng = i18n.language || 'en';
  document.documentElement.lang = lng;
  // RTL support: set dir attribute for RTL languages
  const rtlLangs = ['ar', 'he', 'fa', 'ur'];
  document.documentElement.dir = rtlLangs.includes(lng) ? 'rtl' : 'ltr';
}

i18n.on('languageChanged', syncDocumentLang);

export default i18n;
