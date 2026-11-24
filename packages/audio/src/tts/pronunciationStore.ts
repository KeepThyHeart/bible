/**
 * The pronunciation overlay for on-device speech (see core `pronunciation.ts`), loaded from
 * the audio tree the server publishes (`fetch:piper` installs it):
 *
 *   <base>/pronunciation/<locale>/lexicon.json     words and homograph meanings, every module in the locale
 *   <base>/pronunciation/<language>/<MODULE>.json  which meaning each homograph has, per verse
 *   <base>/pronunciation/<locale>/<MODULE>.json    optional IPA for single occurrences
 *
 * Fetched fresh when online (the server marks these `no-cache`, so it is a revalidation), and
 * kept in the models cache so speech offline sounds the same. A missing file (404) means "no
 * overlay", never an error: speech then plays exactly as without one. Nothing here throws.
 */

import {
  parsePronunciationLexicon,
  parsePronunciationModule,
  parsePronunciationSenses,
  pronunciationFiles,
  type IAssetCache,
  type PronunciationLexicon,
  type PronunciationModule,
  type PronunciationOverlay,
  type PronunciationSenses,
} from '@bible/core/browser';

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface PronunciationStoreOptions {
  /** `<audio base>/pronunciation`, absolute or root-relative. */
  base: string;
  cache: IAssetCache;
  fetchFn?: FetchFn;
}

export class PronunciationStore {
  private readonly lexicons = new Map<string, Promise<PronunciationLexicon | null>>();
  private readonly senses = new Map<string, Promise<PronunciationSenses | null>>();
  private readonly modules = new Map<string, Promise<PronunciationModule | null>>();
  private readonly fetchFn: FetchFn;

  constructor(private readonly o: PronunciationStoreOptions) {
    this.fetchFn = o.fetchFn ?? ((url, init) => fetch(url, init));
  }

  /** The overlay for a module spoken in `locale` (`en-us`), or null when there is none. */
  async overlay(moduleAbbr: string, locale: string): Promise<PronunciationOverlay | null> {
    const files = pronunciationFiles(encodeURIComponent(moduleAbbr), locale);
    const language = locale.split('-')[0];
    const sameModule = (m: { module: string }) => m.module.toLowerCase() === moduleAbbr.toLowerCase();
    const [lexicon, senses, module] = await Promise.all([
      this.memo(this.lexicons, files.lexicon, files.lexicon, json => {
        const l = parsePronunciationLexicon(json);
        return l && l.locale === locale ? l : null;
      }),
      this.memo(this.senses, files.senses, files.senses, json => {
        const m = parsePronunciationSenses(json);
        return m && m.language === language && sameModule(m) ? m : null;
      }),
      this.memo(this.modules, files.module, files.module, json => {
        const m = parsePronunciationModule(json);
        return m && m.locale === locale && sameModule(m) ? m : null;
      }),
    ]);
    return lexicon || module ? { lexicon, senses, module } : null;
  }

  private memo<T>(map: Map<string, Promise<T | null>>, key: string, path: string, parse: (json: unknown) => T | null): Promise<T | null> {
    let p = map.get(key);
    if (!p) {
      p = this.load(`${this.o.base.replace(/\/+$/, '')}/${path}`).then(r => {
        // Offline with nothing cached: try again next time rather than remembering "none".
        if (r.transient) map.delete(key);
        return r.json === undefined ? null : parse(r.json);
      });
      map.set(key, p);
    }
    return p;
  }

  private async load(url: string): Promise<{ json?: unknown; transient: boolean }> {
    try {
      const res = await this.fetchFn(url);
      if (res.ok) {
        const text = await res.text();
        const json: unknown = JSON.parse(text);
        try {
          await this.o.cache.put(url, new Response(text, { headers: { 'Content-Type': 'application/json' } }));
        } catch { /* storage full or unavailable: the overlay still applies this session */ }
        return { json, transient: false };
      }
      if (res.status === 404) {
        await this.o.cache.delete(url).catch(() => 0);
        return { transient: false };
      }
    } catch { /* offline or a bad file: fall back to the cached copy */ }
    try {
      const hit = await this.o.cache.get(url);
      if (hit?.ok) return { json: await hit.json(), transient: false };
    } catch { /* unreadable cache entry */ }
    return { transient: true };
  }
}
