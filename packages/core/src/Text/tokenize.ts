/**
 * Tokenising plain text.
 *
 * A verse is split on whitespace and each piece is one word, addressed by its
 * 0-based index. The app's word-index space (interlinear rows, decorations) is
 * defined by `extractWords()` / `extractWordsWithFormatting()` in
 * Services/WordIndexing, which ALSO start a new token at inline markup
 * boundaries (`the <span class="divine-name">LORD</span>'s house` is 4 tokens,
 * the plain text 3). So for text that came from verse HTML use `extractWords()`
 * or `TermMatcher.matchHtml`; `tokenizeVerseWords` agrees with it only for
 * markup-free text, and its `text` also trims more edge characters.
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
