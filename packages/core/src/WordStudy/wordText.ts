/**
 * Language-neutral word tokenising and folding for word study.
 *
 * Tokens follow the same index space as the rest of the app: a verse is split
 * on whitespace and each piece is one word, addressed by its 0-based index.
 * Punctuation is trimmed from the edges of a piece to get the matching form.
 */

export interface TextWord {
  /** 0-based index in the verse's whitespace-split word list. */
  index: number;
  /** The word exactly as written, edge punctuation trimmed. */
  text: string;
}

const EDGE_TRIM = /^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu;
const APOSTROPHES = /['’ʼ׳]/g;

/** Split verse text into indexed words (whitespace-separated, edge punctuation removed). */
export function tokenizeVerseWords(text: string): TextWord[] {
  const out: TextWord[] = [];
  const pieces = text.split(/\s+/).filter(p => p.length > 0);
  pieces.forEach((piece, index) => {
    out.push({ index, text: piece.replace(EDGE_TRIM, '') });
  });
  return out;
}

/**
 * Fold a word for accent- and case-insensitive comparison in any script.
 * NFD, drop combining marks (Greek accents/breathings, Hebrew niqqud and
 * cantillation, Latin diacritics), lowercase, final sigma to sigma, drop
 * apostrophes.
 */
export function foldWord(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ς/g, 'σ')
    .replace(APOSTROPHES, '');
}

/** Fold a lemma or transliteration query: foldWord plus dropping Strong's-style `' - { }` marks. */
export function foldLemma(s: string): string {
  return foldWord(s).replace(/[\-{}`]/g, '').replace(/\s+/g, ' ').trim();
}
