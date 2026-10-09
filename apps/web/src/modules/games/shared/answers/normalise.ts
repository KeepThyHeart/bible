/**
 * Reducing typed text to something comparable.
 *
 * The rules here are shaped by what phones actually send rather than by what a
 * keyboard nominally has. iOS and Android substitute a curly apostrophe while
 * you type, autocorrect leaves a full stop on the end of a one-word answer,
 * a name copied from a hymn book arrives with its accents intact, and a
 * hyphenated place name is typed with a space by half the room. None of that
 * is a wrong answer, so none of it survives normalisation.
 *
 * Normalisation is deliberately lossy and deliberately symmetric: the same
 * function runs over the canonical answer and over the submission, so anything
 * it destroys is destroyed on both sides. It is also idempotent, so a caller
 * that normalises twice is not punished for it.
 */

/**
 * Combining marks left behind once NFKD has split a letter from its accent.
 * Dropping them is what turns `é` into `e` without a per-letter table.
 */
const COMBINING_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃰︠-︯]/g;

/**
 * Letters NFKD leaves whole, because their mark is part of the glyph rather
 * than an accent over it. The set is small enough to enumerate, and a player
 * on an English keyboard has no way to type any of them anyway.
 */
const LETTER_FOLDS: readonly (readonly [RegExp, string])[] = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/ø/g, 'o'],
  [/đ/g, 'd'],
  [/ð/g, 'd'],
  [/þ/g, 'th'],
  [/ł/g, 'l'],
  // Typed as a shortcut for the word, and meant as the word.
  [/&/g, ' and '],
];

/**
 * Every apostrophe a phone might produce, plus the backtick and prime that
 * sometimes stand in for one. They are removed rather than spaced, so that
 * `the LORD's` and `the LORDs` are the same answer.
 */
const APOSTROPHES = /['‘’‚‛′´`ʼʹ]/g;

/**
 * Characters that stand between words rather than inside them: the whole dash
 * family (a phone offers an en dash where a hyphen was typed), slashes, and
 * every flavour of space. They become a single space so that `well-beloved`
 * and `well beloved` normalise alike.
 */
const SEPARATORS = /[\s\-‐-―−⁃﹘﹣－/\\|_]/g;

/** Anything that is not a letter, a digit or a space is noise on an answer. */
const NOISE = /[^\p{L}\p{N} ]/gu;

const RUNS_OF_SPACE = / {2,}/g;

/** Reduce typed text to the form every comparison in this module works on. */
export function normalise(text: string): string {
  let out = text.normalize('NFKD').replace(COMBINING_MARKS, '').toLowerCase();
  for (const [pattern, replacement] of LETTER_FOLDS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(APOSTROPHES, '');
  out = out.replace(SEPARATORS, ' ');
  out = out.replace(NOISE, '');
  return out.replace(RUNS_OF_SPACE, ' ').trim();
}

/** The normalised words of a phrase. Empty input yields no words, not one blank one. */
export function normaliseWords(text: string): string[] {
  const normalised = normalise(text);
  return normalised === '' ? [] : normalised.split(' ');
}

/**
 * True when there is nothing to judge. Callers check this before scoring so
 * that an empty submission is never accidentally equal to an empty answer.
 */
export function isBlank(text: string): boolean {
  return normalise(text) === '';
}
