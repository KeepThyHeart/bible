/**
 * Grading of one recitation: the core alignment plus what the extension
 * stores and shows. Pure. No heard text is kept beyond the returned result.
 */

import { alignRecitation, POLICIES, scoreWords, stripEdgePunctuation } from '@bible/core/recite';
import type { ILanguageKit, RecitationResult, RecognizedWord, WordVerdict } from '@bible/core/recite';
import type { ReciteStrictness, VerseText } from '../types';
import type { ReciteDetailInput } from '../store';

const VERDICT_CHAR: Record<WordVerdict, string> = {
  correct: 'c',
  variant: 'v',
  near: 'n',
  swapped: 's',
  wrong: 'w',
  missed: 'm',
  hinted: 'h',
};

const MISSED_QUOTE_MAX = 5;

export function expectedFor(verses: VerseText[]): { words: string[]; verseStarts: number[] } {
  const words: string[] = [];
  const verseStarts: number[] = [];
  for (const v of verses) {
    verseStarts.push(words.length);
    for (const w of v.words) words.push(w);
  }
  return { words, verseStarts };
}

/** Edge punctuation off a surface word; inner apostrophes and hyphens stay. */
export function stripPunctuation(word: string): string {
  return stripEdgePunctuation(word);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface GradeOptions {
  /** Spoken-reference words expected before the passage (lenient, never in the verse score). */
  refBefore?: readonly string[];
  /** Spoken-reference words expected after the passage. */
  refAfter?: readonly string[];
  /** How many leading passage words were shown by Peek: shown, so not graded. */
  peeked?: number;
}

export interface GradedRecitation {
  result: RecitationResult;
  /** Surface words of missed or wrong words (first five, punctuation stripped). */
  missedQuote: string[];
  attempt: { score: number; correctFirst: number; totalSteps: number };
  /** Ready for `store.recordReciteDetail`. Verdict letters and numbers only. */
  detail: ReciteDetailInput;
  /** Lenient score of the spoken reference (0..1); null when none was asked for. */
  referenceScore: number | null;
  /** Every passage word was peeked at: nothing to grade. */
  practiceOnly: boolean;
}

/**
 * `hinted` is in the space of the full expected list (reference words, passage, reference words);
 * `result.words[].index` and `extras[].afterIndex` come back relative to the passage.
 */
export function gradeRecitation(
  verses: VerseText[],
  heard: RecognizedWord[],
  hinted: ReadonlySet<number>,
  strictness: ReciteStrictness,
  kit: ILanguageKit,
  opts: GradeOptions = {},
): GradedRecitation {
  const { words: verseWords, verseStarts } = expectedFor(verses);
  const before = opts.refBefore ?? [];
  const after = opts.refAfter ?? [];
  const off = before.length;
  const policy = POLICIES[strictness];
  const all = before.length + after.length > 0 ? [...before, ...verseWords, ...after] : verseWords;
  const full = alignRecitation(all, heard, kit, policy, {
    mode: 'full',
    hinted,
    verseStarts: before.length + after.length > 0 ? [0] : verseStarts,
  });

  const peekedN = Math.min(Math.max(0, opts.peeked ?? 0), verseWords.length);
  const refWords = [...full.words.slice(0, off), ...full.words.slice(off + verseWords.length)];
  const refScore = refWords.length === 0
    ? null
    : refWords.reduce((sum, w) => sum + POLICIES.lenient.credit[w.verdict], 0) / refWords.length;

  const words = full.words.slice(off, off + verseWords.length).map((w) => {
    const out = { ...w, index: w.index - off };
    if (out.index < peekedN) out.peeked = true;
    return out;
  });
  const extras = full.extras
    .filter((x) => x.afterIndex >= off - 1 && x.afterIndex < off + verseWords.length)
    .map((x) => ({ afterIndex: x.afterIndex - off, heard: x.heard }));
  const graded = words.filter((w) => !w.peeked);
  const gradedExtras = peekedN > 0 ? extras.filter((x) => x.afterIndex >= peekedN - 1).length : extras.length;
  const score = graded.length === 0 ? 0 : scoreWords(graded, gradedExtras, policy);
  const verseScores = verseStarts.map((a, i) => {
    const b = i + 1 < verseStarts.length ? verseStarts[i + 1] : verseWords.length;
    const slice = words.slice(a, b).filter((w) => !w.peeked);
    if (slice.length === 0) return 0;
    const count = extras.filter((x) => x.afterIndex >= Math.max(a - 1, peekedN - 1) && x.afterIndex < b - 1 + (i + 1 < verseStarts.length ? 0 : 1)).length;
    return scoreWords(slice, count, policy);
  });
  const result: RecitationResult = {
    words,
    extras,
    score,
    verseScores,
    lastMatched: (() => {
      for (let i = words.length - 1; i >= 0; i--) if (words[i].verdict !== 'missed') return i;
      return -1;
    })(),
  };

  const missedQuote: string[] = [];
  let correctFirst = 0;
  let verdicts = '';
  const credits: number[] = [];
  for (const w of result.words) {
    verdicts += VERDICT_CHAR[w.verdict];
    credits.push(round2(w.credit));
    if (w.credit === 1 && !w.peeked) correctFirst++;
    if (!w.peeked && (w.verdict === 'missed' || w.verdict === 'wrong') && missedQuote.length < MISSED_QUOTE_MAX) {
      const s = stripPunctuation(verseWords[w.index] ?? '');
      if (s !== '') missedQuote.push(s);
    }
  }

  return {
    result,
    missedQuote,
    attempt: { score: result.score, correctFirst, totalSteps: verseWords.length - peekedN },
    referenceScore: refScore,
    practiceOnly: verseWords.length > 0 && graded.length === 0,
    detail: {
      verdicts,
      credits,
      verseScores: result.verseScores.map(round2),
      extras: result.extras.length,
      strictness,
      engineId: null,
      modelId: null,
    },
  };
}
