/**
 * Similar passages (task 0070): why are two passages alike? Shared lemmas, shared topics and
 * shared word stems, as short chips. Pure and browser-safe.
 */

import { foldWord, getStemmer, isStopWord, normalizeArchaic, tokenizeVerseWords } from '../../Text';
import type { MatchReason, PassageFacts } from './SimilarTypes';

const MAX_CHIPS = 4;
const DEFAULT_MAX_WORDS = 5;

export interface ExplainOptions {
  /** Strong's numbers too common to be informative (e.g. "the", "and"); skipped. */
  frequentStrongs?: ReadonlySet<string>;
  /** Max shared words in the words chip. Default 5. */
  maxWords?: number;
}

function stemsOf(text: string, language: string): Array<{ stem: string; surface: string }> {
  const stemmer = getStemmer(language);
  const out: Array<{ stem: string; surface: string }> = [];
  for (const t of tokenizeVerseWords(text)) {
    if (!t.text || !/\p{L}/u.test(t.text)) continue;
    const folded = normalizeArchaic(foldWord(t.text), language);
    if (folded.length < 2) continue;
    if (isStopWord(t.text, language) || isStopWord(folded, language)) continue;
    out.push({ stem: stemmer ? stemmer(folded) : folded, surface: t.text });
  }
  return out;
}

/** Chips in order lemma, topic, words; at most 4 in total. */
export function explainMatch(a: PassageFacts, b: PassageFacts, o: ExplainOptions = {}): MatchReason[] {
  const out: MatchReason[] = [];

  const aStrongs = new Map(a.strongs.map((s) => [s.strongs, s]));
  const seenS = new Set<string>();
  for (const s of b.strongs) {
    if (seenS.has(s.strongs) || !aStrongs.has(s.strongs)) continue;
    seenS.add(s.strongs);
    if (o.frequentStrongs?.has(s.strongs)) continue;
    const other = aStrongs.get(s.strongs)!;
    const lemma = s.lemma ?? other.lemma;
    const gloss = s.gloss ?? other.gloss;
    out.push({
      kind: 'lemma',
      strongs: s.strongs,
      ...(lemma !== undefined ? { lemma } : {}),
      ...(gloss !== undefined ? { gloss } : {}),
    });
  }

  const aTopics = new Set(a.topics.map((t) => foldWord(t.label)));
  const seenT = new Set<string>();
  for (const t of b.topics) {
    const k = foldWord(t.label);
    if (!aTopics.has(k) || seenT.has(k)) continue;
    seenT.add(k);
    out.push({ kind: 'topic', label: t.label, source: t.source });
  }

  const language = b.language || a.language;
  const aStems = new Set(stemsOf(a.text, language).map((x) => x.stem));
  const words: string[] = [];
  const seenW = new Set<string>();
  for (const x of stemsOf(b.text, language)) {
    if (!aStems.has(x.stem) || seenW.has(x.stem)) continue;
    seenW.add(x.stem);
    words.push(x.surface);
    if (words.length >= (o.maxWords ?? DEFAULT_MAX_WORDS)) break;
  }
  if (words.length > 0) out.push({ kind: 'words', words });

  return out.slice(0, MAX_CHIPS);
}
