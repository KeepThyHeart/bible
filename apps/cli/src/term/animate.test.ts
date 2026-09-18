/**
 * Stepped scrolling.
 *
 * The whole point of `scrollSteps` returning a list instead of running a loop is
 * that the arithmetic can be checked without a terminal, a clock or a sleep —
 * so these tests are about the three properties the doc comment promises, and
 * there is nothing here that has to wait for anything.
 */
import { describe, expect, test } from 'bun:test';

import { scrollSteps } from './animate';

const BUDGET = 100;

function total(steps: readonly { delayMs: number }[]): number {
  return steps.reduce((sum, step) => sum + step.delayMs, 0);
}

describe('scrollSteps', () => {
  test('a scroll that is not moving has nothing to draw', () => {
    expect(scrollSteps(12, 12, BUDGET)).toEqual([]);
  });

  test('no budget means no animation, rather than an instant one', () => {
    // A caller with no time to spend should draw the destination and be done,
    // and an empty list is how it is told to.
    expect(scrollSteps(0, 30, 0)).toEqual([]);
    expect(scrollSteps(0, 30, -5)).toEqual([]);
  });

  test('the first offset is past the start and the last is exactly the target', () => {
    const steps = scrollSteps(0, 20, BUDGET);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps[0]!.offset).not.toBe(0);
    expect(steps.at(-1)!.offset).toBe(20);
  });

  test('a long scroll takes no longer than a short one', () => {
    // Rule 1: the budget is spent, not the distance. This is what stops
    // `pagedown` in Psalm 119 being a visibly slow key.
    const short = scrollSteps(0, 3, BUDGET);
    const long = scrollSteps(0, 300, BUDGET);
    expect(total(long)).toBeLessThanOrEqual(BUDGET);
    expect(total(short)).toBeLessThanOrEqual(BUDGET);
    expect(long.length).toBeLessThanOrEqual(short.length + 3);
  });

  test('frames are capped, so a long scroll moves further per frame', () => {
    const steps = scrollSteps(0, 400, BUDGET);
    expect(steps.length).toBeLessThanOrEqual(6);
    // And it really is covering the ground: the first frame of a 400-row scroll
    // is a long way from the start.
    expect(steps[0]!.offset).toBeGreaterThan(50);
  });

  test('a two-row scroll draws two frames, not six of the same offset', () => {
    expect(scrollSteps(0, 2, BUDGET).map((step) => step.offset)).toEqual([1, 2]);
  });

  test('scrolling up is the same arithmetic backwards', () => {
    const down = scrollSteps(0, 12, BUDGET).map((step) => step.offset);
    const up = scrollSteps(12, 0, BUDGET).map((step) => step.offset);
    expect(up.at(-1)).toBe(0);
    // Mirror images frame for frame: the nth offset going up is 12 minus the
    // nth going down, so the two directions cover the same ground at the same
    // moments rather than merely arriving in the same place.
    expect(up).toEqual(down.map((offset) => 12 - offset));
  });

  test('offsets move monotonically towards the target', () => {
    for (const [from, to] of [
      [0, 17],
      [17, 0],
      [4, 5],
    ] as const) {
      const offsets = scrollSteps(from, to, BUDGET).map((step) => step.offset);
      const sorted = [...offsets].sort((a, b) => (to > from ? a - b : b - a));
      expect(offsets).toEqual(sorted);
    }
  });

  test('a frame is never scheduled below the floor a timer can honour', () => {
    // A tiny budget spread over six frames would ask for a 1ms timer, which no
    // runtime delivers; the floor keeps the animation honest about its duration
    // rather than pretending to a precision it has not got.
    for (const step of scrollSteps(0, 40, 6)) {
      expect(step.delayMs).toBeGreaterThanOrEqual(8);
    }
  });
});
