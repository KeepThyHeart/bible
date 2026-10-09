/**
 * What the shell needs from clock synchronisation, expressed as a port.
 *
 * The measuring implementation lives in its own directory and is reached
 * through this adapter, for two reasons: the shell has to be testable without
 * a network, and a test wants to move time by hand rather than wait for it.
 *
 * Nothing here starts a measurement. Until the first one lands the offset is
 * zero — the device clock taken at face value — which is right often enough to
 * boot with and wrong in exactly the case the game cares about, so the root
 * component starts the real measurement and every conversion below silently
 * improves once it arrives.
 */

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Intent, ServerTime } from '../../shared/protocol.js';
import { getClock, msUntil, showAt } from '../clock/index.js';
import type { ClockReport } from '../clock/index.js';

export interface ClockPort {
  /** The server's clock as best this device can estimate it. */
  serverNow(): ServerTime;
  /**
   * Milliseconds left until a server instant, never negative. Countdowns
   * render from this rather than from a duration, so a phone that missed a
   * message or woke up late shows the number everyone else is showing.
   */
  msUntil(at: ServerTime): number;
  /**
   * Runs `task` when the server clock reaches `at`, immediately if that moment
   * has already passed. Returns a canceller.
   */
  showAt(at: ServerTime, task: () => void): () => void;
  /**
   * The offset to declare when a timestamp is going to decide something, or
   * null before the first measurement — which is itself information.
   */
  report(): ClockReport | null;
  /** Fires when a measurement lands, so a screen can re-anchor to it. */
  onChange(listener: () => void): () => void;
}

/**
 * Each method reaches for the shared clock at call time rather than closing
 * over one, so a test that installs its own is obeyed by components that were
 * already mounted when it did.
 */
export const measuredClock: ClockPort = {
  serverNow: () => getClock().serverNow(),
  msUntil: (at) => msUntil(at, getClock()),
  showAt: (at, task) => showAt(at, task, { clock: getClock() }),
  report: () => getClock().report(),
  onChange: (listener) => getClock().onChange(() => listener()),
};

/**
 * Begin measuring, and keep measuring. Returns the stop. Safe to call twice —
 * the clock layer treats a second start as a no-op rather than as a second set
 * of timers, which matters because a development remount would otherwise
 * double the ping rate.
 */
export function startMeasuring(): () => void {
  const clock = getClock();
  clock.start();
  return () => clock.stop();
}

/**
 * The measurement to post beside an intent, or null when the intent carries no
 * timestamp for it to correct.
 *
 * A buzz is the one intent whose timestamp decides something, and it carries
 * the phone's own clock reading. The room turns that into server time with the
 * offset posted beside it, so the offset has to travel with the buzz — without
 * it the room holds zero for every phone and a clock running a minute slow wins
 * every race. Games stamp a buzz with the device clock and nothing else; this
 * is the one place the correction is supplied, so it is never applied twice.
 */
export function clockReportFor(intent: Intent, clock: ClockPort): ClockReport | null {
  return intent.kind === 'buzz' ? clock.report() : null;
}

export const ClockContext = createContext<ClockPort>(measuredClock);

export function useClock(): ClockPort {
  return useContext(ClockContext);
}
