/**
 * The Memory UI's translator on the web (lazy chunk). The Memory strings are one flat ICU catalog per locale, shared
 * with the desktop app (`apps/desktop/locales/<locale>/memory.json`, owned by the Memory UI): the web reads the same
 * files instead of keeping a copy, so both apps always show the same text. English is the fallback written in the
 * code, so `en` needs no catalog; a missing key or a failed load falls back to it too.
 */
import { formatMessage } from '@bible/memory/messages';
import type { Translate } from '@bible/memory/messages';

type Catalog = Record<string, string>;

/** Lazy per-locale catalogs (English and the pseudo locales are not bundled). */
const CATALOGS = import.meta.glob<{ default: Catalog }>([
  '../../../../desktop/locales/*/memory.json',
  '!../../../../desktop/locales/en/memory.json',
  '!../../../../desktop/locales/xx-*/memory.json',
]);

function catalogPath(locale: string): string | undefined {
  const exact = `../../../../desktop/locales/${locale}/memory.json`;
  if (exact in CATALOGS) return exact;
  const base = locale.split('-')[0];
  return Object.keys(CATALOGS).find((p) => p.split('/').at(-2)?.split('-')[0] === base);
}

/** A translator over a loaded catalog: catalog text (formatted with ICU params) or the English fallback. */
export function translatorFor(catalog: Catalog, locale: string): Translate {
  return (key, fallback, params) => {
    const text = catalog[key];
    return formatMessage(typeof text === 'string' && text !== '' ? text : fallback, params ?? {}, locale);
  };
}

/** Loads the catalog for `locale` (English: none). Never rejects: a failed load gives the English translator. */
export async function loadMemoryTranslator(locale: string): Promise<Translate> {
  const path = locale && !locale.startsWith('en') ? catalogPath(locale) : undefined;
  if (!path) return translatorFor({}, locale || 'en');
  try {
    const mod = await CATALOGS[path]();
    return translatorFor(mod.default ?? {}, locale);
  } catch (e) {
    console.warn('[memory] could not load translations:', e);
    return translatorFor({}, locale);
  }
}
