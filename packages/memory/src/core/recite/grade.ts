/**
 * Grading of one recitation: the core alignment plus what the extension
 * stores and shows. Pure. No heard text is kept beyond the returned result.
 */

import { alignRecitation, POLICIES, stripEdgePunctuation } from '@bible/core/recite';
import type { ILanguageKit, RecitationResult, RecognizedWord, WordVerdict } from '@bible/core/recite';
import type { ReciteStrictness, VerseText } from '../types';
import type { ReciteDetailInput } from '../store';

export interface GradedRecitation {
  result: RecitationResult;
  /** Surface words of missed or wrong words (first five, punctuation stripped). */
  missedQuote: string[];
  attempt: { score: number; correctFirst: number; totalSteps: number };
  /** Ready for `store.recordReciteDetail`. Verdict letters and numbers only. */
  detail: ReciteDetailInput;
}

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

export function gradeRecitation(
  verses: VerseText[],
  heard: RecognizedWord[],
  hinted: ReadonlySet<number>,
  strictness: ReciteStrictness,
  kit: ILanguageKit,
): GradedRecitation {
  const { words, verseStarts } = expectedFor(verses);
  const result = alignRecitation(words, heard, kit, POLICIES[strictness], {
    mode: 'full',
    hinted,
    verseStarts,
  });

  const missedQuote: string[] = [];
  let correctFirst = 0;
  let verdicts = '';
  const credits: number[] = [];
  for (const w of result.words) {
    verdicts += VERDICT_CHAR[w.verdict];
    credits.push(round2(w.credit));
    if (w.credit === 1) correctFirst++;
    if ((w.verdict === 'missed' || w.verdict === 'wrong') && missedQuote.length < MISSED_QUOTE_MAX) {
      const s = stripPunctuation(words[w.index] ?? '');
      if (s !== '') missedQuote.push(s);
    }
  }

  return {
    result,
    missedQuote,
    attempt: { score: result.score, correctFirst, totalSteps: words.length },
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
