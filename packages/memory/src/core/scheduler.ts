/**
 * Spaced repetition scheduling.
 *
 * This is a fixed interval ladder, not SM-2. The ease-factor arithmetic in
 * `DesignSpec.md` section 6 was cut deliberately: SM-2 tunes an interval
 * multiplier from a self-reported difficulty rating, and this extension has no
 * such rating - it has an objective score. Feeding an objective score into a
 * model designed for a subjective one produces intervals that drift for
 * reasons no user can predict or explain. A fixed ladder is legible: a user
 * can be told "you will see this again in a week", and it will be true.
 *
 * The one piece of SM-2's spirit that is kept is jitter, and it is load-
 * bearing rather than decorative - see `JITTER_FRACTION`.
 */

/** Milliseconds in a day. Extracted because it appears in every calculation. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The interval ladder, in days.
 *
 * Ends at 180 rather than running to a year: a passage seen twice a year is
 * one the user will discover they have lost at the worst possible moment.
 * Half a year is long enough that a mastered passage costs almost nothing and
 * short enough to catch decay.
 */
export const INTERVALS_DAYS: readonly number[] = [1, 3, 7, 16, 35, 90, 180];

/**
 * How far a due date is randomly displaced, as a fraction of its interval.
 *
 * Without this, everything added on one day comes due on the same day
 * **forever**: the ladder is deterministic, so a cohort added together
 * advances together and stays clumped for the life of the plan. A user who
 * adds twelve passages on a Sunday afternoon would face all twelve every time
 * they surfaced. +/-15% is enough to disperse a cohort within two or three
 * rungs while never moving a due date far enough for the user to notice it as
 * wrong.
 */
export const JITTER_FRACTION = 0.15;

/**
 * Score below which a failure is treated as "this is gone" rather than "this
 * slipped", sending the card back to the start of the ladder instead of back
 * one rung.
 *
 * At 0.5 the user got fewer than half the steps right on the first try, which
 * is not a lapse in a memorised passage - it is a passage that was never
 * really memorised, and stepping back one interval would ask it again in a
 * fortnight and fail again.
 */
export const RESET_THRESHOLD = 0.5;

import { PASS_THRESHOLD } from './ladder';

export interface ScheduleInput {
  /** Index into `INTERVALS_DAYS`; -1 for a card that has never passed. */
  intervalStep: number;
  streak: number;
  score: number;
  /** Epoch ms. Injected rather than read from the clock so this is testable. */
  now: number;
  /** 0..1. Injected so scheduling is deterministic under test. */
  rng: () => number;
}

export interface ScheduleResult {
  intervalStep: number;
  streak: number;
  dueAt: number;
  /** True when the card is now at the top of the interval ladder. */
  atTopInterval: boolean;
  passed: boolean;
}

/**
 * Compute the next state of a card after a graded, non-replay attempt.
 *
 * Callers must not pass replays here at all. That is enforced by the caller
 * rather than by a flag on the input, because a scheduling function that
 * quietly does nothing for some inputs is a trap - the absence of a call is
 * much easier to see than a no-op inside one.
 */
export function schedule(input: ScheduleInput): ScheduleResult {
  const { score, now, rng } = input;
  const passed = score >= PASS_THRESHOLD;

  let intervalStep: number;
  let streak: number;

  if (passed) {
    intervalStep = Math.min(input.intervalStep + 1, INTERVALS_DAYS.length - 1);
    streak = input.streak + 1;
  } else {
    streak = 0;
    intervalStep = score < RESET_THRESHOLD ? 0 : Math.max(0, input.intervalStep - 1);
  }

  const days = INTERVALS_DAYS[intervalStep] as number;
  return {
    intervalStep,
    streak,
    dueAt: now + applyJitter(days * DAY_MS, rng),
    atTopInterval: intervalStep === INTERVALS_DAYS.length - 1,
    passed,
  };
}

/**
 * Displace a delay by up to +/-`JITTER_FRACTION`, never below one hour.
 *
 * The floor matters for the one-day interval: 15% of a day is three and a half
 * hours, and a card that lands earlier in the same evening reads as a bug
 * rather than as scheduling.
 */
function applyJitter(delayMs: number, rng: () => number): number {
  const factor = 1 + (rng() * 2 - 1) * JITTER_FRACTION;
  return Math.max(60 * 60 * 1000, Math.round(delayMs * factor));
}

/**
 * The due date for a card that has just been unlocked but never attempted.
 *
 * Immediately, not tomorrow. A newly unlocked rung the user cannot practise
 * until the next day is a rung that looks broken - they unlocked it by doing
 * well, and the reward should be available now.
 */
export function initialDueAt(now: number): number {
  return now;
}

/** Whether a card is due at `now`. A locked card (`dueAt === null`) never is. */
export function isDue(dueAt: number | null, now: number): boolean {
  return dueAt !== null && dueAt <= now;
}

/**
 * A seeded PRNG (mulberry32).
 *
 * Present because the realm has no `crypto` and because `Math.random` would
 * make scheduling untestable. Callers that genuinely want unpredictability
 * seed it from the clock; tests seed it from a constant.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
