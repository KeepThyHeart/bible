/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * Scoring policies. Credit per verdict, extra-word penalty and the cap on it.
 */

import type { AlignedWord, ScoringPolicy, Strictness } from './types';

export const POLICIES: Record<Strictness, ScoringPolicy> = {
  normal: {
    strictness: 'normal',
    credit: { correct: 1, variant: 1, near: 0.5, swapped: 0.5, wrong: 0, missed: 0, hinted: 0 },
    extraPenalty: 0.25,
    extraCap: 0.1,
    lowConfidence: 0.4,
  },
  lenient: {
    strictness: 'lenient',
    credit: { correct: 1, variant: 1, near: 1, swapped: 0.75, wrong: 0, missed: 0, hinted: 0 },
    extraPenalty: 0.25,
    extraCap: 0.1,
    lowConfidence: 0.4,
  },
  strict: {
    strictness: 'strict',
    credit: { correct: 1, variant: 1, near: 0, swapped: 0, wrong: 0, missed: 0, hinted: 0 },
    extraPenalty: 0.25,
    extraCap: 0.1,
    lowConfidence: 0,
  },
};

/** 0..1 score of a word slice; extras cost `extraPenalty` each, capped at `extraCap` of the slice. */
export function scoreWords(
  words: readonly Pick<AlignedWord, 'credit'>[],
  extrasCount: number,
  policy: ScoringPolicy,
): number {
  const n = words.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += words[i].credit;
  const penalty = Math.min(extrasCount * policy.extraPenalty, policy.extraCap * n);
  return Math.max(0, sum - penalty) / n;
}
