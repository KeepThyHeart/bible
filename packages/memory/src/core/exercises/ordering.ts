/**
 * The next-verse picker - the first rung for a multi-verse passage.
 *
 * "Which verse comes next?" is the cheapest possible test of the thing that
 * actually breaks first when a passage is half-learned: not the words of any
 * one verse, but their ORDER. A user who can recite John 3:16 and John 3:18
 * perfectly and cannot say which follows which has not memorised the passage.
 *
 * Three design decisions in this file are load-bearing and were made
 * explicitly rather than falling out of the implementation:
 *
 * 1. **Candidates show real text, not references.** See `preview`. Recognising
 *    the opening words is the skill being trained; a list of bare references
 *    trains reference recall instead, which is what the `refmatch` rung is
 *    for.
 *
 * 2. **Grading is blocking.** A wrong pick does not advance the session. The
 *    same step is served again, unchanged, until it is answered correctly.
 *    Unlike blanks - where seeing the answer and moving on is the whole point -
 *    an ordering step that let you continue after a miss would teach the wrong
 *    order by leaving it unresolved in the user's head.
 *
 * 3. **The wrong mark is transient.** `StepResult.wrong` carries only the pick
 *    from THIS submission. It is not a tally and it must not accumulate across
 *    retries: its job is to say "not that one" about the thing the user just
 *    clicked. A growing list of crossed-out candidates would turn the exercise
 *    into process-of-elimination, which is a different and much easier task.
 */

import type { PickerCandidate, StepResult, VerseText } from '../types';
import { mulberry32, seedFrom, shuffled, type Rng } from './rng';

/**
 * Preview length cap in words.
 *
 * "About 25 words" is the design's phrasing and the number is a judgement, not
 * a measurement: long enough that the opening of a verse is recognisable to
 * someone who has read the passage a dozen times, short enough that four
 * candidates fit on a phone screen without scrolling.
 */
export const PREVIEW_MAX_WORDS = 25;

/**
 * Preview length cap in poetic lines, applied before the word cap.
 *
 * Cutting poetry mid-line reads as a typo rather than as a truncation, and
 * three lines is enough to place a verse in a psalm. Psalm 1:1 is exactly
 * three lines, which is where the number came from.
 */
export const PREVIEW_MAX_LINES = 3;

/**
 * The opening of a verse, for a picker candidate.
 *
 * About 25 words or three poetic lines, whichever comes first. `verse.lines`
 * is used when present: `Line.start` / `Line.end` are 0-based word indices and
 * `end` is INCLUSIVE (the convention `PoetryLine` in @bible/core documents and
 * `types.ts` inherits without restating - see the report note).
 *
 * `truncated` is a flag, not a rendering: no ellipsis is appended to the
 * string. The panel owns pixels, and how a cut is signalled - a fading edge, a
 * character, nothing at all - is a pixel decision.
 */
export interface PreviewOptions {
  /** Word cap. Defaults to `PREVIEW_MAX_WORDS`. */
  maxWords?: number;
  /** Poetic-line cap, applied before the word cap. Defaults to `PREVIEW_MAX_LINES`. */
  maxLines?: number;
}

export function preview(
  verse: VerseText,
  options: PreviewOptions = {},
): { preview: string; truncated: boolean } {
  const maxWords = options.maxWords ?? PREVIEW_MAX_WORDS;
  const maxLines = options.maxLines ?? PREVIEW_MAX_LINES;

  const words = verse.words;
  if (!words || words.length === 0) return { preview: '', truncated: false };

  let limit = words.length;

  // The line cut comes first, so that a verse of four short lines is cut at a
  // line boundary rather than 25 words into the fourth one.
  const lines = verse.lines;
  if (lines && lines.length > maxLines) {
    const lastKept = lines[maxLines - 1];
    // `end` is inclusive, so the exclusive slice bound is `end + 1`. Guard
    // against a malformed range rather than producing an empty preview: a
    // module with bad formatting data should degrade to "no line cut", not to
    // a blank candidate the user cannot choose between.
    const bound = lastKept.end + 1;
    if (bound > 0 && bound < limit) limit = bound;
  }

  if (limit > maxWords) limit = maxWords;

  return {
    preview: words.slice(0, limit).join(' '),
    truncated: limit < words.length,
  };
}

/**
 * Which verses a picker step's distractors are drawn from - the ordering
 * rung's own tiers (`ladder.ts#TIERS.ordering`).
 *
 *   - `'scattered'`   - tier 0, today's behaviour: distractors are drawn from
 *     anywhere in the unplaced remainder of the passage.
 *   - `'contiguous'`  - tier 1: distractors are the verses immediately
 *     FOLLOWING the correct one in sequence - the ones most likely to be
 *     confused with it - rather than a random draw from the whole remainder.
 */
export type CandidateMode = 'scattered' | 'contiguous';

