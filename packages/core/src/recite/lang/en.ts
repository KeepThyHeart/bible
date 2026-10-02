/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * English language kit.
 */

import type { ILanguageKit, LoopCommand } from '../types';
import { foldTarget } from '../normalize';
import { numberTokens } from '../numbers';
import { createPronouncer } from '../phonemes';
import { ARCHAIC, COMMANDS, FILLERS, HOMOPHONES, PHONEME_TABLE, SPELLING_RULES, STOPWORDS } from './enTables';

const homophoneGroups = new Map<string, number[]>();
HOMOPHONES.forEach((group, gi) => {
  group.forEach((w) => {
    const list = homophoneGroups.get(w);
    if (list) {
      if (list.indexOf(gi) < 0) list.push(gi);
    } else homophoneGroups.set(w, [gi]);
  });
});

const stopwords = new Set(STOPWORDS);
const fillers: ReadonlySet<string> = new Set(FILLERS);

function canonicalSpelling(w: string): string {
  let s = w;
  for (let i = 0; i < SPELLING_RULES.length; i++) {
    const r = SPELLING_RULES[i];
    if (r[0].test(s)) s = s.replace(r[0], r[1]);
  }
  return s;
}

function sameHomophone(a: string, b: string): boolean {
  const ga = homophoneGroups.get(a);
  const gb = homophoneGroups.get(b);
  if (!ga || !gb) return false;
  for (let i = 0; i < ga.length; i++) if (gb.indexOf(ga[i]) >= 0) return true;
  return false;
}

function collapseDouble(s: string): string {
  return s.replace(/([a-z])\1/g, '$1');
}

function suffixNear(eth: string, other: string): boolean {
  if (eth.length > 5 && eth.slice(-3) === 'eth') {
    const base = eth.slice(0, -3);
    if (base.length >= 3) {
      const cands = [base + 's', base + 'es', base + 'e', base, collapseDouble(base) + 's'];
      if (cands.indexOf(other) >= 0) return true;
    }
  }
  if (eth.length > 5 && eth.slice(-3) === 'est') {
    const base = eth.slice(0, -3);
    if (base.length >= 3 && (other === base || other === base + 'e')) return true;
  }
  return false;
}

function archaicPair(a: string, b: string): boolean {
  const la = ARCHAIC[a];
  if (la && la.indexOf(b) >= 0) return true;
  const lb = ARCHAIC[b];
  return !!lb && lb.indexOf(a) >= 0;
}

function spokenPiece(piece: string): string[] {
  const nums = numberTokens(piece);
  if (nums) return nums;
  const f = foldTarget(piece);
  return f ? [f] : [];
}

export const englishKit: ILanguageKit = {
  language: 'en',
  spokenTokens(text: string): string[] {
    const out: string[] = [];
    const pieces = text
      .replace(/[‘’‛ʼ`´]/g, "'")
      .split(/[\s‐-―−-]+/);
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p) continue;
      const toks = spokenPiece(p);
      for (let j = 0; j < toks.length; j++) out.push(toks[j]);
    }
    return out;
  },
  targetTokens(verseWords: string[]): string[] {
    return verseWords.map(foldTarget);
  },
  equivalent(a: string, b: string): 'equal' | 'variant' | null {
    if (a === b) return 'equal';
    if (sameHomophone(a, b)) return 'variant';
    if (canonicalSpelling(a) === canonicalSpelling(b)) return 'variant';
    return null;
  },
  archaicNear(a: string, b: string): boolean {
    return archaicPair(a, b) || suffixNear(a, b) || suffixNear(b, a);
  },
  pronouncer: createPronouncer(PHONEME_TABLE),
  fillers,
  commands: COMMANDS as Record<string, LoopCommand>,
  isStopword(w: string): boolean {
    return stopwords.has(w);
  },
};

/** The kit for a BCP-47 language tag; null when unsupported (the rung is then hidden). */
export function kitFor(language: string): ILanguageKit | null {
  const l = language.toLowerCase();
  return l === 'en' || l.indexOf('en-') === 0 || l.indexOf('en_') === 0 ? englishKit : null;
}
