/**
 * Shift-click passage selection: the pure part.
 *
 * A panel's selection is two numbers - the *anchor* (`selectedVerseId`, the
 * verse the reader actually clicked, which every dependent pane follows) and
 * an optional *end* (`selectionEndVerseId`, set only by shift-click). The
 * anchor never moves while the range is extended, so the end may be either
 * above or below it; everything downstream wants the pair ordered, and that
 * ordering is the whole of this module.
 *
 * It lives outside the slice so the renderers can compute the same range the
 * store reports without going through `getSelectedRange` on every verse row,
 * and so the ordering rule has exactly one definition.
 */

/** An inclusive verse-id span, ordered low to high. */
export interface VerseRange {
  start: number;
  end: number;
}

/**
 * The selected passage as an inclusive `[start, end]` pair, ordered low to
 * high regardless of which direction the reader shift-clicked.
 *
 * Returns `null` when nothing is selected. With an anchor but no extension the
 * range is the anchor alone, which is what makes "copy the selection" a single
 * code path for one verse and for twelve.
 */
export function computeSelectedRange(
  anchorVerseId: number | null | undefined,
  endVerseId: number | null | undefined,
): VerseRange | null {
  if (anchorVerseId === null || anchorVerseId === undefined) return null;
  const other = endVerseId ?? anchorVerseId;
  return {
    start: Math.min(anchorVerseId, other),
    end: Math.max(anchorVerseId, other),
  };
}

/**
 * True when `verseId` is one of the *extra* verses a shift-click swept in -
 * i.e. inside the range but not the anchor itself.
 *
 * The anchor keeps its own full selection treatment (fill plus the inset
 * accent bar); the swept verses get the washed-out variant that says "along
 * for the copy, but not the verse the study panes are following". Excluding
 * the anchor here rather than relying on CSS ordering keeps the two states
 * mutually exclusive, so no rule has to out-specify the other.
 */
export function isInSelectedRange(
  verseId: number,
  anchorVerseId: number | null | undefined,
  endVerseId: number | null | undefined,
): boolean {
  if (endVerseId === null || endVerseId === undefined) return false;
  const range = computeSelectedRange(anchorVerseId, endVerseId);
  if (!range) return false;
  return verseId >= range.start && verseId <= range.end && verseId !== anchorVerseId;
}
