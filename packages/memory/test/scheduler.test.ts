/**
 * Scheduling tests.
 *
 * `scheduler.ts` is a fixed interval ladder rather than SM-2, and the value of
 * that choice is *legibility*: a user can be told "you will see this again in
 * a week" and it will be true. So the tests below assert concrete positions on
 * `INTERVALS_DAYS` rather than "the interval got bigger" - a test phrased as an
 * inequality would pass just as happily against the ease-factor drift the
 * design deliberately rejected.
 *
 * The jitter block is the substantial one. Jitter looks decorative and is not:
 * without it the ladder is fully deterministic, so a cohort of passages added
 * on one Sunday afternoon advances in lockstep and comes due together for the
 * life of the plan. That failure is invisible in any single-card test - every
 * card is individually correct - so it is asserted directly, by scheduling two
 * cards at the same instant with the same interval and requiring them to
 * separate.
 */

import { describe, it, expect } from 'vitest';
import {
  schedule,
  makeRng,
  isDue,
  initialDueAt,
  INTERVALS_DAYS,
  JITTER_FRACTION,
  RESET_THRESHOLD,
} from '../src/core/scheduler';
import { PASS_THRESHOLD } from '../src/core/ladder';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TOP = INTERVALS_DAYS.length - 1;

/** A fixed instant, so nothing here depends on when the suite runs. */
const NOW = Date.UTC(2026, 0, 15, 9, 0, 0);

/** An RNG pinned to one value, for asserting the interval without the noise. */
const fixedRng = (value: number) => () => value;

/** rng() === 0.5 is the centre of the jitter window: factor exactly 1. */
const noJitter = fixedRng(0.5);

describe('schedule - moving along the interval ladder', () => {
  it('advances one step on a pass, from the never-passed state', () => {
    // -1 is the documented "has never passed" sentinel, so the first pass has
    // to land on index 0 (one day) and not on index 1. An off-by-one here
    // would skip the one-day consolidation that the whole ladder is built on.
    const r = schedule({ intervalStep: -1, streak: 0, score: 1, now: NOW, rng: noJitter });
    expect(r.intervalStep).toBe(0);
    expect(r.passed).toBe(true);
    expect(r.streak).toBe(1);
    expect(r.dueAt - NOW).toBe(INTERVALS_DAYS[0]! * DAY_MS);
  });

  it('advances exactly one step per pass, never two', () => {
    // Walked rung by rung rather than jumped to, because the promise made to
    // the user ("a week, then a fortnight") is only true if a pass moves one
    // position. A `+2` or a doubling would still produce a growing sequence
    // and still pass a naive "interval increased" assertion.
    let step = -1;
    for (let i = 0; i < INTERVALS_DAYS.length; i++) {
      const r = schedule({ intervalStep: step, streak: i, score: 1, now: NOW, rng: noJitter });
      expect(r.intervalStep).toBe(i);
      expect(r.dueAt - NOW).toBe(INTERVALS_DAYS[i]! * DAY_MS);
      step = r.intervalStep;
    }
  });

  it('treats PASS_THRESHOLD itself as a pass and one tick below it as a fail', () => {
    // The boundary is asserted from both sides because it is a `>=` that a
    // refactor could easily turn into a `>`, and the failure mode - a passage
    // the user genuinely knows never advancing - is one they would experience
    // as the app not working rather than as a scoring rule.
    expect(schedule({ intervalStep: 2, streak: 1, score: PASS_THRESHOLD, now: NOW, rng: noJitter }).passed).toBe(true);
    expect(schedule({ intervalStep: 2, streak: 1, score: PASS_THRESHOLD - 0.001, now: NOW, rng: noJitter }).passed).toBe(false);
  });

  it('does not exceed the top of the ladder', () => {
    // Half a year is the deliberate ceiling: a passage seen twice a year is
    // one the user discovers they have lost at the worst possible moment.
    // Clamping - rather than growing past the array and reading `undefined`
    // days - is what keeps `dueAt` a number at all.
    const r = schedule({ intervalStep: TOP, streak: 9, score: 1, now: NOW, rng: noJitter });
    expect(r.intervalStep).toBe(TOP);
    expect(r.atTopInterval).toBe(true);
    expect(r.dueAt - NOW).toBe(INTERVALS_DAYS[TOP]! * DAY_MS);
    expect(Number.isFinite(r.dueAt)).toBe(true);
  });

  it('only reports atTopInterval at the actual top', () => {
    // `atTopInterval` is what `cardStateFor` turns into the `mastered` badge,
    // so a card one rung short must not claim it.
    const r = schedule({ intervalStep: TOP - 2, streak: 3, score: 1, now: NOW, rng: noJitter });
    expect(r.atTopInterval).toBe(false);
  });
});

