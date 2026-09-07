/**
 * Word-boundary truncation for text that is *shown as a summary* of something
 * the reader can still open in full.
 *
 * ## Why this exists
 *
 * A Strong's "gloss" is the KJV usage list that follows the `:--` separator in
 * a Strong's lexicon entry. For most entries that is a handful of words
 * (`G25` is `(be-)love(-ed). Compare 5368`), which is why it reads as a
 * concise definition and gets rendered inline in a search header or a hover
 * tooltip. But it is not bounded by anything: across the 5,742 entries of
 * `dictionary_strongsgreek` the median is 11 characters while the longest -
 * `G1722` (ἐν), a preposition - is 564, and the maximum is 765. Rendered
 * unbounded, one of those turns a one-line header into a paragraph.
 *
 * There is no separate short-definition column to prefer: the module stores a
 * single `definition` blob and the gloss is a parsed slice of it. So the
 * summary has to be produced by truncating, and the reader needs a way to
 * reach the full entry.
 *
 * Truncation happens at a word boundary and trims the list punctuation the cut
 * would otherwise leave dangling (`about, after, against,...`), because a gloss
 * is a comma-separated list far more often than it is a sentence.
 */

/** Result of a truncation: the text to render, and whether anything was cut. */
export interface TruncatedText {
  /** The text to render - with a trailing ellipsis when `truncated` is true. */
  text: string;
  /** True when the input did not fit and something was dropped. */
  truncated: boolean;
}

/** Appended when text was cut. A real ellipsis, not three periods. */
export const TRUNCATION_ELLIPSIS = '…';

/**
 * Truncate `text` to at most `maxLength` characters (before the ellipsis),
 * cutting at the last whitespace boundary so a word is never split.
 *
 * Returns the input unchanged, with `truncated: false`, when it already fits.
 * A single word longer than `maxLength` has no boundary to cut at and is cut
 * mid-word rather than being dropped entirely.
 */
export function truncateAtWordBoundary(text: string, maxLength: number): TruncatedText {
  const source = text.trim();
  if (maxLength <= 0) {
    return { text: '', truncated: source.length > 0 };
  }
  if (source.length <= maxLength) {
    return { text: source, truncated: false };
  }

  const head = source.slice(0, maxLength);
  const lastBoundary = head.search(/\s+\S*$/);
  // `search` returns -1 when the slice holds no whitespace at all - a single
  // long word, which is cut where it is rather than turned into a bare ellipsis.
  const cut = lastBoundary > 0 ? head.slice(0, lastBoundary) : head;

  // A gloss is usually a list, so the cut tends to land just after a separator.
  // Leaving it produces "about, after,..."; dropping it produces "about, after...".
  const trimmed = cut.replace(/[\s,;:.+\-/]+$/, '');

  return {
    text: `${trimmed || cut}${TRUNCATION_ELLIPSIS}`,
    truncated: true,
  };
}
