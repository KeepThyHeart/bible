/**
 * Turning a highlight range into "which words of *this* verse are lit".
 *
 * A `HighlightRange` is a span across the text as a whole: it starts at some
 * word of some verse and ends at some word of a possibly different one. Each
 * verse renders independently, so each has to work out its own slice -- the
 * first verse is lit from the start word to its end, the last from its start to
 * the end word, and anything in between is lit entirely.
 *
 * Indices are 0-based and inclusive throughout, matching `tokenizeVerse` and
 * core's `UserTextMarkup`.
 */

import type { HighlightRange } from './protocol';

export interface WordSpan {
  /** First lit word index, inclusive. */
  from: number;
  /** Last lit word index, inclusive. */
  to: number;
}

/**
 * The lit span within one verse, or null if this verse has none.
 *
 * `wordCount` is needed because a range that runs *through* a verse lights all
 * of it, and only the renderer knows how many words that is.
 */
export function highlightSpanForVerse(
  verseId: number,
  wordCount: number,
  highlight: HighlightRange | null,
): WordSpan | null {
  if (!highlight || wordCount <= 0) return null;

  const firstVerse = highlight.verseIdStart;
  const lastVerse = highlight.verseIdEnd ?? highlight.verseIdStart;
  if (verseId < firstVerse || verseId > lastVerse) return null;

  const isFirst = verseId === firstVerse;
  const isLast = verseId === lastVerse;

  // A missing `textEnd` on a single-verse range means one word, not "to the end
  // of the verse". A controller that means the rest of the verse says so.
  const from = isFirst ? highlight.textStart : 0;
  const to = isLast
    ? (highlight.textEnd ?? (isFirst ? highlight.textStart : wordCount - 1))
    : wordCount - 1;

  // Clamp rather than reject. Word counts can legitimately differ from what the
  // controller measured -- a different translation, or a module updated between
  // the two -- and lighting slightly the wrong words is a far better outcome on
  // a wall than lighting none.
  const clampedFrom = Math.max(0, Math.min(from, wordCount - 1));
  const clampedTo = Math.max(0, Math.min(to, wordCount - 1));
  if (clampedTo < clampedFrom) return null;

  return { from: clampedFrom, to: clampedTo };
}

/**
 * Position of a word within the highlight, for staggering the sweep animation.
 *
 * Returns -1 for words outside the span. The cap keeps a highlight of a whole
 * verse from taking several seconds to finish drawing.
 */
export const MAX_SWEEP_STEPS = 12;

export function sweepStep(index: number, span: WordSpan | null): number {
  if (!span || index < span.from || index > span.to) return -1;
  return Math.min(index - span.from, MAX_SWEEP_STEPS);
}
