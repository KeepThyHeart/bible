/**
 * The web app's SimilarPassagesService (task 0070): table only (no live index in the browser), known
 * cross-references from the providers, explanations from verse text and topics.
 */

import { SimilarPassagesService, gatherPassageFacts, explainMatch, collapseReferences } from '@bible/core/browser';
import type { MatchReason, PassageFacts, PassageRange, SimilarPassage } from '@bible/core/browser';
import type { IDataProviders } from '../providers/interfaces';
import { getLoadedSimilarTable } from './similarTable';

export type SimilarProviders = Pick<IDataProviders, 'bible' | 'crossRef' | 'topical'>;

const bookOf = (id: number) => Math.floor(id / 1000000);
const chapterOf = (id: number) => Math.floor((id % 1000000) / 1000);
const verseOf = (id: number) => id % 1000;

/** "John 3:16" or "John 3:16-18" / "John 3:16-4:2" (long book names, English; see getBookName). */
export function formatPassage(r: PassageRange): string {
  const start = collapseReferences([r.startVerseId]);
  if (r.endVerseId === r.startVerseId) return start;
  if (bookOf(r.endVerseId) !== bookOf(r.startVerseId)) return `${start} - ${collapseReferences([r.endVerseId])}`;
  if (chapterOf(r.endVerseId) === chapterOf(r.startVerseId)) return `${start}-${verseOf(r.endVerseId)}`;
  return `${start}-${chapterOf(r.endVerseId)}:${verseOf(r.endVerseId)}`;
}

/** Verse ids inside a range, capped so a huge paragraph cannot flood the batch request. */
function idsIn(r: PassageRange, cap = 12): number[] {
  const out: number[] = [];
  const book = bookOf(r.startVerseId);
  if (book !== bookOf(r.endVerseId)) return [r.startVerseId];
  for (let c = chapterOf(r.startVerseId); c <= chapterOf(r.endVerseId) && out.length < cap; c++) {
    const from = c === chapterOf(r.startVerseId) ? verseOf(r.startVerseId) : 1;
    const to = c === chapterOf(r.endVerseId) ? verseOf(r.endVerseId) : 176;
    for (let v = from; v <= to && out.length < cap; v++) out.push(book * 1000000 + c * 1000 + v);
  }
  return out;
}

export interface WebSimilar {
  service: SimilarPassagesService;
  /** Verse text of a passage (display translation), plain. */
  textOf(r: PassageRange): Promise<string>;
  explain(source: PassageRange, candidate: SimilarPassage): Promise<MatchReason[]>;
}

export interface WebSimilarOptions {
  /** Language of the display module (stop words and stemming for the "why" chips). Default 'en'. */
  getLanguage?: () => string;
  /** The cross-reference module (studyStore.crossRefModule), which is not the Bible module. */
  crossRefModule?: string;
}

/** Explanation cache bound (source facts). */
const FACTS_CACHE_MAX = 8;

export function createWebSimilar(providers: SimilarProviders, getModule: () => string, options: WebSimilarOptions = {}): WebSimilar {
  const getLanguage = options.getLanguage ?? (() => 'en');
  const crossRefModule = options.crossRefModule ?? 'TSKxref';
  const textOf = async (r: PassageRange): Promise<string> => {
    const ids = idsIn(r);
    const res = await providers.bible.getVerseTexts(getModule(), ids);
    return ids.map((id) => res.verses[String(id)]?.text ?? '').filter(Boolean).join(' ');
  };

  const crossRefsFor = async (r: PassageRange): Promise<PassageRange[]> => {
    const out: PassageRange[] = [];
    const all = await Promise.all(
      idsIn(r, 40).map((id) => providers.crossRef.getGroupsForVerse(crossRefModule, id).catch(() => [])),
    );
    for (const groups of all) {
      for (const g of groups) {
        for (const e of g.entries) {
          out.push({ startVerseId: e.target_verse_id, endVerseId: e.target_verse_end_id ?? e.target_verse_id });
        }
      }
    }
    return out;
  };

  const facts = (r: PassageRange): Promise<PassageFacts> =>
    gatherPassageFacts(r, {
      language: getLanguage(),
      text: textOf,
      topics: async (range) => {
        const topics = await providers.topical.getTopicsForVerse(range.startVerseId).catch(() => []);
        return topics.map((t) => ({
          label: t.name,
          source: /torrey/i.test(t.source_abbreviation) ? ('torrey' as const) : ('naves' as const),
        }));
      },
    });

  const service = new SimilarPassagesService({ table: getLoadedSimilarTable, crossRefsFor });

  // Keyed by module + language + source range; cleared when the source changes; bounded.
  let sourceFacts = new Map<string, Promise<PassageFacts>>();
  let factsSource = '';
  const explain = async (source: PassageRange, candidate: SimilarPassage): Promise<MatchReason[]> => {
    const srcKey = `${source.startVerseId}-${source.endVerseId}`;
    if (srcKey !== factsSource) {
      sourceFacts = new Map();
      factsSource = srcKey;
    }
    const key = `${getModule()}|${getLanguage()}|${srcKey}`;
    let s = sourceFacts.get(key);
    if (!s) {
      if (sourceFacts.size >= FACTS_CACHE_MAX) sourceFacts.delete(sourceFacts.keys().next().value as string);
      sourceFacts.set(key, (s = facts(source)));
      s.catch(() => { if (sourceFacts.get(key) === s) sourceFacts.delete(key); });
    }
    const [a, b] = await Promise.all([s, facts(candidate)]);
    return explainMatch(a, b);
  };

  return { service, textOf, explain };
}