describe('schedule - failing', () => {
  it('sends a bad failure all the way back to step 0', () => {
    // Below 0.5 the user got fewer than half the steps right on the first
    // try. That is not a lapse in a memorised passage, it is a passage that
    // was never memorised, and stepping back one rung would ask it again in a
    // fortnight and fail again. The card restarts from a mastered position to
    // prove the reset is absolute rather than proportional.
    const r = schedule({
      intervalStep: TOP,
      streak: 6,
      score: RESET_THRESHOLD - 0.01,
      now: NOW,
      rng: noJitter,
    });
    expect(r.intervalStep).toBe(0);
    expect(r.streak).toBe(0);
    expect(r.dueAt - NOW).toBe(INTERVALS_DAYS[0]! * DAY_MS);
  });

  it('steps a mild failure back exactly one rung', () => {
    // Between RESET_THRESHOLD and PASS_THRESHOLD the passage is known and
    // slipping, so the correct response is to see it sooner - not to throw
    // away every interval the user earned.
    const r = schedule({ intervalStep: 4, streak: 3, score: 0.6, now: NOW, rng: noJitter });
    expect(r.intervalStep).toBe(3);
    expect(r.streak).toBe(0);
    expect(r.dueAt - NOW).toBe(INTERVALS_DAYS[3]! * DAY_MS);
  });

  it('treats RESET_THRESHOLD itself as a mild failure, not a reset', () => {
    // The comparison is `score < RESET_THRESHOLD`, so exactly 0.5 steps back
    // one. Pinned from both sides so the boundary cannot drift silently.
    expect(schedule({ intervalStep: 4, streak: 1, score: RESET_THRESHOLD, now: NOW, rng: noJitter }).intervalStep).toBe(3);
    expect(schedule({ intervalStep: 4, streak: 1, score: RESET_THRESHOLD - 0.0001, now: NOW, rng: noJitter }).intervalStep).toBe(0);
  });

  it('floors a mild failure at step 0 rather than going negative', () => {
    // A card at step 0 that slips has nowhere below it. Returning -1 would
    // put it back in the "never passed" sentinel state and index
    // INTERVALS_DAYS[-1], which is `undefined` and yields NaN for `dueAt`.
    const r = schedule({ intervalStep: 0, streak: 1, score: 0.6, now: NOW, rng: noJitter });
    expect(r.intervalStep).toBe(0);
    expect(Number.isFinite(r.dueAt)).toBe(true);
  });

  it('resets the streak on any failure, mild or bad', () => {
    // `streak` is stored and shown ("3 passes in a row") but nothing gates on
    // it any more - task 0004 dropped the promotion it used to feed. A
    // failure that left it intact would still be the wrong number to show.
    expect(schedule({ intervalStep: 3, streak: 5, score: 0.79, now: NOW, rng: noJitter }).streak).toBe(0);
    expect(schedule({ intervalStep: 3, streak: 5, score: 0.1, now: NOW, rng: noJitter }).streak).toBe(0);
  });
});

