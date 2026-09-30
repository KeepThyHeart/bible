/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Folding of verse words and heard words to one comparable form.
 */

import type { HeardToken, ILanguageKit, RecognizedWord } from './types';

function isWordChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c.charCodeAt(0) > 127;
}

/**
 * Fold a verse word: curly quotes and dashes, edge punctuation stripped,
 * lowercase, inner apostrophes and hyphens dropped ("Lord's" -> "lords").
 */
export function foldTarget(word: string): string {
  let s = word
    .replace(/[‘’‛ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .toLowerCase();
  let a = 0;
  let b = s.length;
  while (a < b && !isWordChar(s.charAt(a))) a++;
  while (b > a && !isWordChar(s.charAt(b - 1))) b--;
  s = s.slice(a, b);
  return s.replace(/['"-]/g, '');
}

/** Recognised words to normalised tokens; one word may yield several (hyphens, digits). */
export function tokenizeHeard(words: RecognizedWord[], kit: ILanguageKit): HeardToken[] {
  const out: HeardToken[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const fromNumber = /[0-9]/.test(w.text);
    const toks = kit.spokenTokens(w.text);
    for (let j = 0; j < toks.length; j++) {
      const t: HeardToken = { text: w.text, norm: toks[j], heardIndex: i };
      if (w.confidence !== undefined) t.confidence = w.confidence;
      if (fromNumber) t.fromNumber = true;
      out.push(t);
    }
  }
  return out;
}
