/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * Transposition pass run after traceback: words said in the wrong order earn
 * partial ("swapped") credit instead of costing a miss plus an extra.
 */

import { compareWords } from './compare';
import type { AlignedWord, HeardToken, ILanguageKit } from './types';

/** An aligned word plus bookkeeping the public result does not carry. */
export interface WorkWord extends AlignedWord {
  /** Position in the heard token list of the matched token. */
  tok?: number;
  /** Recogniser confidence of the matched token(s). */
  conf?: number;
}

export interface WorkExtra {
  afterIndex: number;
  heard: string;
  tok?: number;
  norm?: string;
}

const NEAR_POSITIONS = 2;

/**
 * Mutates `words`; returns the extras that remain (those not absorbed as
 * moved words).
 */
export function applyTranspositions(
  words: WorkWord[],
  extras: WorkExtra[],
  expected: readonly string[],
  heardTokens: readonly HeardToken[],
  kit: ILanguageKit,
): WorkExtra[] {
  const cache = new Map();
  const exact = (a: string, b: string): boolean => {
    const v = compareWords(a, b, kit, cache).verdict;
    return v === 'correct' || v === 'variant';
  };
  const n = words.length;

  // (a) two adjacent substituted words that are each other's match.
  for (let i = 0; i + 1 < n; i++) {
    const a = words[i];
    const b = words[i + 1];
    if (a.tok === undefined || b.tok === undefined || b.tok !== a.tok + 1) continue;
    if (a.verdict !== 'near' && a.verdict !== 'wrong') continue;
    if (b.verdict !== 'near' && b.verdict !== 'wrong') continue;
    const ha = heardTokens[a.tok];
    const hb = heardTokens[b.tok];
    if (!ha || !hb) continue;
    if (exact(expected[i], hb.norm) && exact(expected[i + 1], ha.norm)) {
      a.verdict = 'swapped';
      b.verdict = 'swapped';
      a.heard = hb.text;
      a.heardIndex = hb.heardIndex;
      b.heard = ha.text;
      b.heardIndex = ha.heardIndex;
      const t = a.tok;
      a.tok = b.tok;
      b.tok = t;
      i++;
    }
  }

  // (b) a missed word plus a nearby extra that is that word.
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    const w = words[i];
    if (w.verdict !== 'missed') continue;
    let best = -1;
    let bestDist = Infinity;
    for (let k = 0; k < extras.length; k++) {
      if (used.has(k)) continue;
      const x = extras[k];
      const dist = x.afterIndex + 1 <= i ? i - (x.afterIndex + 1) : x.afterIndex - i;
      if (dist > NEAR_POSITIONS || dist >= bestDist) continue;
      const norm = x.norm !== undefined ? x.norm : x.heard.toLowerCase();
      if (!exact(expected[i], norm)) continue;
      best = k;
      bestDist = dist;
    }
    if (best >= 0) {
      const x = extras[best];
      used.add(best);
      w.verdict = 'swapped';
      w.heard = x.heard;
      if (x.tok !== undefined) {
        w.tok = x.tok;
        const t = heardTokens[x.tok];
        if (t) w.heardIndex = t.heardIndex;
      }
    }
  }
  return used.size === 0 ? extras : extras.filter((_, k) => !used.has(k));
}
