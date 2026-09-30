/**
 * Matching a phrase from the notes to words of a verse.
 *
 * A bold "everlasting life" under John 3:16 has to become a `HighlightRange`
 * -- verse id plus 0-based inclusive word indices -- that lights exactly the
 * words the viewer draws. The only way to guarantee that is to count words the
 * way the viewer does, so verse text goes through the viewer's own
 * `tokenizeVerse`, and the phrase goes through it too.
 *
 * Comparison ignores case, accents and punctuation; indices are the viewer's,
 * including tokens that are punctuation only (a lone dash), which take an
 * index but are skipped while matching.
 */

import { tokenizeVerse } from '../../../present/tokenize';
import type { HighlightRange } from '../../../present/protocol';
import type { VerseText } from './types';

/** The comparison form of one word: lower case, no accents, no punctuation. */
export function normalizeWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}']/gu, '')
    .replace(/^'+|'+$/g, '');
}

/** Plain notes text is not HTML: escape it so `tokenizeVerse` reads it literally. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** The words of a phrase from the notes, normalised, punctuation-only tokens dropped. */
export function phraseWords(text: string): string[] {
  return tokenizeVerse(escapeHtml(text)).map(token => normalizeWord(token.text)).filter(Boolean);
}

interface IndexedWord { verseId: number; index: number; word: string }

const verseCache = new Map<string, IndexedWord[]>();
const VERSE_CACHE_LIMIT = 2000;

function wordsOf(verse: VerseText): IndexedWord[] {
  const key = `${verse.verseId}\u0000${verse.html}`;
  let words = verseCache.get(key);
  if (!words) {
    words = [];
    tokenizeVerse(verse.html).forEach((token, index) => {
      const word = normalizeWord(token.text);
      if (word) words!.push({ verseId: verse.verseId, index, word });
    });
    if (verseCache.size >= VERSE_CACHE_LIMIT) verseCache.clear();
    verseCache.set(key, words);
  }
  return words;
}

/**
 * The first place `phrase` occurs as whole consecutive words in `verses`
 * (in the order given), or null. A phrase may run across a verse boundary.
 */
export function matchPhrase(phrase: string, verses: readonly VerseText[]): HighlightRange | null {
  const wanted = phraseWords(phrase);
  if (!wanted.length) return null;

  const words = verses.flatMap(wordsOf);
  outer: for (let i = 0; i + wanted.length <= words.length; i++) {
    for (let j = 0; j < wanted.length; j++) {
      if (words[i + j].word !== wanted[j]) continue outer;
    }
    const first = words[i];
    const last = words[i + wanted.length - 1];
    const range: HighlightRange = { verseIdStart: first.verseId, textStart: first.index };
    if (last.verseId !== first.verseId) range.verseIdEnd = last.verseId;
    if (last.verseId !== first.verseId || last.index !== first.index) range.textEnd = last.index;
    return range;
  }
  return null;
}
