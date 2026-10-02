import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ICU from 'i18next-icu';
import { isolateMessageParams, loadReferenceLocales, LOCALE_REGISTRY, parseLocaleMeta, uiDirection } from '@bible/core/browser';
import type { LocaleMetadata } from '@bible/core/browser';

import ui from './locales/en/ui.json';
import books from './locales/en/books.json';
import booksShort from './locales/en/booksShort.json';
import modules from './locales/en/modules.json';
import help from './locales/en/help.json';
import enMeta from './locales/en/meta.json';

/**
 * Every i18next namespace this app ships. `meta` (locale identity - name,
 * nativeName, status, direction) is deliberately NOT here: it sits alongside
 * the namespace files in each locale folder (same convention as desktop's
 * `meta.json`) but is read directly by this module, never through `t()`.
 */
export const NAMESPACES = ['ui', 'books', 'booksShort', 'modules', 'help'] as const;
export type Namespace = (typeof NAMESPACES)[number];

export type { LocaleMetadata };
export type LocaleInfo = LocaleMetadata;

// ---------------------------------------------------------------------------
// Locale discovery: every `./locales/<code>/meta.json`, no hard-coded list.
// ---------------------------------------------------------------------------

/**
 * Every non-`en` locale's `meta.json`, eagerly - each is four short strings,
 * so loading every one up front (instead of lazily, like the namespace
 * catalogs below) costs nothing and is what lets the language picker list
 * every locale without having to switch into it first. `en`'s own is
 * imported separately below (it is already part of the app's initial
 * bundle); excluding it here avoids Vite warning that a statically-imported
 * module cannot also be split out via glob.
 */
const metaModules = import.meta.glob(['./locales/*/meta.json', '!./locales/en/meta.json', '!./locales/xx-*/meta.json'], {
  eager: true,
}) as Record<string, { default: Record<string, unknown> }>;
// Dev-only pseudo-locales (`xx-*`) are bundled only in DEV; the literal glob is tree-shaken from production.
if (import.meta.env.DEV) {
  Object.assign(
    metaModules,
    import.meta.glob(['./locales/xx-*/meta.json'], { eager: true }) as Record<string, { default: Record<string, unknown> }>,
  );
}

const LOCALE_INFOS = new Map<string, LocaleInfo>();
for (const [path, mod] of Object.entries(metaModules)) {
  // path looks like './locales/<code>/meta.json'.
  const code = path.split('/')[2];
  if (code) LOCALE_INFOS.set(code, parseLocaleMeta(code, mod.default));
}
// `en` ships inside the app bundle itself (imported eagerly above, same as
// every namespace); registering it here even if the glob above were ever
// narrowed keeps `availableLocaleInfos()` from ever coming back empty.
if (!LOCALE_INFOS.has('en')) {
  LOCALE_INFOS.set('en', parseLocaleMeta('en', enMeta as Record<string, unknown>));
}

/**
 * Every locale this build has a folder for, in the roadmap's order (see
 * `LOCALE_REGISTRY` in `@bible/core`), with anything the registry does not
 * know about (a locale added ahead of the registry, or a typo'd folder name)
 * sorted after it alphabetically rather than dropped.
 */
export function availableLocaleInfos(): LocaleInfo[] {
  const order = new Map(LOCALE_REGISTRY.map((d, i) => [d.tag, i]));
  return [...LOCALE_INFOS.values()].sort((a, b) => {
    const oa = order.get(a.code);
    const ob = order.get(b.code);
    if (oa !== undefined && ob !== undefined) return oa - ob;
    if (oa !== undefined) return -1;
    if (ob !== undefined) return 1;
    return a.code.localeCompare(b.code);
  });
}

/**
 * Locales offered in the language picker: the same three-tier rule as
 * desktop's `selectableLocales()` (`GeneralSection.tsx`) - `draft` is
 * withheld unless it is the currently active locale (so switching TO a draft
 * from outside this app, e.g. via `localStorage`, never locks a user out of
 * switching back), `beta` and `complete` are always offered. There is
 * deliberately no separate allowlist: promote a locale by editing its own
 * `meta.json` `locale.status`, and both this function and the picker that
 * calls it pick it up with no other code change.
 */
export function selectableLocaleInfos(activeCode?: string): LocaleInfo[] {
  return availableLocaleInfos().filter((info) => info.code === activeCode || info.status !== 'draft');
}

// ---------------------------------------------------------------------------
// Lazy loading: only `en` is bundled eagerly; every other locale's namespace
// catalogs are fetched (as a Vite chunk, not a network request to a server)
// the first time that locale is actually selected.
// ---------------------------------------------------------------------------

