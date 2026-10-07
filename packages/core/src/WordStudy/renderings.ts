/**
 * Grouping how a translation renders a word: the raw glosses of a Strong's
 * number ("love", "loved", "thou shalt love") into a chart-ready list.
 */

import { foldWord, getStemmer } from '../Text';

export interface RenderingCount { gloss: string; count: number; }

export interface RenderingGroup {
  /** Display label: the base form (shortest phrase) of a merged group, else the phrase itself. */
  label: string;
  /** Stable key for filtering occurrences (the head/stem key or the phrase). */
  key: string;
  count: number;
  /** count / total, 0..1. */
  share: number;
  members: Array<{ phrase: string; count: number }>;
}

export type RenderingMode = 'head' | 'phrase';

/** Small function-word stoplist (English), dropped from the front of a gloss to find its head word. */
const LEADING_STOP = new Set([
  'a', 'an', 'the', 'to', 'of', 'be', 'is', 'are', 'am', 'was', 'were', 'been', 'being',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'ye', 'thou', 'thee', 'thy', 'thine', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their',
  'shall', 'shalt', 'wilt', 'art', 'canst', 'wouldest', 'shouldest', 'will', 'would', 'should', 'may', 'might', 'can', 'could', 'must', 'do', 'doth', 'did', 'dost',
  'not', 'no', 'have', 'hath', 'had', 'hast', 'that', 'which', 'who', 'whom', 'and', 'or', 'but', 'in', 'on',
  'at', 'by', 'for', 'with', 'from', 'up', 'out', 'into', 'as', 'so', 'also', 'then', 'there', 'thereof',
]);

/** phrase: lowercased, punctuation trimmed. head: the first content word. */
export function normalizeRendering(gloss: string): { phrase: string; head: string } {
  const words = gloss
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, ''))
    .filter(Boolean);
  const phrase = words.join(' ');
  const content = words.filter(w => !LEADING_STOP.has(w));
  const head = content.length ? content[0] : (words[words.length - 1] ?? '');
  return { phrase, head };
}

/**
 * Group glosses. 'phrase' merges only identical phrases; 'head' merges by head
 * word and folds inflections through the language's stemmer (default English),
 * so love/loved/loveth/loving fall into one group.
 */
export function groupRenderings(
  rows: RenderingCount[],
  mode: RenderingMode = 'head',
  language: string | undefined = 'en',
): RenderingGroup[] {
  const stem = mode === 'head' ? getStemmer(language) : undefined;
  const keyOf = (gloss: string): string => {
    const { phrase, head } = normalizeRendering(gloss);
    if (mode === 'phrase') return phrase;
    const f = foldWord(head);
    return stem ? stem(f) : f;
  };
  const groups = new Map<string, { phrases: Map<string, number>; total: number }>();
  let total = 0;
  for (const r of rows) {
    const key = keyOf(r.gloss);
    if (!key) continue;
    const phrase = normalizeRendering(r.gloss).phrase;
    const g = groups.get(key) ?? { phrases: new Map(), total: 0 };
    g.phrases.set(phrase, (g.phrases.get(phrase) ?? 0) + r.count);
    g.total += r.count;
    total += r.count;
    groups.set(key, g);
  }
  const out: RenderingGroup[] = [];
  for (const [key, g] of groups) {
    const members = [...g.phrases].map(([phrase, count]) => ({ phrase, count }))
      .sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
    // The base form labels a merged group: the shortest phrase (love, not thou shalt love).
    const label = mode === 'head'
      ? [...members].sort((a, b) => a.phrase.split(' ').length - b.phrase.split(' ').length ||
          a.phrase.length - b.phrase.length || b.count - a.count)[0].phrase
      : members[0].phrase;
    out.push({ label, key, count: g.total, share: total ? g.total / total : 0, members });
  }
  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Does a gloss belong to the rendering group with this key? */
export function glossMatchesRendering(
  gloss: string, key: string, mode: RenderingMode = 'head', language: string | undefined = 'en',
): boolean {
  return groupRenderings([{ gloss, count: 1 }], mode, language)[0]?.key === key;
}
