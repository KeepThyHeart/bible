/**
 * "Look up": what a word or short phrase means, asked of every source that can answer.
 *
 * A source is a {@link LookUpProvider}. Today there is one (dictionaries); genealogies, word studies and the
 * like plug into the same interface later without the callers (the word context menu, the floating toolbar,
 * the web Bible pane) changing. This module is pure: no DOM, no IPC, no database - providers bring their own
 * transport, so desktop (IPC) and web (HTTP) share the shape and the ordering rules.
 */

export interface LookUpQuery {
  /** The word or short phrase as the reader selected it. */
  text: string;
  /** Strong's number (`G25`, `H430`) when the word is tagged; its entry is listed first. */
  strongs?: string;
}

export interface LookUpEntry {
  /** The key to open this entry with in its source. */
  key: string;
  title: string;
  /** A short plain-text lead of the definition. */
  snippet?: string;
  transliteration?: string;
}

/** One source's answers, e.g. all hits in one dictionary. */
export interface LookUpGroup {
  providerId: string;
  /** The source within the provider (a dictionary's abbreviation). */
  sourceId: string;
  sourceName: string;
  /** True for the Strong's lexicons: they sort first when the word is tagged. */
  strongs?: boolean;
  entries: LookUpEntry[];
}

export interface LookUpProvider {
  id: string;
  label: string;
  lookUp(query: LookUpQuery): Promise<LookUpGroup[]>;
}

export interface LookUpRegistry {
  register(provider: LookUpProvider): () => void;
  providers(): readonly LookUpProvider[];
}

export function createLookUpRegistry(): LookUpRegistry {
  const list: LookUpProvider[] = [];
  return {
    register(provider) {
      list.push(provider);
      return () => {
        const i = list.indexOf(provider);
        if (i >= 0) list.splice(i, 1);
      };
    },
    providers: () => list,
  };
}

/** Normalise what the reader selected into a query: trimmed, whitespace collapsed, edge punctuation dropped. */
export function normalizeLookUpText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'“”‘’(\[{.,;:!?—–-]+|[\s"'“”‘’)\]}.,;:!?—–-]+$/g, '');
}

/** A word or a short phrase worth looking up (at most four words, not a sentence). */
export function isLookUpCandidate(raw: string): boolean {
  const text = normalizeLookUpText(raw);
  if (!text || text.length > 60) return false;
  return text.split(' ').length <= 4;
}

/** Groups with hits only; Strong's lexicons first when the query names a Strong's number, then input order. */
export function orderLookUpGroups(groups: LookUpGroup[], query: LookUpQuery): LookUpGroup[] {
  const withHits = groups.filter((g) => g.entries.length > 0);
  if (!query.strongs) return withHits;
  const rank = (g: LookUpGroup) => (g.strongs ? 0 : 1);
  return withHits
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map((x) => x.g);
}

/** Ask every provider; one failing provider does not hide the others' answers. */
export async function lookUpAll(registry: LookUpRegistry, query: LookUpQuery): Promise<LookUpGroup[]> {
  const settled = await Promise.allSettled(registry.providers().map((p) => p.lookUp(query)));
  const groups: LookUpGroup[] = [];
  for (const s of settled) if (s.status === 'fulfilled') groups.push(...s.value);
  return orderLookUpGroups(groups, query);
}

/** Strong's key as a lexicon stores it: `G26` / `g0026` -> `00026`. Undefined when it is not a Strong's number. */
export function strongsEntryKey(strongs: string | undefined): string | undefined {
  const m = /^[GgHh]0*(\d{1,5})$/.exec((strongs ?? '').trim());
  return m ? m[1].padStart(5, '0') : undefined;
}

/** The minimum a repository must offer for {@link searchDictionariesForWord}. */
export interface LookUpDictionary {
  abbreviation: string;
  name: string;
  /** Strong's lexicon (Greek or Hebrew)? */
  strongs?: boolean;
  repo: {
    searchEntries(query: string, options?: { limit?: number }): Array<{
      entryKey: string;
      word?: string;
      definition?: string;
      transliteration?: string;
    }>;
    getEntryByKey(key: string): { entryKey: string; word?: string; definition?: string; transliteration?: string } | undefined;
  };
}

function snippetOf(definition: string | undefined): string | undefined {
  if (!definition) return undefined;
  const text = definition.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 200) : undefined;
}

/**
 * The dictionary provider's core, shared by the desktop IPC handler: search every dictionary for the text
 * (title match with stemming, then full text - `DictionaryRepository.searchEntries`), and for a tagged word put
 * the Strong's entry itself first in its lexicon. Each entry appears once per dictionary.
 */
export function searchDictionariesForWord(
  dictionaries: LookUpDictionary[],
  query: LookUpQuery,
  limitPerDictionary = 8,
): LookUpGroup[] {
  const strongsKey = strongsEntryKey(query.strongs);
  const strongsLang = query.strongs?.trim().charAt(0).toUpperCase();
  const groups: LookUpGroup[] = [];
  for (const dict of dictionaries) {
    const entries: LookUpEntry[] = [];
    const seen = new Set<string>();
    const add = (e: { entryKey: string; word?: string; definition?: string; transliteration?: string }) => {
      if (seen.has(e.entryKey)) return;
      seen.add(e.entryKey);
      entries.push({
        key: e.entryKey,
        title: e.word || e.entryKey,
        snippet: snippetOf(e.definition),
        transliteration: e.transliteration,
      });
    };
    try {
      if (dict.strongs && strongsKey) {
        // Only the lexicon that matches the number's language (G -> Greek, H -> Hebrew).
        const isGreek = !/hebrew/i.test(`${dict.abbreviation} ${dict.name}`);
        const wanted = strongsLang === 'G' ? isGreek : !isGreek;
        if (!wanted) continue;
        const direct = dict.repo.getEntryByKey(strongsKey);
        if (direct) add(direct);
      }
      for (const e of dict.repo.searchEntries(query.text, { limit: limitPerDictionary })) add(e);
    } catch {
      continue; // one broken dictionary must not hide the rest
    }
    groups.push({
      providerId: 'dictionary',
      sourceId: dict.abbreviation,
      sourceName: dict.name,
      strongs: dict.strongs,
      entries: entries.slice(0, limitPerDictionary),
    });
  }
  return orderLookUpGroups(groups, query);
}
