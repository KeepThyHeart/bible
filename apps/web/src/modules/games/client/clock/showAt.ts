/**
 * Scheduling something for a server instant.
 *
 * Every timed thing on a client goes through here. The input is always an
 * absolute `ServerTime` from a snapshot — `revealAt`, `phaseEndsAt` — never a
 * duration, because a duration measured from the moment a message arrived is
 * measured from a different moment on every phone in the room.
 *
 * The hard part is not the arithmetic, it is that a phone is allowed to stop
 * running timers. A locked screen, a backgrounded tab and an aggressive power
 * saver all throttle or suspend `setTimeout`, and the callback then arrives
 * seconds late or not until the page is looked at again. So the deadline is
 * re-checked against the clock rather than trusted to the timer: if the moment
 * has already passed, the callback fires at once. Late is recoverable — the
 * reveal simply appears as the player looks back at the phone. Never firing is
 * not.
 */

import type { ServerTime } from '../../shared/protocol.js';
import { getClock } from './offset.js';
import type { ClockReader } from './offset.js';

/**
 * A long wait is served as a chain of shorter ones. Re-arming re-reads the
 * clock, so a re-measured offset that arrives mid-wait moves the target
 * instead of being ignored, and a timer that was throttled while hidden is
 * noticed within a hop rather than at its original deadline.
 */
const MAX_HOP_MS = 5_000;

export type CancelScheduled = () => void;

export interface ShowAtOptions {
  /** Defaults to the shared client clock; injected in tests. */
  clock?: ClockReader;
}

/**
 * Run `task` when the server clock reaches `at`, or immediately if it already
 * has. Returns a cancel function; calling it after the task has run is
 * harmless, so a component can cancel unconditionally on unmount.
 */
export function showAt(
  at: ServerTime,
  task: () => void,
  options: ShowAtOptions = {}
): CancelScheduled {
  const clock = options.clock ?? getClock();
  let handle: ReturnType<typeof setTimeout> | null = null;
  let done = false;

  const detach = (): void => {
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
    }
  };

  const fire = (): void => {
    if (done) return;
    done = true;
    detach();
    task();
  };

  const check = (): void => {
    if (done) return;
    handle = null;
    // The clock, not the timer, decides. A timer can fire late, and it can
    // fire early if the offset moved under it; both are answered by asking
    // what time it is now.
    if (clock.serverNow() >= at) {
      fire();
      return;
    }
    arm();
  };

  const arm = (): void => {
    const remaining = at - clock.serverNow();
    handle = setTimeout(check, Math.min(remaining, MAX_HOP_MS));
  };

  function onVisible(): void {
    if (document.visibilityState === 'visible') check();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
  }

  // Already past — a snapshot that arrived late, or a reconnect into a phase
  // that started while this phone was away. Fire now rather than waiting for a
  // deadline that is behind us.
  if (clock.serverNow() >= at) {
    fire();
    return () => {
      /* Already fired; nothing to cancel. */
    };
  }

  arm();

  return () => {
    if (done) return;
    done = true;
    detach();
  };
}

/** The current instant on the server's clock, as best this phone can tell. */
export function serverNow(clock: ClockReader = getClock()): ServerTime {
  return clock.serverNow();
}

/**
 * Milliseconds left until a server instant, never negative. This is what a
 * countdown renders from: the deadline is the authoritative fact, so a phone
 * that missed a message or woke up late still shows the same number as
 * everyone else instead of counting down from when it happened to arrive.
 */
export function msUntil(at: ServerTime, clock: ClockReader = getClock()): number {
  return Math.max(0, at - clock.serverNow());
}
