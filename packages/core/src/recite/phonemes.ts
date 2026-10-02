/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Grapheme-to-phoneme for English: a hand lexicon plus greedy longest-match
 * letter rules. Output is ARPAbet without stress marks.
 *
 * A full CMUdict/espeak lexicon and build-time verse phonemes are a later data
 * step: inject a bigger IPronouncer and nothing else changes.
 */

import type { IPronouncer } from './types';

interface Rule {
  g: string;
  ph: string[];
  pos?: 'start' | 'end';
  /** Extra context test: word, index of the grapheme start. */
  cond?: (w: string, i: number) => boolean;
}

function isVowelLetter(c: string): boolean {
  return c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u';
}

const RULES: Rule[] = [
  { g: 'ssion', ph: ['SH', 'AH', 'N'] },
  { g: 'tion', ph: ['SH', 'AH', 'N'] },
  { g: 'sion', ph: ['SH', 'AH', 'N'] },
  { g: 'cian', ph: ['SH', 'AH', 'N'] },
  { g: 'cious', ph: ['SH', 'AH', 'S'] },
  { g: 'tious', ph: ['SH', 'AH', 'S'] },
  { g: 'eigh', ph: ['EY'] },
  { g: 'augh', ph: ['AO'] },
  { g: 'igh', ph: ['AY'] },
  { g: 'tch', ph: ['CH'] },
  { g: 'dge', ph: ['JH'] },
  { g: 'sch', ph: ['S', 'K'] },
  { g: 'eau', ph: ['OW'] },
  { g: 'ture', ph: ['CH', 'ER'], pos: 'end' },
  { g: 'ness', ph: ['N', 'AH', 'S'], pos: 'end' },
  { g: 'ful', ph: ['F', 'AH', 'L'], pos: 'end', cond: (w) => w.length > 4 },
  { g: 'ing', ph: ['IH', 'NG'], pos: 'end', cond: (w) => w.length > 4 },
  { g: 'ous', ph: ['AH', 'S'], pos: 'end', cond: (w) => w.length > 4 },
  { g: 'eth', ph: ['EH', 'TH'], pos: 'end', cond: (w) => w.length > 4 },
  { g: 'est', ph: ['EH', 'S', 'T'], pos: 'end', cond: (w) => w.length > 4 },
  { g: 'eer', ph: ['IY', 'R'] },
  { g: 'ear', ph: ['IY', 'R'] },
  { g: 'air', ph: ['EH', 'R'] },
  { g: 'ly', ph: ['L', 'IY'], pos: 'end', cond: (w) => w.length > 3 },
  { g: 'le', ph: ['AH', 'L'], pos: 'end', cond: (w, i) => w.length > 3 && !isVowelLetter(w.charAt(i - 1)) },
  { g: 'er', ph: ['ER'], pos: 'end' },
  { g: 'th', ph: ['TH'] },
  { g: 'sh', ph: ['SH'] },
  { g: 'ch', ph: ['CH'] },
  { g: 'ck', ph: ['K'] },
  { g: 'ph', ph: ['F'] },
  { g: 'qu', ph: ['K', 'W'] },
  { g: 'ng', ph: ['NG'] },
  { g: 'nk', ph: ['NG', 'K'] },
  { g: 'wh', ph: ['W'] },
  { g: 'kn', ph: ['N'], pos: 'start' },
  { g: 'wr', ph: ['R'], pos: 'start' },
  { g: 'gn', ph: ['N'], pos: 'start' },
  { g: 'ps', ph: ['S'], pos: 'start' },
  { g: 'mb', ph: ['M'], pos: 'end' },
  { g: 'gh', ph: ['G'], pos: 'start' },
  { g: 'gh', ph: [] },
  { g: 'ee', ph: ['IY'] },
  { g: 'ea', ph: ['IY'] },
  { g: 'oo', ph: ['UW'] },
  { g: 'ow', ph: ['OW'], pos: 'end' },
  { g: 'ou', ph: ['AW'] },
  { g: 'ow', ph: ['AW'] },
  { g: 'ai', ph: ['EY'] },
  { g: 'ay', ph: ['EY'] },
  { g: 'oi', ph: ['OY'] },
  { g: 'oy', ph: ['OY'] },
  { g: 'au', ph: ['AO'] },
  { g: 'aw', ph: ['AO'] },
  { g: 'ie', ph: ['IY'] },
  { g: 'ei', ph: ['EY'] },
  { g: 'ey', ph: ['IY'], pos: 'end' },
  { g: 'oa', ph: ['OW'] },
  { g: 'ew', ph: ['UW'] },
  { g: 'ue', ph: ['UW'], pos: 'end' },
  { g: 'ui', ph: ['UW'] },
  { g: 'ar', ph: ['AA', 'R'] },
  { g: 'or', ph: ['AO', 'R'] },
  { g: 'er', ph: ['ER'] },
  { g: 'ir', ph: ['ER'] },
  { g: 'ur', ph: ['ER'] },
];
RULES.sort((a, b) => b.g.length - a.g.length);
// Final -ed and -es are handled in code (their sound depends on the previous letter).

