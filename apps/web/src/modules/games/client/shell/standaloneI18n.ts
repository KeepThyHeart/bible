/**
 * A minimal i18next instance for the phone page, which must not load the
 * reader's `i18n.ts` (that pulls the whole `ui` catalogue). It carries only the
 * `games` catalogue, fetched for the phone's language as a lazy chunk, and
 * falls back to English. The language is the reader's saved choice when there
 * is one (`localStorage['i18nextLng']`), else the browser's.
 */
import { createInstance } from 'i18next';
import { setGamesI18n } from './t.js';

type Catalog = { default: Record<string, unknown> };

// One lazy chunk per locale; Vite resolves the glob at build time.
const loaders = import.meta.glob<Catalog>('../../../../locales/*/games.json');

function pickLocale(): string {
  const wanted: string[] = [];
  try {
    const saved = localStorage.getItem('i18nextLng');
    if (saved) wanted.push(saved);
  } catch {
    /* private mode */
  }
  if (typeof navigator !== 'undefined') wanted.push(...(navigator.languages ?? [navigator.language]));
  const available = new Set(Object.keys(loaders).map((path) => /locales\/([^/]+)\/games\.json$/.exec(path)?.[1] ?? ''));
  for (const raw of wanted) {
    if (available.has(raw)) return raw;
    const base = raw.split('-')[0] ?? '';
    for (const code of available) if (code === base || code.startsWith(`${base}-`)) return code;
  }
  return 'en';
}

export function loadLocale(code: string): Promise<Record<string, unknown>> {
  const loader = loaders[`../../../../locales/${code}/games.json`];
  return loader ? loader().then((m) => m.default) : Promise.resolve({});
}

/** Install the instance; resolves when the catalogue for the phone's language is in (or failed: English then). */
export async function installStandaloneI18n(): Promise<void> {
  const lng = pickLocale();
  const instance = createInstance();
  let strings: Record<string, unknown> = {};
  try {
    strings = await loadLocale(lng);
  } catch {
    /* English fallbacks */
  }
  await instance.init({ lng, resources: { [lng]: { translation: strings } }, // The reader's catalogues use ICU `{name}`; the phone page keeps the same placeholder syntax (no plurals in the shell strings).
    interpolation: { prefix: '{', suffix: '}', escapeValue: false } });
  setGamesI18n(instance);
  document.documentElement.lang = lng;
  document.documentElement.dir = ['ar', 'fa', 'he', 'xx-rtl'].some((p) => lng.startsWith(p)) ? 'rtl' : 'ltr';
}
