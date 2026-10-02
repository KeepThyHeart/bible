/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Weighted phoneme edit distance: confusable sounds are cheap to swap.
 */

const VOWELS = new Set(['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW']);

const CLOSE_VOWELS: string[][] = [['IH', 'IY'], ['AH', 'AA'], ['AH', 'AO'], ['AA', 'AO'], ['EH', 'AE'], ['UH', 'UW']];
const VOICING: string[][] = [
  ['P', 'B'], ['T', 'D'], ['K', 'G'], ['F', 'V'], ['TH', 'DH'], ['S', 'Z'], ['SH', 'ZH'], ['CH', 'JH'],
];
const NASALS = ['M', 'N', 'NG'];

function makePairSet(groups: string[][]): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < groups.length; i++) {
    s.add(groups[i][0] + '|' + groups[i][1]);
    s.add(groups[i][1] + '|' + groups[i][0]);
  }
  return s;
}

const CLOSE = makePairSet(CLOSE_VOWELS);
const VOICED = makePairSet(VOICING);

function subCost(a: string, b: string): number {
  if (a === b) return 0;
  const va = VOWELS.has(a);
  const vb = VOWELS.has(b);
  if (va && vb) return CLOSE.has(a + '|' + b) ? 0.15 : 0.3;
  if (va !== vb) return 1;
  if (VOICED.has(a + '|' + b)) return 0.3;
  if (NASALS.indexOf(a) >= 0 && NASALS.indexOf(b) >= 0) return 0.4;
  return 1;
}

function indelCost(seq: readonly string[], i: number): number {
  const p = seq[i];
  if (p === 'AH' || p === 'ER') return 0.5;
  if ((p === 'S' || p === 'Z') && i === seq.length - 1) return 0.5;
  return 1;
}

/** Weighted Levenshtein over ARPAbet phoneme sequences. */
export function phonemeDistance(a: readonly string[], b: readonly string[]): number {
  const n = a.length;
  const m = b.length;
  let prev: number[] = [0];
  for (let j = 0; j < m; j++) prev.push(prev[j] + indelCost(b, j));
  for (let i = 0; i < n; i++) {
    const del = indelCost(a, i);
    const cur: number[] = [prev[0] + del];
    for (let j = 0; j < m; j++) {
      const best = Math.min(prev[j] + subCost(a[i], b[j]), prev[j + 1] + del, cur[j] + indelCost(b, j));
      cur.push(best);
    }
    prev = cur;
  }
  return prev[m];
}

/** 1 - distance / longer length; 1 when both are empty. */
export function phoneticSimilarity(a: readonly string[], b: readonly string[]): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return Math.max(0, 1 - phonemeDistance(a, b) / longest);
}
