/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pairwise word comparison used by the aligner.
 */

import type { ILanguageKit } from './types';
import { phoneticSimilarity } from './phonemeDistance';

export interface WordComparison {
  verdict: 'correct' | 'variant' | 'near' | 'wrong';
  cost: number;
}

export type CompareCache = Map<string, WordComparison>;

const NEAR_THRESHOLD = 0.75;

function letterSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  let prev: number[] = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1), prev[j] + 1, cur[j - 1] + 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / longest;
}

/**
 * Compare a folded target word with a folded heard word. Order: equal (0),
 * kit variant (0), archaic/phonetic/letter near (0.4), wrong (1). Pass one Map
 * per alignment call to memoise.
 */
export function compareWords(target: string, heard: string, kit: ILanguageKit, cache?: CompareCache): WordComparison {
  const key = target + '\u0000' + heard;
  if (cache) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  let res: WordComparison;
  if (target === heard) res = { verdict: 'correct', cost: 0 };
  else {
    const eq = kit.equivalent(target, heard);
    if (eq === 'equal') res = { verdict: 'correct', cost: 0 };
    else if (eq === 'variant') res = { verdict: 'variant', cost: 0 };
    else if (
      kit.archaicNear(target, heard) ||
      phoneticSimilarity(kit.pronouncer.phonemes(target), kit.pronouncer.phonemes(heard)) >= NEAR_THRESHOLD ||
      letterSimilarity(target, heard) >= NEAR_THRESHOLD
    ) {
      res = { verdict: 'near', cost: 0.4 };
    } else res = { verdict: 'wrong', cost: 1 };
  }
  if (cache) cache.set(key, res);
  return res;
}
