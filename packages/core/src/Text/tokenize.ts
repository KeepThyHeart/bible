/**
 * Tokenising plain text into the app's word-index space.
 *
 * A verse is split on whitespace and each piece is one word, addressed by its
 * 0-based index. This is the same space `extractWords()` /
 * `extractWordsWithFormatting()` (Services/WordIndexing) produce from verse
 * HTML: every whitespace piece is a token, including pure-punctuation ones, so
 * indices from either agree. Use those for HTML; use these for plain text.
 */
import { normalizeToken, trimEdgePunctuation } from './normalize';

export interface TextWord {
  /** 0-based index in the verse's whitespace-split word list. */
  index: number;
  /** The word exactly as written, edge punctuation trimmed. */
  text: string;
}

/** Split verse text into indexed words (whitespace-separated, edge punctuation removed). */
export function tokenizeVerseWords(text: string): TextWord[] {
  return text
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .map((piece, index) => ({ index, text: trimEdgePunctuation(piece) }));
}

/** Split a phrase / multi-word form into matching tokens (empty pieces dropped, so this is not index-aligned). */
export function tokenizePhrase(text: string, matchCase = false): string[] {
  return text.split(/\s+/).map((w) => normalizeToken(w, matchCase)).filter((w) => w.length > 0);
}