type NamespaceModule = { default: Record<string, unknown> };

/**
 * Lazy loaders for every `./locales/<code>/<namespace>.json` except `en`'s -
 * `en` is bundled eagerly above (both statically imported for the initial
 * paint and matched by this glob would just make Vite warn that it cannot
 * split an eagerly-imported module into its own chunk), and `loadedLocales`
 * already seeds `en` as loaded, so nothing would ever call this for it.
 */
const namespaceLoaders: Record<string, () => Promise<NamespaceModule>> = {
  ...import.meta.glob<NamespaceModule>(['./locales/*/*.json', '!./locales/en/*.json', '!./locales/xx-*/*.json']),
  // Dev-only pseudo-locales (`xx-*`) are bundled only in DEV.
  ...(import.meta.env.DEV ? import.meta.glob<NamespaceModule>(['./locales/xx-*/*.json']) : {}),
};

const loadedLocales = new Set<string>(['en']);

/**
 * Load every namespace catalog for `code` into i18next's resource store, if
 * it is not already loaded. Safe to call repeatedly, for a locale with no
 * shipped folder, or concurrently - later calls for an already-loaded or
 * in-flight locale are no-ops. `en` never needs this: it is bundled eagerly
 * above, exactly as it was before this module supported lazy locales.
 */
export async function ensureLocaleLoaded(code: string): Promise<void> {
  // Reference-parsing data (book names, separators, digits) for the language,
  // loaded on demand like the catalogs (task 0077); a no-op once loaded.
  const referenceData = loadReferenceLocales([code]);
  if (loadedLocales.has(code)) {
    await referenceData;
    return;
  }
  loadedLocales.add(code); // Claim it first so concurrent callers don't double-fetch.
  const results = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const loader = namespaceLoaders[`./locales/${code}/${ns}.json`];
      if (!loader) return null;
      const mod = await loader();
      return [ns, mod.default] as const;
    }),
  );
  const anyFound = results.some((r) => r !== null);
  if (!anyFound) {
    // No folder for this code at all - nothing to add, and nothing to mark
    // loaded either, in case a locale folder is dropped in later at runtime
    // (the desktop model of a user-supplied `<userData>/locales/` catalog
    // has no web equivalent yet, but this keeps the door open).
    loadedLocales.delete(code);
    await referenceData;
    return;
  }
  for (const entry of results) {
    if (entry) i18n.addResourceBundle(code, entry[0], entry[1], true, true);
  }
  await referenceData;
}

/**
 * Switch the active UI language, loading its catalogs first if they are not
 * already in memory. This is the one entry point the language picker should
 * use instead of calling `i18n.changeLanguage()` directly, so a lazily-loaded
 * locale's strings are actually present before react-i18next re-renders.
 */
export async function changeLocale(code: string): Promise<void> {
  await ensureLocaleLoaded(code);
  await i18n.changeLanguage(code);
  syncDocumentLang();
}

// ---------------------------------------------------------------------------
// Detection: only offer a tag this app actually plans to ship, and fall a
// region/script variant back to the nearest one this wave ships instead of
// straight to English (the "es-MX should behave like es" question from the
// globalization roadmap).
// ---------------------------------------------------------------------------

/**
 * Dev-only pseudo-locales (`xx-pseudo`, `xx-rtl`): any `xx-*` folder this
 * build has. Only ever honoured when `import.meta.env.DEV`; a production
 * build resolves them like any other unknown tag (to `en`).
 */
function devPseudoTags(): string[] {
  return import.meta.env.DEV ? [...LOCALE_INFOS.keys()].filter((c) => c.toLowerCase().startsWith('xx-')) : [];
}

const REGISTRY_TAGS = LOCALE_REGISTRY.map((d) => d.tag);
const SUPPORTED_TAGS = [...REGISTRY_TAGS, ...devPseudoTags()];

/**
 * Reduce a browser- or `localStorage`-reported tag to one this app ships,
 * before i18next tries to load it as the active language.
 *
 *  - An exact match against a shipped tag wins outright (`zh-Hans` stays
 *    `zh-Hans`, matched case-insensitively so `EN` and `en` are the same).
 *  - Otherwise, the *first* shipped tag sharing the same primary subtag wins
 *    (`es-MX` -> `es`; `pt-PT` -> `pt-BR`, since this wave only ships the
 *    Brazilian catalog; `zh-Hant` -> `zh-Hans` likewise).
 *  - Nothing shipped shares a primary subtag: `en`.
 *  - DEV builds only: an exact `xx-*` pseudo-locale tag that has a locale
 *    folder (`xx-rtl`) resolves to itself.
 *
 * Exported for unit testing and wired in as
 * `i18next-browser-languagedetector`'s `convertDetectedLanguage`, so this is
 * the *only* place that resolution logic lives - `i18n.language` downstream
 * is always already one of `SUPPORTED_TAGS`.
 */