describe('jitter', () => {
  it('lands within +/-JITTER_FRACTION of the nominal interval, at every rung', () => {
    // The window has to be *bounded* as well as random: 15% of a week is a
    // day, which a user reads as scheduling. 50% of a week is three and a
    // half days, which they read as the app forgetting. Every rung is checked
    // because the fraction is relative and the top rung's absolute swing
    // (27 days) is the one that would look wrong first.
    for (let step = -1; step < INTERVALS_DAYS.length; step++) {
      for (let seed = 1; seed <= 40; seed++) {
        const r = schedule({
          intervalStep: step,
          streak: 1,
          score: 1,
          now: NOW,
          rng: makeRng(seed),
        });
        // Nominal is read off the rung the card LANDED on, not the one it
        // came from: a pass advances first and jitters the new interval.
        const nominal = INTERVALS_DAYS[r.intervalStep]! * DAY_MS;
        const delay = r.dueAt - NOW;
        // +/-1ms of slack for the Math.round inside applyJitter.
        expect(delay).toBeGreaterThanOrEqual(Math.round(nominal * (1 - JITTER_FRACTION)) - 1);
        expect(delay).toBeLessThanOrEqual(Math.round(nominal * (1 + JITTER_FRACTION)) + 1);
      }
    }
  });

  it('spans a real range rather than collapsing to the nominal interval', () => {
    // A jitter implementation that accidentally ignored its RNG (a stray
    // `0.5`, a factor computed but not applied) would satisfy the bounds
    // assertion above perfectly while providing no dispersion at all. So the
    // spread is required to be non-trivial: at least a third of the available
    // window has to be visible across forty seeds.
    // A pass from step 2 lands on step 3, so that is the nominal interval.
    const nominal = INTERVALS_DAYS[3]! * DAY_MS;
    const delays = Array.from({ length: 40 }, (_, i) =>
      schedule({ intervalStep: 2, streak: 1, score: 1, now: NOW, rng: makeRng(i + 1) }).dueAt - NOW,
    );
    const spread = Math.max(...delays) - Math.min(...delays);
    expect(spread).toBeGreaterThan(nominal * JITTER_FRACTION * 2 * 0.33);
  });

  it('never schedules anything less than an hour out', () => {
    // The one-hour floor exists so that a one-day card jittered downward
    // cannot land back in the same evening, which reads as a bug rather than
    // as scheduling. Note the floor is currently defence-in-depth rather than
    // load-bearing: the shortest rung is a full day and 85% of a day is still
    // 20.4 hours, so no reachable input can trip it. That is exactly why it
    // is asserted as an invariant over the extremes of the RNG range - if a
    // shorter rung (an hourly "cram" interval, say) is ever added to
    // INTERVALS_DAYS, this test is what says whether the floor still holds.
    // Scores are varied as well as rungs so that the *shortest* reachable
    // interval - step 0, one day, produced by a bad failure - is covered
    // alongside the rest. A pass always advances, so a pass-only loop would
    // never exercise it.
    for (let step = -1; step < INTERVALS_DAYS.length; step++) {
      for (const score of [1, 0.6, 0.1]) {
        for (const value of [0, 0.0001, 0.5, 0.9999]) {
          const r = schedule({
            intervalStep: step,
            streak: 1,
            score,
            now: NOW,
            rng: fixedRng(value),
          });
          expect(r.dueAt - NOW).toBeGreaterThanOrEqual(HOUR_MS);
        }
      }
    }
  });

  it('separates two cards scheduled at the same instant with the same interval', () => {
    // This is the whole reason jitter exists, and it is the only assertion in
    // the file that can catch its removal. Everything a user adds in one
    // sitting starts at the same `now` on the same rung; without jitter every
    // one of those cards gets an identical `dueAt` and the cohort stays
    // clumped forever, so the user faces twelve passages at once every time
    // they surface. Different RNG streams must produce different dates.
    const a = schedule({ intervalStep: 2, streak: 1, score: 1, now: NOW, rng: makeRng(1) });
    const b = schedule({ intervalStep: 2, streak: 1, score: 1, now: NOW, rng: makeRng(2) });
    expect(a.intervalStep).toBe(b.intervalStep);
    expect(a.dueAt).not.toBe(b.dueAt);
  });

  it('disperses a whole cohort, not just a lucky pair', () => {
    // A dozen passages added on one afternoon is the scenario in the design
    // note. Requiring the twelve due dates to be *mostly* distinct guards
    // against a jitter that quantised to something coarse (whole days, say),
    // which would separate two cards while still leaving a cohort clumped.
    const cohort = Array.from({ length: 12 }, (_, i) =>
      schedule({ intervalStep: 3, streak: 1, score: 1, now: NOW, rng: makeRng(100 + i) }).dueAt,
    );
    expect(new Set(cohort).size).toBe(cohort.length);
  });
});

describe('makeRng', () => {
  it('is deterministic for a fixed seed', () => {
    // Scheduling has to be reproducible under test, and the panel's picker
    // relies on the same property to re-serve an identical step after a wrong
    // pick. Two generators from one seed must agree value for value.
    const a = makeRng(20260115);
    const b = makeRng(20260115);
    const first = Array.from({ length: 25 }, () => a());
    const second = Array.from({ length: 25 }, () => b());
    expect(first).toEqual(second);
  });

  it('produces different streams for different seeds', () => {
    // If seeding were ineffective, every card scheduled in one session would
    // share a stream and jitter would stop dispersing anything.
    const a = Array.from({ length: 10 }, makeRng(1));
    const b = Array.from({ length: 10 }, makeRng(2));
    expect(a).not.toEqual(b);
  });

  it('stays inside [0, 1)', () => {
    // `shuffled` clamps against a hostile RNG, but `applyJitter` does not: a
    // value above 1 would push a due date outside the documented window.
    const rng = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('does not repeat itself over a short run', () => {
    // A seeding bug that reset the state each call would return a constant,
    // which satisfies determinism and range while destroying jitter.
    const rng = makeRng(42);
    const values = new Set(Array.from({ length: 200 }, () => rng()));
    expect(values.size).toBeGreaterThan(190);
  });
});

describe('initialDueAt / isDue', () => {
  it('makes a newly unlocked rung available immediately', () => {
    // The reward for doing well is the next rung, and a rung the user cannot
    // touch until tomorrow looks broken rather than scheduled.
    expect(initialDueAt(NOW)).toBe(NOW);
    expect(isDue(initialDueAt(NOW), NOW)).toBe(true);
  });

  it('never treats a locked card as due', () => {
    // `dueAt === null` is how a locked card is represented, and it is the
    // same null that `dueCount`'s `IS NOT NULL` filter relies on. Both layers
    // have to agree or a locked rung appears in the due badge.
    expect(isDue(null, NOW)).toBe(false);
    expect(isDue(NOW - 1, NOW)).toBe(true);
    expect(isDue(NOW + 1, NOW)).toBe(false);
  });
});
