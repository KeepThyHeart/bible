/**
 * The judgement: is what this player typed the answer?
 *
 * Both halves of the game run this. The phone runs it as you type, so the
 * "Close enough!" line can appear before the round closes; the server runs it
 * again to decide the point, because a client is never allowed to score
 * itself. Same input, same verdict — that only holds because nothing in here
 * is impure, and nothing in here may become impure.
 *
 * How forgiving to be is a function of how long the answer is, and this is the
 * whole of it:
 *
 * - four letters or fewer must be typed exactly. `Cain` and `rain` are not the
 *   same guess, and at that length one edit reaches most of the dictionary.
 * - five to seven letters allow one edit.
 * - eight or more allow two, because a long word is mostly a test of spelling
 *   and spelling is not what is being asked.
 *
 * The budget comes from the *accepted* answer, not from the submission. The
 * answer is the fixed, authored side; letting the player's own typing widen
 * the tolerance would mean `lord` credited `lords` while a four-letter answer
 * is meant to be exact.
 *
 * A match that needed the archaic layer is reported as exact, not near. Typing
 * `you` where the verse says `thou` is a right answer, not a lucky miss, and
 * telling the player "close enough" for it reads as a correction.
 */

import { normalise } from './normalise.js';
import { modernise, samePhrase } from './archaic.js';
import { levenshtein } from './distance.js';

export interface MatchResult {
  matched: boolean;
  /**
   * The accepted form that was matched, in the spelling it was authored in, so
   * the caller can say which alternate carried it. Null when nothing matched.
   */
  matchedAnswer: string | null;
  /**
   * Edits between the submission and `matchedAnswer`. When nothing matched
   * this is the distance to the nearest accepted form, which is worth logging
   * when tuning content.
   */
  distance: number;
  /** Right without any spelling slack: the phone says "Correct". */
  exact: boolean;
  /** Right within the edit budget: the phone says "Close enough!". */
  near: boolean;
}

/** How many edits an answer of this many normalised characters may absorb. */
export function allowedEdits(length: number): number {
  if (length <= 4) return 0;
  if (length <= 7) return 1;
  return 2;
}

interface Candidate {
  accepted: string;
  distance: number;
  matched: boolean;
}

/**
 * Distance between two normalised strings, with archaic equivalence counting
 * as no distance at all.
 */
function compare(submitted: string, accepted: string): number {
  if (samePhrase(submitted, accepted)) return 0;
  return levenshtein(modernise(submitted), modernise(accepted));
}

/** A match beats a miss; among equals, fewer edits, then authored order. */
function beats(candidate: Candidate, incumbent: Candidate): boolean {
  if (candidate.matched !== incumbent.matched) return candidate.matched;
  return candidate.distance < incumbent.distance;
}

/**
 * Judge a submission against a canonical answer and any alternates the content
 * author accepted.
 *
 * This serves both shapes the games need. A fill-in-the-blank passes the
 * blanked word; a buzz-in passes a short free-text answer, and the same
 * word-for-word comparison handles it, falling back to whole-string distance
 * when the word counts do not line up.
 *
 * Blank or whitespace-only input never matches, whatever the answer is — an
 * empty box is a player who did not answer, not a player who agreed with an
 * empty canonical.
 */
export function matchAnswer(
  submitted: string,
  canonical: string,
  alternates: readonly string[] = [],
): MatchResult {
  const typed = normalise(submitted);
  const candidates: Candidate[] = [];

  for (const accepted of [canonical, ...alternates]) {
    const target = normalise(accepted);
    // An accepted form that normalises away has nothing left to compare
    // against, and would otherwise match every empty-ish submission.
    if (target === '') continue;
    const distance = compare(typed, target);
    candidates.push({ accepted, distance, matched: typed !== '' && distance <= allowedEdits(target.length) });
  }

  if (candidates.length === 0) {
    return { matched: false, matchedAnswer: null, distance: typed.length, exact: false, near: false };
  }

  const best = candidates.reduce((incumbent, candidate) =>
    beats(candidate, incumbent) ? candidate : incumbent,
  );

  return {
    matched: best.matched,
    matchedAnswer: best.matched ? best.accepted : null,
    distance: best.distance,
    exact: best.matched && best.distance === 0,
    near: best.matched && best.distance > 0,
  };
}