export function resolveSupportedLng(detected: string): string {
  if (!detected) return 'en';
  const lower = detected.toLowerCase();
  // DEV builds only: an exact `xx-*` tag with a locale folder is selectable
  // (`?lng=xx-rtl`, `localStorage.i18nextLng = 'xx-rtl'`). Never in production.
  if (import.meta.env.DEV && lower.startsWith('xx-')) {
    const pseudo = devPseudoTags().find((t) => t.toLowerCase() === lower);
    if (pseudo) return pseudo;
  }
  const exact = REGISTRY_TAGS.find((t) => t.toLowerCase() === lower);
  if (exact) return exact;
  const primary = lower.split('-')[0];
  const byPrimary = REGISTRY_TAGS.find((t) => t.split('-')[0].toLowerCase() === primary);
  return byPrimary ?? 'en';
}

/**
 * i18next-icu with bidi isolation (task 0076): in an RTL UI, every string
 * param interpolated as `{name}` (module abbreviations, book names, search
 * terms, note titles) is wrapped in FSI...PDI so it cannot reorder the
 * sentence around it. `select`/`plural` args and i18next's own options are
 * left raw. LTR output is unchanged.
 */
class BidiIcu extends ICU {
  parse(res: string, options: Record<string, unknown>, lng: string, ns: string, key: string, info?: unknown): unknown {
    const params = options && typeof res === 'string' ? isolateMessageParams(res, options, uiDirectionFor(lng)) : options;
    // @ts-expect-error - i18next-icu's typings omit `parse`, which is its i18nFormat entry point.
    return super.parse(res, params, lng, ns, key, info);
  }
}

i18n
  .use(BidiIcu)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { ui, books, booksShort, modules, help },
    },
    fallbackLng: 'en',
    defaultNS: 'ui',
    ns: [...NAMESPACES],

    // Every language this build's picker can ever offer, so the detector and
    // `i18next`'s own lookups never settle on a tag with no shipped catalog
    // (or a partial one) at all - `convertDetectedLanguage` below has
    // already reduced whatever the browser reported to one of these.
    supportedLngs: SUPPORTED_TAGS,

    detection: {
      // `?lng=xx-rtl` (dev pseudo-locales) works only in DEV builds; the
      // resolver above maps it to `en` anywhere else.
      order: import.meta.env.DEV ? ['querystring', 'localStorage', 'navigator'] : ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage'],
      convertDetectedLanguage: resolveSupportedLng,
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

// The language the detector resolved to (via `convertDetectedLanguage`
// above) may not be `en`, whose catalogs are the only ones bundled eagerly
// into `resources` above. Load the rest before the app's first paint would
// otherwise show it - `main.tsx` awaits this via `ensureLocaleLoaded`
// directly; this call covers any other entry point (a test harness, a
// Storybook-style preview) that only imports this module.
if (i18n.language && i18n.language !== 'en') {
  void ensureLocaleLoaded(i18n.language);
}

/**
 * UI direction for a locale tag: the shared registry (`uiDirection`) is the
 * sole source for every planned locale, including region variants (`ar-EG`,
 * `fa-AF`) and bare tags (`he` -> `he-IL`). Only a tag the registry does not
 * know (the dev-only `xx-rtl` pseudo-locale) falls back to its own
 * `meta.json` `locale.direction`.
 */
export function uiDirectionFor(lng: string): 'ltr' | 'rtl' {
  return uiDirection(lng, LOCALE_INFOS.get(lng)?.direction ?? 'ltr');
}

/** Update the document's lang and dir attributes to match the current language */
export function syncDocumentLang(): void {
  const lng = i18n.language || 'en';
  document.documentElement.lang = lng;
  document.documentElement.dir = uiDirectionFor(lng);
  // Opt in to the KTH shaping rules (no letter-spacing / upper-casing of Arabic script).
  document.documentElement.setAttribute('data-kth-shaping', '');
}

i18n.on('languageChanged', syncDocumentLang);
// i18next resolves the detected language synchronously inside init() (the
// `en` resources are inline), so the initial 'languageChanged' fired before
// the listener above existed: apply the detected language's dir/lang now, or
// a reload in Arabic/Hebrew/Persian would render LTR chrome (task 0076).
if (typeof document !== 'undefined') syncDocumentLang();

export default i18n;
