/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * Recogniser bias: which expected words to offer the engine as hints. Never
 * in passage order except level 'full' (measurement only).
 */

import { foldTarget } from './normalize';
import { PHONEME_TABLE } from './lang/enTables';
import type { BiasLevel, ILanguageKit } from './types';
import type { SpeechBias } from '../speech/types';

const NOT_NAMES = new Set(['LORD', 'God', 'I', 'O']);

function isUpper(c: string): boolean {
  return c.length > 0 && c !== c.toLowerCase() && c === c.toUpperCase();
}

/** Surface word with edge punctuation stripped (case kept). */
function stripEdges(word: string): string {
  let a = 0;
  let b = word.length;
  const isEdge = (c: string): boolean => !(c.toLowerCase() !== c.toUpperCase() || (c >= '0' && c <= '9') || c === "'" || c.charCodeAt(0) > 127);
  while (a < b && isEdge(word.charAt(a))) a++;
  while (b > a && isEdge(word.charAt(b - 1))) b--;
  return word.slice(a, b);
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    let j = Math.floor(rng() * (i + 1));
    if (j > i) j = i;
    if (j < 0) j = 0;
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** Shuffle, but never hand back the input order. */
function scramble<T>(items: T[], rng: () => number): T[] {
  if (items.length < 2) return items;
  const out = shuffle(items, rng);
  let same = true;
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== items[i]) {
      same = false;
      break;
    }
  }
  return same ? out.slice(1).concat(out[0]) : out;
}

function namesOf(words: string[], kit: ILanguageKit, out: Map<string, string>): void {
  const english = kit.language === 'en' || kit.language.indexOf('en-') === 0;
  for (let i = 0; i < words.length; i++) {
    const surface = stripEdges(words[i]);
    if (surface === '' || NOT_NAMES.has(surface) || !isUpper(surface.charAt(0))) continue;
    const folded = foldTarget(surface);
    if (folded === '' || kit.isStopword(folded)) continue;
    const sentenceStart = i === 0 || /[.!?]['")\]]*$/.test(words[i - 1]);
    if (sentenceStart && !(english && PHONEME_TABLE[folded] !== undefined)) continue;
    if (!out.has(folded)) out.set(folded, surface);
  }
}

export function biasFor(
  verseWords: string[],
  contextWords: string[],
  kit: ILanguageKit,
  level: BiasLevel,
  rng: () => number,
): SpeechBias {
  if (level === 'none') return { phrases: [], level };
  if (level === 'full') return { phrases: [verseWords.join(' ')], level };
  const found = new Map<string, string>();
  if (level === 'names') {
    namesOf(verseWords, kit, found);
    namesOf(contextWords, kit, found);
    return { phrases: scramble(Array.from(found.values()), rng), level };
  }
  const all = verseWords.concat(contextWords);
  for (const w of all) {
    const f = foldTarget(w);
    if (f === '' || kit.isStopword(f) || found.has(f)) continue;
    found.set(f, f);
  }
  return { phrases: scramble(Array.from(found.values()), rng), level };
}
