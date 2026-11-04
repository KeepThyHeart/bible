import type { HighlightRange } from '../../lib/protocol';
import type { NoteHighlight, NotesReason } from '../notes/types';

/** A note highlight as Control shows it. */
export interface HighlightChip {
  id: string;
  text: string;
  range: HighlightRange | null;
  /** `pending` (verse text still loading) and `choose` chips cannot be revealed; `choose` says why. */
  status: 'ok' | 'choose' | 'pending';
  reason?: NotesReason;
  /** Already on the wall. */
  shown: boolean;
}

const same = (a: HighlightRange, b: HighlightRange): boolean =>
  a.verseIdStart === b.verseIdStart && a.textStart === b.textStart
  && (a.verseIdEnd ?? a.verseIdStart) === (b.verseIdEnd ?? b.verseIdStart)
  && (a.textEnd ?? a.textStart) === (b.textEnd ?? b.textStart);

/** The live item's note highlights, in the order the presenter wrote them, marked with whether the wall already shows each. */
export function buildChips(highlights: readonly NoteHighlight[], onWall: readonly HighlightRange[]): HighlightChip[] {
  return [...highlights]
    .sort((a, b) => a.blockPos - b.blockPos || a.from - b.from)
    .map(h => ({
      id: h.id,
      text: h.text,
      range: h.range,
      status: h.status,
      reason: h.reason,
      shown: h.range !== null && onWall.some(w => same(w, h.range!)),
    }));
}

/** The chip `H` reveals next: the first revealable one not yet on the wall. */
export function nextChip(chips: readonly HighlightChip[]): HighlightChip | null {
  return chips.find(c => c.status === 'ok' && c.range !== null && !c.shown) ?? null;
}
