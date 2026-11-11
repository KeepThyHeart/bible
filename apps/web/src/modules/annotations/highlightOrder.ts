/**
 * Deterministic order of highlights that cover the same verse (leftovers of concurrent edits on two devices).
 * Shares one comparator with the repo's `setHighlight` (created date, colour, id) so the row shown is the row kept;
 * the LAST highlight in this order is the one shown.
 */
import { compareHighlightKeys, type HighlightDto } from '../../userdb/annotationsRepo';

export function compareHighlights(a: HighlightDto, b: HighlightDto): number {
  return compareHighlightKeys(a, b);
}