const VOICELESS = 'pkfsxc';
const VOICED_FINAL_S = 'bdglmnrvzwyaeo';

function endings(w: string, i: number, out: string[]): boolean {
  const n = w.length;
  if (i === n - 2 && n > 3) {
    const pair = w.substr(i, 2);
    const prev = w.charAt(i - 1);
    if (pair === 'ed') {
      if (prev === 't' || prev === 'd') out.push('IH', 'D');
      else if (VOICELESS.indexOf(prev) >= 0 || (prev === 'h' && 'cs'.indexOf(w.charAt(i - 2)) >= 0)) out.push('T');
      else out.push('D');
      return true;
    }
    if (pair === 'es' && 'sxzc'.indexOf(prev) >= 0) {
      out.push('IH', 'Z');
      return true;
    }
  }
  return false;
}

/** ARPAbet phonemes for one word from letter rules alone (no lexicon). */
export function letterToSound(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const n = w.length;
  const out: string[] = [];
  let i = 0;
  while (i < n) {
    if (endings(w, i, out)) break;
    let matched = false;
    for (let r = 0; r < RULES.length; r++) {
      const rule = RULES[r];
      const g = rule.g;
      if (w.substr(i, g.length) !== g) continue;
      if (rule.pos === 'start' && i !== 0) continue;
      if (rule.pos === 'end' && i + g.length !== n) continue;
      if (rule.cond && !rule.cond(w, i)) continue;
      for (let k = 0; k < rule.ph.length; k++) out.push(rule.ph[k]);
      i += g.length;
      matched = true;
      break;
    }
    if (matched) continue;
    const c = w.charAt(i);
    const next = i + 1 < n ? w.charAt(i + 1) : '';
    const magic = i + 2 === n - 1 && w.charAt(n - 1) === 'e' && !isVowelLetter(next) && next !== '';
    const vowelBefore = /[aeiouy]/.test(w.slice(0, i));
    switch (c) {
      case 'a': out.push(magic ? 'EY' : 'AE'); break;
      case 'e':
        if (i === n - 1 && n > 1) {
          if (!vowelBefore) out.push('IY');
        } else out.push('EH');
        break;
      case 'i': out.push(magic ? 'AY' : 'IH'); break;
      case 'o': out.push(magic ? 'OW' : 'AA'); break;
      case 'u': out.push(magic ? 'UW' : 'AH'); break;
      case 'y':
        if (i === 0) out.push('Y');
        else if (i === n - 1) out.push(/[aeiou]/.test(w) ? 'IY' : 'AY');
        else out.push('IH');
        break;
      case 'c': out.push('eiy'.indexOf(next) >= 0 && next !== '' ? 'S' : 'K'); break;
      case 'g': out.push('eiy'.indexOf(next) >= 0 && next !== '' ? 'JH' : 'G'); break;
      case 's':
        if (i === n - 1 && i > 0 && VOICED_FINAL_S.indexOf(w.charAt(i - 1)) >= 0 && w.charAt(i - 1) !== 'i') out.push('Z');
        else out.push('S');
        break;
      case 'x': out.push('K', 'S'); break;
      case 'q': out.push('K'); break;
      case 'j': out.push('JH'); break;
      case 'h': out.push('HH'); break;
      default: out.push(c.toUpperCase());
    }
    if (!isVowelLetter(c) && next === c) i += 2;
    else i += 1;
  }
  return out;
}

/** Lexicon lookup (folded word) first, then letter rules. Results are memoised. */
export function createPronouncer(table: Record<string, readonly string[]>): IPronouncer {
  const cache = new Map<string, readonly string[]>();
  return {
    phonemes(word: string): readonly string[] {
      const key = word.toLowerCase().replace(/[^a-z0-9]/g, '');
      const hit = cache.get(key);
      if (hit) return hit;
      const known = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
      const res = known ? known : letterToSound(key);
      cache.set(key, res);
      return res;
    },
  };
}
