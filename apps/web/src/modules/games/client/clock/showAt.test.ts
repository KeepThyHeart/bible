// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showAt, serverNow, msUntil } from './showAt.js';
import type { ClockReader } from './offset.js';

const START = 1_700_000_000_000;

/** A clock whose offset the test can move, the way a re-measurement does. */
function reader(): ClockReader & { setOffset(ms: number): void } {
  let offset = 0;
  return {
    setOffset(ms: number) {
      offset = ms;
    },
    serverNow: () => Date.now() + offset,
    toLocalTime: (at: number) => at - offset,
  };
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('showAt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    setVisibility('visible');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the task when the server clock reaches the moment', () => {
    const clock = reader();
    clock.setOffset(5_000);
    let ran = 0;

    showAt(clock.serverNow() + 3_000, () => (ran += 1), { clock });

    vi.advanceTimersByTime(2_999);
    expect(ran).toBe(0);

    vi.advanceTimersByTime(1);
    expect(ran).toBe(1);
  });

  it('runs immediately for a moment that has already passed', () => {
    const clock = reader();
    let ran = 0;

    showAt(clock.serverNow() - 1, () => (ran += 1), { clock });
    expect(ran).toBe(1);
  });

  it('does not run after being cancelled', () => {
    const clock = reader();
    let ran = 0;

    const cancel = showAt(clock.serverNow() + 1_000, () => (ran += 1), { clock });
    cancel();

    vi.advanceTimersByTime(10_000);
    expect(ran).toBe(0);
  });

  it('survives a wait longer than one hop', () => {
    const clock = reader();
    let ran = 0;

    showAt(clock.serverNow() + 20_000, () => (ran += 1), { clock });

    vi.advanceTimersByTime(19_999);
    expect(ran).toBe(0);

    vi.advanceTimersByTime(1);
    expect(ran).toBe(1);
  });

  it('runs on waking when the moment passed while the page was hidden', () => {
    const clock = reader();
    let ran = 0;

    showAt(clock.serverNow() + 3_000, () => (ran += 1), { clock });

    // The phone slept: wall time moved on, but the timer never got a turn.
    setVisibility('hidden');
    vi.setSystemTime(START + 10_000);
    expect(ran).toBe(0);

    setVisibility('visible');
    expect(ran).toBe(1);

    // And having run on waking, it does not run again when the timer catches up.
    vi.advanceTimersByTime(60_000);
    expect(ran).toBe(1);
  });

  it('waits on when the page comes back before the moment', () => {
    const clock = reader();
    let ran = 0;

    showAt(clock.serverNow() + 3_000, () => (ran += 1), { clock });

    setVisibility('hidden');
    vi.setSystemTime(START + 1_000);
    setVisibility('visible');
    expect(ran).toBe(0);

    vi.advanceTimersByTime(3_000);
    expect(ran).toBe(1);
  });

  it('picks up a revised offset on its next check rather than at the old deadline', () => {
    const clock = reader();
    let ran = 0;

    showAt(clock.serverNow() + 60_000, () => (ran += 1), { clock });

    vi.advanceTimersByTime(5_000);
    expect(ran).toBe(0);

    // A fresh measurement finds this phone a minute behind the server. The
    // moment is now in the past, and the next hop is where that is noticed.
    clock.setOffset(60_000);
    vi.advanceTimersByTime(5_000);
    expect(ran).toBe(1);
  });

  it('cancels harmlessly after it has already run', () => {
    const clock = reader();
    let ran = 0;

    const cancel = showAt(clock.serverNow() + 1_000, () => (ran += 1), { clock });
    vi.advanceTimersByTime(1_000);
    expect(ran).toBe(1);

    cancel();
    vi.advanceTimersByTime(10_000);
    expect(ran).toBe(1);
  });

  it('stops listening once it has run', () => {
    const clock = reader();
    let ran = 0;

    showAt(clock.serverNow() + 1_000, () => (ran += 1), { clock });
    vi.advanceTimersByTime(1_000);

    setVisibility('hidden');
    setVisibility('visible');
    expect(ran).toBe(1);
  });
});

describe('serverNow and msUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the current server instant through the offset', () => {
    const clock = reader();
    clock.setOffset(2_500);
    expect(serverNow(clock)).toBe(START + 2_500);
  });

  it('counts down from the deadline and never below zero', () => {
    const clock = reader();
    expect(msUntil(START + 4_000, clock)).toBe(4_000);
    vi.setSystemTime(START + 3_000);
    expect(msUntil(START + 4_000, clock)).toBe(1_000);
    vi.setSystemTime(START + 9_000);
    expect(msUntil(START + 4_000, clock)).toBe(0);
  });
});
