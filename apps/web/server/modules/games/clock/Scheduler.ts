/**
 * The scheduler: the only place on the server that owns a timer.
 *
 * The room reducer is pure, so it cannot wait for anything. When a phase needs
 * to end on its own it returns a `{ type: 'timer', at, round, tag }` effect,
 * and this turns that into a `{ kind: 'timer', round, tag }` intent delivered
 * back into the room at the requested moment. The reducer therefore sees a
 * timer firing as just another intent, and a timing bug reproduces in a unit
 * test by feeding intents in order with no clock involved at all.
 *
 * On accuracy: `setTimeout` is not trustworthy over long delays. It is subject
 * to event-loop congestion, and on a laptop server it can lose the whole of a
 * suspend. That is tolerable here, and deliberately so. The authoritative fact
 * is the timestamp, not the message: the snapshot carries `phaseEndsAt` and
 * `revealAt`, and every client derives its own countdown from those against
 * its measured offset rather than from when a message happened to arrive. A
 * late timer therefore costs a little precision at the boundary and can never
 * desynchronise the room, because no client was counting on the delivery in
 * the first place. Long waits are still split into short hops, which keeps
 * that lost precision small and bounded rather than unbounded.
 */

import type { Effect, ServerTime } from '../../../../src/modules/games/shared/protocol.js';

/** The intent shape the reducer receives when a scheduled moment arrives. */
export interface TimerIntent {
  kind: 'timer';
  round: number;
  tag: string;
}

/**
 * Injected rather than called directly, so a test can drive the scheduler with
 * a clock it controls. Nothing in this project waits on real time.
 */
export type TimeSource = () => ServerTime;

export interface Timers {
  set(run: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export const systemTimers: Timers = {
  set: (run, delayMs) => setTimeout(run, delayMs),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * No single wait exceeds this. Each hop re-reads the clock, so a process that
 * was starved or suspended mid-wait notices on its next hop instead of at the
 * original deadline, and the error stays bounded by one hop rather than by the
 * length of the whole wait.
 */
const MAX_HOP_MS = 1_000;

interface Scheduled {
  at: ServerTime;
  round: number;
  tag: string;
  handle: unknown;
}

export interface SchedulerOptions {
  now?: TimeSource;
  timers?: Timers;
}

export class Scheduler {
  private readonly deliver: (intent: TimerIntent) => void;
  private readonly now: TimeSource;
  private readonly timers: Timers;
  /** Keyed by round and tag: a tag names one deadline, so it has one timer. */
  private readonly scheduled = new Map<string, Scheduled>();

  constructor(deliver: (intent: TimerIntent) => void, options: SchedulerOptions = {}) {
    this.deliver = deliver;
    this.now = options.now ?? (() => Date.now());
    this.timers = options.timers ?? systemTimers;
  }

  /**
   * Perform the timer-related effects of one reducer step and ignore the rest.
   * The transport hands the whole list over rather than filtering it, so that
   * adding an effect type never means remembering to route it here.
   */
  apply(effects: readonly Effect[]): void {
    for (const effect of effects) {
      if (effect.type === 'timer') this.schedule(effect.at, effect.round, effect.tag);
      else if (effect.type === 'cancelTimers') this.cancelRound(effect.round);
    }
  }

  /**
   * Arm one deadline. Re-arming an existing round and tag replaces it: the
   * reducer restating a deadline — a host extending an answer window, say — is
   * a correction, not a second alarm.
   */
  schedule(at: ServerTime, round: number, tag: string): void {
    const key = keyOf(round, tag);
    this.cancelKey(key);

    // A deadline already in the past is not an error. It happens whenever the
    // reducer asks for something immediate, and when a step took longer than
    // the window it was granting. Fire on the next turn of the loop rather
    // than synchronously, so the effect never runs before the state change
    // that requested it has been committed.
    const entry: Scheduled = { at, round, tag, handle: null };
    this.scheduled.set(key, entry);
    this.arm(entry);
  }

  private arm(entry: Scheduled): void {
    const remaining = entry.at - this.now();
    const delay = Math.min(Math.max(remaining, 0), MAX_HOP_MS);
    entry.handle = this.timers.set(() => {
      entry.handle = null;
      // The clock decides, not the timer: a hop that ran late still has to
      // find the deadline behind it before anything fires.
      if (this.now() < entry.at) {
        this.arm(entry);
        return;
      }
      this.scheduled.delete(keyOf(entry.round, entry.tag));
      this.deliver({ kind: 'timer', round: entry.round, tag: entry.tag });
    }, delay);
  }

  /** Everything armed for one round. Phases end early: skipped, or answered. */
  cancelRound(round: number): void {
    for (const [key, entry] of this.scheduled) {
      if (entry.round === round) this.cancelKey(key);
    }
  }

  cancel(round: number, tag: string): void {
    this.cancelKey(keyOf(round, tag));
  }

  private cancelKey(key: string): void {
    const entry = this.scheduled.get(key);
    if (!entry) return;
    if (entry.handle !== null) this.timers.clear(entry.handle);
    this.scheduled.delete(key);
  }

  /** Closing a room must not leave timers holding the process open. */
  cancelAll(): void {
    for (const key of [...this.scheduled.keys()]) this.cancelKey(key);
  }

  /** What is armed, for diagnostics and for asserting in tests. */
  pending(): { round: number; tag: string; at: ServerTime }[] {
    return [...this.scheduled.values()].map(({ round, tag, at }) => ({ round, tag, at }));
  }
}

function keyOf(round: number, tag: string): string {
  return `${round}|${tag}`;
}
