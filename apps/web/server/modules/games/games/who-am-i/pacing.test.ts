/**
 * The clock arithmetic behind "got it at clue two".
 *
 * Every figure here decides points, so each rule is pinned where it bites: the
 * boundary between two clues, a pause that moved the schedule, a phone whose
 * answer arrived a moment after the next clue went up, and a phone that claims
 * to have seen less than the clock says it could have.
 */

import { describe, expect, it } from 'vitest';
import { OPTION_SLOTS, decodeChoice, encodeChoice } from './answerCode.js';
import {
  ARRIVAL_ALLOWANCE_MS,
  CLUE_INTERVAL_MS,
  FINAL_CLUE_MS,
  MAX_CLUES,
  ROUND_POINTS,
  answerWindowMsFor,
  clueShownAt,
  creditedClue,
  pointsForClue,
} from './pacing.js';

const OPENED = 1_700_000_000_000;

describe('how long a question lasts', () => {
  it('holds every clue and leaves time to answer after the last', () => {
    expect(answerWindowMsFor(5)).toBe(4 * CLUE_INTERVAL_MS + FINAL_CLUE_MS);
  });

  it('is shorter for a question written with fewer clues', () => {
    expect(answerWindowMsFor(3)).toBe(2 * CLUE_INTERVAL_MS + FINAL_CLUE_MS);
    expect(answerWindowMsFor(1)).toBe(FINAL_CLUE_MS);
  });

  it('never runs longer than five clues allow, however many were written', () => {
    expect(answerWindowMsFor(9)).toBe(answerWindowMsFor(MAX_CLUES));
  });
});

describe('which clue was showing', () => {
  it('shows clue one from the moment the phase opens', () => {
    expect(clueShownAt(OPENED, OPENED, 5)).toBe(1);
    expect(clueShownAt(OPENED + CLUE_INTERVAL_MS - 1, OPENED, 5)).toBe(1);
  });

  it('turns over at each interval, on the dot', () => {
    expect(clueShownAt(OPENED + CLUE_INTERVAL_MS, OPENED, 5)).toBe(2);
    expect(clueShownAt(OPENED + 2 * CLUE_INTERVAL_MS, OPENED, 5)).toBe(3);
    expect(clueShownAt(OPENED + 4 * CLUE_INTERVAL_MS, OPENED, 5)).toBe(5);
  });

  it('stays on the last clue through the time left after it', () => {
    expect(clueShownAt(OPENED + 4 * CLUE_INTERVAL_MS + FINAL_CLUE_MS, OPENED, 5)).toBe(5);
  });

  it('never counts past the clues the question has', () => {
    expect(clueShownAt(OPENED + 10 * CLUE_INTERVAL_MS, OPENED, 3)).toBe(3);
  });

  it('treats a moment before the opening as clue one rather than clue zero', () => {
    expect(clueShownAt(OPENED - 250, OPENED, 5)).toBe(1);
  });

  it('measures from an opening that a pause pushed back', () => {
    // Paused for a minute during clue two. The room moved its deadline by the
    // pause, so an answer after it is measured from the moved opening and is
    // still at clue two, not somewhere past the end.
    const pause = 60_000;
    const answeredAt = OPENED + CLUE_INTERVAL_MS + pause + 500;

    expect(clueShownAt(answeredAt, OPENED + pause, 5)).toBe(2);
  });

  it('follows a pace other than the default when told one', () => {
    expect(clueShownAt(OPENED + 2_500, OPENED, 5, 1_000)).toBe(3);
  });
});

describe('the clue an answer is credited at', () => {
  it('takes the phone at its word when the room gave no opening', () => {
    expect(creditedClue({ claimed: 3, at: OPENED, openedAt: null, clueCount: 5 })).toBe(3);
  });

  it('keeps a claim inside the clues the question has', () => {
    expect(creditedClue({ claimed: 0, at: OPENED, openedAt: null, clueCount: 5 })).toBe(1);
    expect(creditedClue({ claimed: 12, at: OPENED, openedAt: null, clueCount: 5 })).toBe(5);
  });

  it('overrules a phone that claims an earlier clue than the clock allows', () => {
    const at = OPENED + 3 * CLUE_INTERVAL_MS + ARRIVAL_ALLOWANCE_MS + 1;

    expect(creditedClue({ claimed: 1, at, openedAt: OPENED, clueCount: 5 })).toBe(4);
  });

  it('forgives an answer that arrived just after the next clue went up', () => {
    // Tapped at clue one; the network delivered it a moment into clue two.
    const at = OPENED + CLUE_INTERVAL_MS + ARRIVAL_ALLOWANCE_MS - 1;

    expect(creditedClue({ claimed: 1, at, openedAt: OPENED, clueCount: 5 })).toBe(1);
  });

  it('takes a later claim than the clock, which is a solo player who read ahead', () => {
    expect(creditedClue({ claimed: 4, at: OPENED + 500, openedAt: OPENED, clueCount: 5 })).toBe(4);
  });

  it('measures from the pace the round was built with', () => {
    const at = OPENED + 2_000 + ARRIVAL_ALLOWANCE_MS;

    expect(
      creditedClue({ claimed: 1, at, openedAt: OPENED, clueCount: 5, intervalMs: 1_000 })
    ).toBe(3);
  });
});

describe('what each clue is worth', () => {
  it('pays full points at the first clue and a fifth at the fifth, in equal steps', () => {
    expect([1, 2, 3, 4, 5].map(pointsForClue)).toEqual([100, 80, 60, 40, 20]);
    expect(pointsForClue(1)).toBe(ROUND_POINTS);
  });

  it('never pays nothing for being right', () => {
    expect(pointsForClue(99)).toBe(20);
  });

  it('never pays more than full points', () => {
    expect(pointsForClue(0)).toBe(ROUND_POINTS);
    expect(pointsForClue(-3)).toBe(ROUND_POINTS);
  });
});

describe('folding the clue count into a choice', () => {
  it('round-trips every option at every clue', () => {
    for (let option = 0; option < 4; option += 1) {
      for (let seen = 1; seen <= MAX_CLUES; seen += 1) {
        expect(decodeChoice(encodeChoice(option, seen))).toEqual({ option, cluesSeen: seen });
      }
    }
  });

  it('reads a plain index from an older phone as an answer at the first clue', () => {
    expect(decodeChoice(2)).toEqual({ option: 2, cluesSeen: 1 });
  });

  it('pins the arithmetic the phone relies on', () => {
    // The phone carries its own copy of this; the two must agree to the digit.
    expect(OPTION_SLOTS).toBe(8);
    expect(encodeChoice(3, 2)).toBe(11);
    expect(encodeChoice(0, 5)).toBe(32);
  });

  it('never produces a negative index, which the transport would refuse', () => {
    expect(encodeChoice(-1, 0)).toBe(0);
    expect(decodeChoice(-7)).toEqual({ option: 0, cluesSeen: 1 });
  });
});