/**
 * Build the candidate list for one picker step.
 *
 * Distractors are drawn from `remaining` - the verses of the SAME passage that
 * have not been placed yet - and never from elsewhere in the Bible. Two
 * reasons: a distractor from another book is rejected on style alone and
 * teaches nothing, and the real confusion in a memorised passage is always
 * between its own neighbouring verses.
 *
 * @param remaining  Unplaced verses, including the correct one.
 * @param correctVerseId  The verse that genuinely comes next.
 * @param count  How many candidates to show, including the correct one.
 * @param rng  Injected for reproducibility. The default is seeded from the
 *   step's own identity, so re-serving the same step after a wrong pick
 *   produces the identical list in the identical order - see `rng.ts`.
 * @param previewOptions  Passed straight through to `preview`. Omit for the
 *   normal capped preview; a caller that wants the full verse text (the
 *   ordering rung's own candidates - see `Session.prepareStep`) passes
 *   `{ maxWords: Infinity, maxLines: Infinity }`.
 * @param mode  `'scattered'` (default, tier 0) or `'contiguous'` (tier 1) -
 *   see `CandidateMode`. Near the end of a passage, fewer than `count - 1`
 *   verses may remain after the correct one in `'contiguous'` mode; that
 *   yields a shorter-than-usual list rather than an error, same as
 *   `'scattered'` running short - the correct answer is always present.
 */
export function buildCandidates(
  remaining: VerseText[],
  correctVerseId: number,
  count: number,
  rng: Rng = mulberry32(seedFrom(correctVerseId, count, remaining.length)),
  previewOptions?: PreviewOptions,
  mode: CandidateMode = 'scattered',
): PickerCandidate[] {
  const correctIndex = remaining.findIndex((v) => v.verseId === correctVerseId);
  if (correctIndex === -1) {
    // A programming error in the session runner, not user input. Throwing is
    // right: the worker turns it into `{ ok: false, error }` at the RPC edge,
    // and a picker silently missing its answer would be unwinnable.
    throw new Error(
      `buildCandidates: correct verse ${correctVerseId} is not in the remaining verses`,
    );
  }
  const correct = remaining[correctIndex] as VerseText;

  // At least the correct verse; asking for more than exist is not an error,
  // it just yields a shorter list. The last step of a passage necessarily has
  // one candidate - the session runner is free to skip a forced choice, but
  // that policy belongs to the runner, not here.
  const wanted = Math.max(1, Math.floor(count));

  const distractors =
    mode === 'contiguous'
      ? // The next `wanted - 1` verses in sequence after the correct one -
        // deliberately NOT shuffled before this slice, so "contiguous" means
        // what it says: the verses that actually follow, not a random subset
        // of them.
        remaining.slice(correctIndex + 1, correctIndex + wanted)
      : shuffled(
          remaining.filter((v) => v.verseId !== correctVerseId),
          rng,
        ).slice(0, wanted - 1);

  // Shuffle again with the correct verse mixed in. Without this second pass
  // the answer's position would be a function of how many distractors were
  // available, which a user notices within about three steps.
  return shuffled([correct, ...distractors], rng).map((verse) => {
    const p = preview(verse, previewOptions);
    return { verseId: verse.verseId, preview: p.preview, truncated: p.truncated };
  });
}

/**
 * Grade one picker submission.
 *
 * Blocking on a miss, per the rung's design. Note what the miss result does
 * NOT contain: no `reveal`. The answer stays hidden until the user finds it,
 * because revealing it would end the step's usefulness while still forcing
 * them to click it.
 *
 * @param pickedVerseId  What the user clicked.
 * @param correctVerseId  What comes next.
 */
export function gradeOrdering(pickedVerseId: number, correctVerseId: number): StepResult {
  if (pickedVerseId === correctVerseId) {
    return {
      correct: true,
      wrong: [],
      blocking: false,
      reveal: { verseId: correctVerseId },
    };
  }

  return {
    correct: false,
    // Exactly one entry, always: this submission's pick. Callers must render
    // this list rather than merging it into a running set - see the file
    // header on why the mark is transient.
    wrong: [pickedVerseId],
    blocking: true,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Running score for an attempt: correct-first-attempts over steps.
 *
 * The scoring rule the whole ladder uses (`AttemptRow.score` in `types.ts`) is
 * "correct first attempts over steps", and the blocking picker is the only
 * exercise where the distinction between a first attempt and a retry actually
 * arises. Only the FIRST submission for a given step can earn credit; the
 * retries that follow a miss are how the user learns, and counting them would
 * mean a user who missed once and then clicked correctly scored the same as
 * one who knew it.
 *
 * `stepsTaken` counts steps, not submissions, for the same reason.
 */
export interface StepTally {
  correctFirst: number;
  stepsTaken: number;
}

export function emptyTally(): StepTally {
  return { correctFirst: 0, stepsTaken: 0 };
}

/**
 * Fold one submission into the tally, returning a new tally.
 *
 * Immutable because the session view is shipped across the panel boundary and
 * a mutated tally would be observable there half-updated.
 *
 * @param firstAttemptForStep  False for every retry of a blocked step. A retry
 *   can never earn credit and never counts as a new step.
 */
export function recordStepAttempt(
  tally: StepTally,
  firstAttemptForStep: boolean,
  correct: boolean,
): StepTally {
  if (!firstAttemptForStep) return { ...tally };
  return {
    correctFirst: tally.correctFirst + (correct ? 1 : 0),
    stepsTaken: tally.stepsTaken + 1,
  };
}

/**
 * The 0..1 score for a tally.
 *
 * An attempt with no steps scores 0 rather than NaN or 1 - an empty passage is
 * a data problem, and a division by zero must not present as mastery.
 */
export function tallyScore(tally: StepTally): number {
  if (tally.stepsTaken <= 0) return 0;
  return tally.correctFirst / tally.stepsTaken;
}
