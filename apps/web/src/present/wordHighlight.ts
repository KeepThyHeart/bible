/**
 * The presenter's word-highlight draft: the phrase they are lighting up in
 * the active verse before (and after) it goes to the screen.
 *
 * Only one draft exists at a time, and only in one verse. The interaction is
 * "tap the ends": a press-and-hold on a word starts a one-word draft, a plain
 * tap on another word stretches it to that word, and a tap on the highlight
 * itself clears it. All of that is decided here, as plain functions, so the
 * gesture rules are tested without a DOM or a pointer.
 *
 * Word indices are 0-based and inclusive -- the same space `tokenizeVerse`
 * and `HighlightRange` use -- and `start <= end` always: the draft is stored
 * ordered regardless of which end was tapped first.
 */

import type { HighlightRange } from './protocol';

export interface HighlightDraft {
  verseId: number;
  start: number;
  end: number;
}

/** A press-and-hold on a word: begins a fresh one-word draft, replacing any other. */
export function beginDraft(verseId: number, index: number): HighlightDraft {
  return { verseId, start: index, end: index };
}

/**
 * A plain tap on word `index` of `verseId`, given the current draft.
 *
 * Returns the new draft, or `null` when the draft is cleared. With no draft a
 * plain tap does nothing here (the caller has already decided whether it is a
 * draft-affecting tap), so that also returns `null`.
 *
 *  - Inside the draft (on the highlight itself): clear.
 *  - Outside a one-word draft: stretch it to a range ending at the tap.
 *  - Outside a range: move whichever end is nearer, so a phrase can be trimmed
 *    or widened without starting over.
 *  - In a different verse: ignored (draft unchanged).
 */
export function tapDraft(
  draft: HighlightDraft | null,
  verseId: number,
  index: number,
): HighlightDraft | null {
  if (!draft) return null;
  if (draft.verseId !== verseId) return draft;
  if (index >= draft.start && index <= draft.end) return null;
  if (draft.start === draft.end) {
    return { verseId, start: Math.min(draft.start, index), end: Math.max(draft.end, index) };
  }
  // Ties cannot happen: `index` is outside [start, end], so it is strictly
  // nearer to one end.
  return index < draft.start
    ? { ...draft, start: index }
    : { ...draft, end: index };
}

/** The wire form of a draft. `textEnd` is always sent, even for one word. */
export function draftToRange(draft: HighlightDraft): HighlightRange {
  return { verseIdStart: draft.verseId, textStart: draft.start, textEnd: draft.end };
}

/** Whether the wall's current highlight is exactly this draft. */
export function draftIsOnWall(draft: HighlightDraft | null, wall: HighlightRange | null): boolean {
  if (!draft || !wall) return false;
  const wallVerseEnd = wall.verseIdEnd ?? wall.verseIdStart;
  return wall.verseIdStart === draft.verseId
    && wallVerseEnd === draft.verseId
    && wall.textStart === draft.start
    && (wall.textEnd ?? wall.textStart) === draft.end;
}
