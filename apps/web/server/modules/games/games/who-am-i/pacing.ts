/**
 * When each clue appears, and what an answer at each clue is worth.
 *
 * Clues are paced by the server in group play so that "got it at clue two"
 * means the same thing on every phone: everyone saw clue two appear at the
 * same server instant, so an answer given before clue three is comparable
 * between two people in the same room. A phone never starts its own stopwatch
 * when a message arrives; it reads the room's deadline and works backwards, and
 * so does everything here.
 *
 * The whole round is one answering phase. The room refuses answers during its
 * reading phase, and the four options have to be tappable from the first clue
 * — a person who is sure at clue one should be paid for being sure at clue
 * one — so the clues are revealed inside the answer window rather than before
 * it. The window is sized to hold all five clues plus time to think after the
 * last.
 */

import type { ServerTime } from '../../../../../src/modules/games/shared/protocol.js';

/**
 * Time between clues. Long enough to read a twelve-word clue aloud from the
 * back of a room and glance at the options; short enough that nobody who is
 * already sure is left waiting to be allowed to answer.
 */
export const CLUE_INTERVAL_MS = 7_000;

/**
 * Time after the last clue appears. The last clue is usually the giveaway, and
 * someone who has only just got it needs long enough to find the button.
 */
export const FINAL_CLUE_MS = 10_000;

/** Every question is written with five clues; a round shows at most this many. */
export const MAX_CLUES = 5;

/** The same scale as every other game, so a mixed evening adds up. */
export const ROUND_POINTS = 100;

/**
 * How far an answer's arrival may trail the tap that sent it and still be
 * credited at the clue the phone was showing.
 *
 * The server times an answer by when it arrived, and over cellular that can be
 * most of a second after the tap. Without an allowance a player who tapped
 * just before clue three appeared would be scored at clue three by the network
 * rather than by what they knew. The allowance is small next to the gap
 * between clues, so the most a dishonest phone could gain by claiming an
 * earlier clue is this long, never a whole clue.
 */
export const ARRIVAL_ALLOWANCE_MS = 1_000;

/** How long the answering phase lasts for a question with this many clues. */
export function answerWindowMsFor(clueCount: number): number {
  const shown = Math.max(1, Math.min(MAX_CLUES, clueCount));
  return (shown - 1) * CLUE_INTERVAL_MS + FINAL_CLUE_MS;
}

/**
 * Which clue was on the screen at `at`, counted from one, for a phase that
 * opened at `openedAt`.
 *
 * `openedAt` must be the opening as it stood when `at` happened, which is not
 * always the moment the phase began: a pause pushes the room's deadline back
 * by its own length, and the clue schedule moves with the deadline. An answer
 * that arrived after a pause is measured from the opening moved by that pause;
 * one that arrived before it is measured from the original. That is why the
 * opening belongs to each answer rather than to the round.
 *
 * Anything before the opening is clue one, and anything after the last clue is
 * the last clue: the clamps turn a clock that disagrees by a few milliseconds
 * into a rounding question rather than an out-of-range index.
 */
export function clueShownAt(
  at: ServerTime,
  openedAt: ServerTime,
  clueCount: number,
  intervalMs: number = CLUE_INTERVAL_MS
): number {
  const count = Math.max(1, clueCount);
  const elapsed = at - openedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 1;
  return Math.min(count, Math.floor(elapsed / intervalMs) + 1);
}

/**
 * The clue an answer is credited at: the later of what the phone says it was
 * showing and what the server's own clock says was showing.
 *
 * The phone's figure exists because in solo the player turns the clues over
 * themselves, and nothing but the phone knows how far they went. It is only
 * ever allowed to cost the player: a phone that claims an earlier clue than the
 * server's clock allows is overruled by the clock, less the arrival allowance.
 * A phone that claims a later clue than the clock — a solo player who read
 * ahead — is taken at its word, because reading ahead is exactly what it is
 * reporting.
 *
 * `openedAt` is null when the room did not say when the phase opened. Then the
 * phone's figure is all there is, which is exact in solo and trusting in a
 * group; see `openedAtOf` in the module for why that can happen.
 */
export function creditedClue(options: {
  claimed: number;
  at: ServerTime;
  openedAt: ServerTime | null;
  clueCount: number;
  intervalMs?: number;
}): number {
  const count = Math.max(1, options.clueCount);
  const claimed = Math.min(count, Math.max(1, Math.trunc(options.claimed)));
  if (options.openedAt === null) return claimed;
  const floor = clueShownAt(
    options.at - ARRIVAL_ALLOWANCE_MS,
    options.openedAt,
    count,
    options.intervalMs ?? CLUE_INTERVAL_MS
  );
  return Math.max(claimed, floor);
}

/**
 * What a right answer at this clue earns: full points at clue one, a fifth at
 * clue five, in equal steps.
 *
 * Equal steps rather than halving because the last clue is usually the one
 * that names the famous deed, and a player who needed it still knew the story;
 * twenty points says so. Nothing drops to zero for being right.
 *
 * Points follow how many clues were seen, not what fraction of the question's
 * clues: a question written with only three clues pays sixty at its last one,
 * not twenty, because the player saw three clues and no more.
 */
export function pointsForClue(clue: number): number {
  const seen = Math.min(MAX_CLUES, Math.max(1, Math.trunc(clue)));
  return Math.round((ROUND_POINTS * (MAX_CLUES - seen + 1)) / MAX_CLUES);
}
