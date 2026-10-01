/**
 * Locale data registry: which locales exist, which are loaded, and loading on demand.
 *
 * ## Loading strategy (task 0077, Q14)
 *
 * Only a small core is always in memory: English (`locales/en.json`) and the
 * OSIS book ids ("Gen", "1Cor", "Rev"), which parse in every language and act
 * as the book-number fallback. Every other locale is a separate JSON file,
 * loaded only when someone asks for it with {@link loadReferenceLocales} -
 * the apps ask for the UI language and the languages of the installed Bibles.
 *
 * The built-in loaders use dynamic `import()`, so a bundler (web, desktop
 * renderer) emits each locale as its own small chunk that the browser fetches
 * the first time that language is used and then caches like any other asset;
 * Node, Bun and Electron main read the file from disk. Other places to get
 * data from (the asset store of task 0090, a language-pack extension, a test)
 * plug in through {@link addReferenceLocaleSource} or
 * {@link registerReferenceLocale}; nothing else changes.
 *
 * Parsing stays synchronous: an engine uses whatever is loaded at the time,
 * and English plus OSIS always are. When a load finishes the registry's
 * version changes and {@link onReferenceLocalesChanged} listeners run, so
 * caches keyed on {@link referenceLocalesVersion} rebuild.
 */
import enData from './locales/en.json';
import { mergeLocaleData } from './compile';
import type { ReferenceLocaleData } from './types';

type Loader = () => Promise<unknown>;

/** Built-in locale files other than English, loaded on demand. */
const BUILTIN: Record<string, Loader> = {
  ar: () => import('./locales/ar.json'),
  es: () => import('./locales/es.json'),
  fa: () => import('./locales/fa.json'),
  he: () => import('./locales/he.json'),
  'zh-Hans': () => import('./locales/zh-Hans.json'),
};

/** Somewhere else locale data can come from (asset store, extension, server). */
export interface ReferenceLocaleSource {
  /** Tags this source can provide. */
  tags(): readonly string[];
  load(tag: string): Promise<ReferenceLocaleData | undefined>;
}

const loaded = new Map<string, ReferenceLocaleData>();
const pending = new Map<string, Promise<boolean>>();
const sources: ReferenceLocaleSource[] = [];
const listeners = new Set<() => void>();
let version = 0;

loaded.set('en', enData as ReferenceLocaleData);

function bump(): void {
  version++;
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      /* a listener's failure must not break loading */
    }
  }
}

/** Changes whenever locale data is added; use it in cache keys. */
export function referenceLocalesVersion(): number {
  return version;
}

/** Run `listener` after locale data changes. Returns an unsubscribe function. */
export function onReferenceLocalesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Add locale data synchronously (tests, a language pack, data a host fetched itself). Replaces the same tag. */
export function registerReferenceLocale(data: ReferenceLocaleData): void {
  loaded.set(data.tag, data);
  bump();
}

/** Add a data source consulted after the built-in files. */
export function addReferenceLocaleSource(source: ReferenceLocaleSource): () => void {
  sources.push(source);
  return () => {
    const i = sources.indexOf(source);
    if (i >= 0) sources.splice(i, 1);
  };
}

/** Every tag that has data available, loaded or not. */
export function availableReferenceLocales(): string[] {
  const s = new Set<string>([...loaded.keys(), ...Object.keys(BUILTIN)]);
  for (const src of sources) for (const t of src.tags()) s.add(t);
  return [...s].sort();
}

/** Tags whose data is in memory now. */
export function loadedReferenceLocales(): string[] {
  return [...loaded.keys()];
}

function findTag(candidate: string, known: readonly string[]): string | undefined {
  const lc = candidate.toLowerCase();
  return known.find((t) => t.toLowerCase() === lc);
}

/**
 * Best available data tag for a BCP 47 tag: exact ("pt-BR"), then
 * language-script ("zh-CN" -> "zh-Hans", via likely subtags), then the
 * language ("ar-SA" -> "ar"). `undefined` when no data exists for it.
 */
export function resolveReferenceLocaleTag(tag: string, known: readonly string[] = availableReferenceLocales()): string | undefined {
  if (!tag) return undefined;
  const exact = findTag(tag, known);
  if (exact) return exact;
  try {
    const loc = new Intl.Locale(tag).maximize();
    if (loc.script) {
      const ls = findTag(`${loc.language}-${loc.script}`, known);
      if (ls) return ls;
    }
    if (loc.region) {
      const lr = findTag(`${loc.language}-${loc.region}`, known);
      if (lr) return lr;
    }
    const l = findTag(loc.language, known);
    if (l) return l;
  } catch {
    /* malformed tag: fall through */
  }
  return findTag(tag.split(/[-_]/)[0], known);
}

function unwrap(mod: unknown): ReferenceLocaleData | undefined {
  if (!mod || typeof mod !== 'object') return undefined;
  const m = mod as { default?: unknown; tag?: unknown };
  if (typeof m.tag === 'string') return m as ReferenceLocaleData;
  if (m.default && typeof m.default === 'object') return unwrap(m.default);
  return undefined;
}

async function loadOne(tag: string): Promise<boolean> {
  if (loaded.has(tag)) return true;
  const inflight = pending.get(tag);
  if (inflight) return inflight;
  const p = (async () => {
    let data: ReferenceLocaleData | undefined;
    try {
      const builtin = BUILTIN[tag];
      if (builtin) data = unwrap(await builtin());
      for (const src of sources) {
        if (data) break;
        if (src.tags().includes(tag)) data = await src.load(tag);
      }
    } catch {
      data = undefined;
    }
    if (!data) return false;
    if (data.extends) await loadOne(resolveReferenceLocaleTag(data.extends) ?? data.extends);
    loaded.set(tag, data);
    return true;
  })();
  pending.set(tag, p);
  try {
    return await p;
  } finally {
    pending.delete(tag);
  }
}

/**
 * Load the data for these BCP 47 tags (and their parents) if it exists.
 * Resolves to the data tags now loaded; never rejects. Safe to call often:
 * a loaded locale costs nothing.
 */
export async function loadReferenceLocales(tags: readonly string[]): Promise<string[]> {
  const before = loaded.size;
  const result: string[] = [];
  for (const t of tags) {
    const r = resolveReferenceLocaleTag(t);
    if (r && (await loadOne(r))) result.push(r);
  }
  if (loaded.size !== before) bump();
  return result;
}

/** Loaded data for a data tag, with its `extends` chain merged in (child wins). */
export function getMergedReferenceLocale(tag: string): ReferenceLocaleData | undefined {
  const seen = new Set<string>();
  const chain: ReferenceLocaleData[] = [];
  let cur = loaded.get(tag);
  while (cur && !seen.has(cur.tag)) {
    seen.add(cur.tag);
    chain.unshift(cur);
    const parentTag = cur.extends ? resolveReferenceLocaleTag(cur.extends, [...loaded.keys()]) : undefined;
    cur = parentTag ? loaded.get(parentTag) : undefined;
  }
  if (!chain.length) return undefined;
  return chain.reduce((acc, d) => mergeLocaleData(acc, d));
}

/** The resolved, loaded data tag for a BCP 47 tag, or undefined if nothing for it is loaded yet. */
export function loadedReferenceLocaleFor(tag: string): string | undefined {
  return resolveReferenceLocaleTag(tag, [...loaded.keys()]);
}
