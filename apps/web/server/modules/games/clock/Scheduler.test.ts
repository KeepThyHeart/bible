import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from './Scheduler.js';
import type { Timers, TimerIntent } from './Scheduler.js';
import type { Effect } from '../../../../src/modules/games/shared/protocol.js';

const START = 1_700_000_000_000;

/**
 * A timer implementation whose clock is driven by hand, so a test can do what
 * fake timers cannot: run a callback *late*, the way a starved or suspended
 * process does.
 */
function manualTimers(start: number) {
  let now = start;
  let sequence = 0;
  const pending = new Map<number, { at: number; run: () => void }>();

  const timers: Timers = {
    set(run, delayMs) {
      sequence += 1;
      pending.set(sequence, { at: now + delayMs, run });
      return sequence;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };

  return {
    timers,
    now: () => now,
    jumpTo(time: number) {
      now = time;
    },
    /** Run every callback whose deadline has passed, earliest first. */
    drain() {
      for (let guard = 0; guard < 10_000; guard += 1) {
        const due = [...pending.entries()]
          .filter(([, entry]) => entry.at <= now)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) return;
        pending.delete(due[0]);
        due[1].run();
      }
      throw new Error('timers did not settle');
    },
    count: () => pending.size,
  };
}

describe('Scheduler', () => {
  let fired: TimerIntent[];

  beforeEach(() => {
    fired = [];
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function build(): Scheduler {
    return new Scheduler((intent) => fired.push(intent));
  }

  it('fires the timer intent at the requested moment and not before', () => {
    const scheduler = build();
    scheduler.schedule(START + 2_500, 3, 'reveal');

    vi.advanceTimersByTime(2_499);
    expect(fired).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(fired).toEqual([{ kind: 'timer', round: 3, tag: 'reveal' }]);
    expect(scheduler.pending()).toEqual([]);
  });

  it('splits a long wait into hops without losing the deadline', () => {
    const scheduler = build();
    scheduler.schedule(START + 600_000, 1, 'answerWindow');

    vi.advanceTimersByTime(599_999);
    expect(fired).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(fired).toHaveLength(1);
  });

  it('fires immediately for a moment that has already passed', () => {
    const scheduler = build();
    scheduler.schedule(START - 5_000, 2, 'reveal');

    // Not synchronously: the state change that asked for this must land first.
    expect(fired).toEqual([]);

    vi.advanceTimersByTime(0);
    expect(fired).toEqual([{ kind: 'timer', round: 2, tag: 'reveal' }]);
  });

  it('cancels every timer of one round and leaves the others armed', () => {
    const scheduler = build();
    scheduler.schedule(START + 1_000, 4, 'reveal');
    scheduler.schedule(START + 2_000, 4, 'warning');
    scheduler.schedule(START + 3_000, 5, 'reveal');

    scheduler.apply([{ type: 'cancelTimers', round: 4 }]);
    expect(scheduler.pending().map((entry) => entry.round)).toEqual([5]);

    vi.advanceTimersByTime(10_000);
    expect(fired).toEqual([{ kind: 'timer', round: 5, tag: 'reveal' }]);
  });

  it('replaces a deadline when the same round and tag is scheduled again', () => {
    const scheduler = build();
    scheduler.schedule(START + 1_000, 6, 'answerWindow');
    scheduler.schedule(START + 3_000, 6, 'answerWindow');

    vi.advanceTimersByTime(1_500);
    expect(fired).toEqual([]);

    vi.advanceTimersByTime(1_600);
    expect(fired).toHaveLength(1);
  });

  it('performs timer effects from a reducer step and ignores the rest', () => {
    const scheduler = build();
    const effects: Effect[] = [
      { type: 'persist' },
      { type: 'timer', at: START + 500, round: 7, tag: 'reveal' },
      { type: 'requestJudge', round: 7, playerId: 'p1' },
    ];

    scheduler.apply(effects);
    expect(scheduler.pending()).toEqual([{ round: 7, tag: 'reveal', at: START + 500 }]);

    vi.advanceTimersByTime(500);
    expect(fired).toEqual([{ kind: 'timer', round: 7, tag: 'reveal' }]);
  });

  it('leaves nothing armed after cancelling everything', () => {
    const scheduler = build();
    scheduler.schedule(START + 1_000, 8, 'reveal');
    scheduler.schedule(START + 1_000, 9, 'reveal');

    scheduler.cancelAll();
    vi.advanceTimersByTime(10_000);

    expect(fired).toEqual([]);
    expect(scheduler.pending()).toEqual([]);
  });

  it('fires once, on the clock, when the process was suspended past the deadline', () => {
    const driven = manualTimers(START);
    const scheduler = new Scheduler((intent) => fired.push(intent), {
      now: driven.now,
      timers: driven.timers,
    });

    scheduler.schedule(START + 60_000, 10, 'reveal');

    // Five minutes vanish: the machine slept and the first hop only runs on
    // the far side of a deadline that is now long past.
    driven.jumpTo(START + 300_000);
    driven.drain();

    expect(fired).toEqual([{ kind: 'timer', round: 10, tag: 'reveal' }]);
    expect(driven.count()).toBe(0);
  });

  it('does not fire early when a hop runs before the deadline', () => {
    const driven = manualTimers(START);
    const scheduler = new Scheduler((intent) => fired.push(intent), {
      now: driven.now,
      timers: driven.timers,
    });

    scheduler.schedule(START + 4_000, 11, 'reveal');

    driven.jumpTo(START + 3_999);
    driven.drain();
    expect(fired).toEqual([]);

    driven.jumpTo(START + 4_000);
    driven.drain();
    expect(fired).toHaveLength(1);
  });
});
