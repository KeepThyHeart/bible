/**
 * Reading a `StepResult` back onto the words the user typed.
 *
 * Both functions here exist because `types.ts` leaves a genuine ambiguity in
 * the reply, and the panel has to survive either reading of it. They are in
 * their own DOM-free module rather than inside `practiceView.ts` so that they
 * can be tested under vitest's `node` environment, which is where the interest
 * lies: the failure mode is marking the WRONG words red, which looks exactly
 * like a scoring bug in the worker and would be reported as one.
 *
 * Both take a `HiddenWords` description rather than a `BlanksStep`
 * specifically: since task 0004 unified `blanks` and `firstletters` into "some
 * or all of a verse's words are hidden, answered per the active answer mode",
 * the same reveal-and-correct logic applies to both step kinds and to either
 * answer mode's full-word path.
 */

import type { StepResult } from '../core/types';

/** What a step hid: how many words the verse has, and which indices were hidden. */
export interface HiddenWords {
  verseWordCount: number;
  hiddenIndices: number[];
}

/**
 * Which of the answers the worker rejected, as positions in the answer array.
 *
 * `StepResult.wrong` is documented as "indices (or verse ids) the user got
 * wrong". For the picker that is unambiguous - a verse id - but for a typed
 * step it leaves two readings: positions within the submitted `words` array,
 * or indices into `verse.words`. For a partially-hidden verse those differ
 * (hidden word 0 might be word 4); when every word is hidden they coincide.
 *
 * Rather than guess, both readings are accepted. A value that appears in
 * `hiddenIndices` is taken as a word index and mapped to its position; anything
 * else that is a valid position is taken as a position. The overlap is
 * harmless: when a value is both, the word-index reading is the one that
 * matters, because that is the reading under which the two disagree.
 */
export function resolveWrongPositions(result: StepResult, hiddenIndices: number[]): Set<number> {
  const positions = new Set<number>();
  for (const value of result.wrong) {
    const asWordIndex = hiddenIndices.indexOf(value);
    if (asWordIndex >= 0) {
      positions.add(asWordIndex);
    } else if (Number.isInteger(value) && value >= 0 && value < hiddenIndices.length) {
      positions.add(value);
    }
  }
  return positions;
}

/**
 * The correct word for one hidden slot.
 *
 * `StepResult.reveal.words` has no stated length, so it might be the whole
 * verse or only the hidden words; the two are told apart by length, which is
 * unambiguous except in the degenerate case where every word is hidden - and
 * there the two readings agree anyway.
 *
 * The fallback is the caller's own copy of the verse's words - the worker
 * sends every word and the panel does the hiding, so the answer is always
 * available locally whatever `reveal` carries. (That is worth knowing for
 * another reason - the words being "hidden" are present in the panel's
 * memory, so hiding one is a UI affordance, not a secret.)
 */
export function revealedWord(
  result: StepResult,
  hidden: HiddenWords,
  position: number,
  wordIndex: number,
  verseWords: readonly string[],
): string {
  const revealed = result.reveal?.words;
  if (revealed) {
    if (revealed.length === hidden.verseWordCount) return revealed[wordIndex] ?? '';
    if (revealed.length === hidden.hiddenIndices.length) return revealed[position] ?? '';
  }
  return verseWords[wordIndex] ?? '';
}
