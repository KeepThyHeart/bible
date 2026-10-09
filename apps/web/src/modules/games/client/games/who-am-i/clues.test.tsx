// @vitest-environment jsdom
/**
 * Clue timing, driven by a clock moved by hand.
 *
 * Nothing here waits. The clock is a port the test owns: it says what time the
 * server thinks it is, and it runs the scheduled clue when the test moves time
 * past it. That is what lets these assert the things that go wrong on real
 * phones — a screen that mounted late, a pause, a resume — without a flake.
 */

import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerTime, SnapshotCommon } from '../../../shared/protocol.js';
import { DEFAULT_THEME } from '../../../shared/theme.js';
import type { ClockPort } from '../../shell/clockPort.js';
import { openedAtFor, scheduledClues, useCluesShown } from './clues.js';
import type { WhoAmIRound } from './payload.js';

const OPENED = 1_700_000_000_000;
const INTERVAL = 7_000;
const WINDOW = 4 * INTERVAL + 10_000;

const ROUND: WhoAmIRound = {
  pacing: 'server',
  clues: ['one', 'two', 'three', 'four', 'five'],
  options: [{ index: 0, label: 'Adam' }],
  clueIntervalMs: INTERVAL,
  answerWindowMs: WINDOW,
  groupVote: false,
};

interface ManualClock {
  port: ClockPort;
  advance(ms: number): void;
  now(): ServerTime;
  pending(): number;
}

function manualClock(start: ServerTime): ManualClock {
  let now = start;
  const tasks: { at: ServerTime; task: () => void; live: boolean }[] = [];
  const listeners = new Set<() => void>();
  const port: ClockPort = {
    serverNow: () => now,
    msUntil: (at) => Math.max(0, at - now),
    showAt: (at, task) => {
      if (at <= now) {
        task();
        return () => undefined;
      }
      const entry = { at, task, live: true };
      tasks.push(entry);
      return () => {
        entry.live = false;
      };
    },
    report: () => null,
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    port,
    advance(ms) {
      now += ms;
      for (;;) {
        const due = tasks.filter((entry) => entry.live && entry.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.live = false;
        due.task();
      }
    },
    now: () => now,
    pending: () => tasks.filter((entry) => entry.live).length,
  };
}

function snapshot(overrides: Partial<SnapshotCommon> = {}): SnapshotCommon {
  return {
    code: 'QK7P',
    phase: 'answering',
    paused: false,
    round: 0,
    totalRounds: 10,
    settings: {
      gameId: 'who-am-i',
      setId: null,
      translation: 'KJV',
      teamsEnabled: false,
      rounds: 10,
      answerWindowMs: 20_000,
      showIndividualScores: false,
      solo: false,
      groupVote: false,
      familiarity: 'broad',
      gameOptions: {},
      theme: DEFAULT_THEME,
    },
    players: [],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: OPENED + WINDOW,
    phaseDurationMs: null,
    revealAt: OPENED,
    serverTime: OPENED,
    ...overrides,
  };
}

function Probe({ common, clock }: { common: SnapshotCommon; clock: ClockPort }) {
  return <span>{useCluesShown(ROUND, common, clock)}</span>;
}

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

function draw(common: SnapshotCommon, clock: ClockPort): void {
  act(() => {
    render(<Probe common={common} clock={clock} />, host);
  });
}

function shown(): number {
  return Number(host.textContent);
}

describe('the schedule', () => {
  it('works back from the deadline to the opening', () => {
    expect(openedAtFor(OPENED + WINDOW, WINDOW)).toBe(OPENED);
    expect(openedAtFor(null, WINDOW)).toBeNull();
  });

  it('shows one clue at the opening and another at each interval', () => {
    expect(scheduledClues(OPENED, OPENED, INTERVAL, 5)).toBe(1);
    expect(scheduledClues(OPENED, OPENED + INTERVAL - 1, INTERVAL, 5)).toBe(1);
    expect(scheduledClues(OPENED, OPENED + INTERVAL, INTERVAL, 5)).toBe(2);
    expect(scheduledClues(OPENED, OPENED + 60_000, INTERVAL, 5)).toBe(5);
  });

  it('shows the first clue for a clock that reads a moment early', () => {
    expect(scheduledClues(OPENED, OPENED - 400, INTERVAL, 5)).toBe(1);
  });
});

describe('a screen following the schedule', () => {
  it('turns each clue over on the server moment, not before', () => {
    const clock = manualClock(OPENED);
    draw(snapshot(), clock.port);
    expect(shown()).toBe(1);

    act(() => clock.advance(INTERVAL - 1));
    expect(shown()).toBe(1);

    act(() => clock.advance(1));
    expect(shown()).toBe(2);

    act(() => clock.advance(3 * INTERVAL));
    expect(shown()).toBe(5);
  });

  it('stops scheduling once the last clue is up', () => {
    const clock = manualClock(OPENED);
    draw(snapshot(), clock.port);
    act(() => clock.advance(4 * INTERVAL));

    expect(shown()).toBe(5);
    expect(clock.pending()).toBe(0);
  });

  it('shows the clue everyone else is seeing when it mounts late', () => {
    // A phone that woke from lock fifteen seconds in: the question "arrived"
    // now, but the room is on clue three, and so is this phone.
    const clock = manualClock(OPENED + 2 * INTERVAL + 1_000);
    draw(snapshot({ serverTime: clock.now() }), clock.port);

    expect(shown()).toBe(3);
  });

  it('holds its clue through a pause, however long', () => {
    const clock = manualClock(OPENED);
    draw(snapshot(), clock.port);
    act(() => clock.advance(INTERVAL + 500));
    expect(shown()).toBe(2);

    draw(snapshot({ paused: true, serverTime: clock.now() }), clock.port);
    act(() => clock.advance(30_000));
    // Someone joining mid-pause brings a fresh snapshot with a later time.
    draw(snapshot({ paused: true, serverTime: clock.now() }), clock.port);

    expect(shown()).toBe(2);
  });

  it('carries on from the same clue after a resume moves the deadline', () => {
    const clock = manualClock(OPENED);
    draw(snapshot(), clock.port);
    act(() => clock.advance(INTERVAL + 500));
    draw(snapshot({ paused: true, serverTime: clock.now() }), clock.port);

    const pause = 30_000;
    act(() => clock.advance(pause));
    draw(snapshot({ phaseEndsAt: OPENED + WINDOW + pause, serverTime: clock.now() }), clock.port);
    expect(shown()).toBe(2);

    act(() => clock.advance(INTERVAL - 500));
    expect(shown()).toBe(3);
  });

  it('shows the moment the pause began to a screen that mounts mid-pause', () => {
    const clock = manualClock(OPENED + 40_000);
    draw(snapshot({ paused: true, serverTime: OPENED + 2 * INTERVAL + 10 }), clock.port);

    expect(shown()).toBe(3);
  });

  it('shows only the first clue when the room gave no deadline', () => {
    const clock = manualClock(OPENED + 30_000);
    draw(snapshot({ phaseEndsAt: null }), clock.port);

    expect(shown()).toBe(1);
  });
});
