/**
 * "Tap a first and last word" in the phone's verse-edit sheet. Pure, so the
 * gesture is tested without a DOM. A phrase lives inside one verse: tapping a
 * word in another verse starts over there.
 */

export interface WordPick {
  verseId: number;
  index: number;
}

export type TapResult =
  | { kind: 'start'; pick: WordPick }
  | { kind: 'range'; verseId: number; start: number; end: number };

/**
 * A tap on word `index` of `verseId`, given the first word picked so far.
 * The first tap marks the start; the second (same verse) completes the range in
 * either order, and a second tap on the same word makes a one-word phrase.
 */
export function tapWord(pick: WordPick | null, verseId: number, index: number): TapResult {
  if (!pick || pick.verseId !== verseId) return { kind: 'start', pick: { verseId, index } };
  return {
    kind: 'range',
    verseId,
    start: Math.min(pick.index, index),
    end: Math.max(pick.index, index),
  };
}

/** Whether word `index` of `verseId` is within the marked start (or a completed range). */
export function isWordPicked(pick: WordPick | null, verseId: number, index: number): boolean {
  return pick !== null && pick.verseId === verseId && pick.index === index;
}

/**
 * The phrase text for words `start..end` (inclusive): the words as displayed,
 * minus punctuation hanging off the two ends ("loved," at the end becomes "loved").
 */
export function phraseOf(displayWords: string[], start: number, end: number): string {
  const slice = displayWords.slice(Math.max(0, start), end + 1).join(' ').trim();
  return slice.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}
