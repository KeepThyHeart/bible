/**
 * Guest realm globals.
 *
 * QuickJS gives a fresh realm `Date`, `Math`, `JSON`, `RegExp`, `Promise`,
 * `Proxy`, the typed arrays and not much else - no `console`, no timers, no
 * I/O of any kind. That absence *is* the security property: the realm starts
 * with zero ambient authority and everything it can reach was handed to it
 * deliberately. This module is the complete list of what we hand over.
 *
 * Two rules govern what may be added here:
 *
 *   1. Every global is a thin shim over a host function. The guest never
 *      holds a capability, only a request channel to one, so the host can
 *      refuse, rate-limit, or account for any of it.
 *   2. Nothing here grants authority the extension's *permissions* did not.
 *      `console` and timers are ambient in every JS environment and confer
 *      nothing; the `api` object, which does confer authority, is built by
 *      `apiProxy` and gated per-namespace by the host router - not here.
 *
 * Timers are host-driven rather than implemented in-realm. The guest owns the
 * callback table and the host owns the clock, which means the host can cap the
 * number of live timers (a timer flood is a denial-of-service on the
 * supervisor's event loop, not on the guest) and can refuse to fire anything
 * after teardown has begun.
 */

/** Host functions injected into the realm's global object before this runs. */
interface HostBridge {
  /** Post one JSON-encoded RPC envelope to the host. Fire-and-forget. */
  __host_send(json: string): void;
  /** Forward a console call. `argsJson` is a JSON array of the arguments. */
  __host_log(level: string, argsJson: string): void;
  /** Ask the host to fire `__guest_fireTimer(id)` after `delayMs`. */
  __host_setTimer(id: number, delayMs: number, repeating: boolean): void;
  /** Cancel a pending timer. Safe to call for an id the host already fired. */
  __host_clearTimer(id: number): void;
}

function hostBridge(): HostBridge {
  const g = globalThis as unknown as Partial<HostBridge>;
  if (
    typeof g.__host_send !== 'function' ||
    typeof g.__host_log !== 'function' ||
    typeof g.__host_setTimer !== 'function' ||
    typeof g.__host_clearTimer !== 'function'
  ) {
    throw new Error(
      'Extension guest realm was started without its host bridge — this is a host bug, not an extension bug.',
    );
  }
  return g as HostBridge;
}

type TimerCallback = (...args: unknown[]) => void;

interface TimerRecord {
  fn: TimerCallback;
  args: unknown[];
  repeating: boolean;
}

/**
 * Serialize console arguments for the host.
 *
 * Extension code logs whatever it likes, including cyclic objects and values
 * that throw from a getter. A console call must never be the thing that kills
 * an extension, so every failure degrades to a string rather than propagating.
 */
function encodeLogArgs(args: unknown[]): string {
  const safe = args.map((arg) => {
    if (arg instanceof Error) {
      return { __error: true, name: arg.name, message: arg.message, stack: arg.stack };
    }
    try {
      // Round-trip to prove it survives; the host re-parses the whole array.
      JSON.stringify(arg);
      return arg;
    } catch {
      return String(arg);
    }
  });
  try {
    return JSON.stringify(safe);
  } catch {
    return JSON.stringify([String(args)]);
  }
}

export interface GuestGlobalsHandle {
  /** Called by the host when a timer's deadline arrives. */
  fireTimer(id: number): void;
  /** Drop every pending timer. Used on teardown. */
  clearAllTimers(): void;
  /** Number of live timers - the host uses this to enforce its cap. */
  pendingTimerCount(): number;
}

/**
 * Install `console` and the timer family onto the realm's global object.
 * Returns the hooks the host drives.
 *
 * @param onTimerError Reports a throw from a timer callback. Without this the
 *   error would vanish: the realm has no `process` and therefore no
 *   `uncaughtException` hook (see `errorBoundary.ts`).
 */
export function installGuestGlobals(onTimerError: (err: unknown) => void): GuestGlobalsHandle {
  const bridge = hostBridge();
  const g = globalThis as unknown as Record<string, unknown>;

  // -- console ---------------------------------------------------------------
  const console: Record<string, TimerCallback> = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
    console[level] = (...args: unknown[]): void => {
      try {
        bridge.__host_log(level, encodeLogArgs(args));
      } catch {
        /* the host log channel is gone; there is nowhere left to report it */
      }
    };
  }
  g['console'] = console;

  // -- timers ----------------------------------------------------------------
  const timers = new Map<number, TimerRecord>();
  let nextTimerId = 1;

  function schedule(repeating: boolean, fn: unknown, delay: unknown, args: unknown[]): number {
    if (typeof fn !== 'function') {
      throw new TypeError('Timer callback must be a function');
    }
    const id = nextTimerId++;
    // Match the browser/Node coercion: a non-numeric or negative delay is 0.
    const ms = typeof delay === 'number' && isFinite(delay) && delay > 0 ? Math.floor(delay) : 0;
    timers.set(id, { fn: fn as TimerCallback, args, repeating });
    try {
      bridge.__host_setTimer(id, ms, repeating);
    } catch (err) {
      // The host refused - most likely the per-extension timer cap. Drop the
      // record so a rejected timer cannot leak, and let the caller see why.
      timers.delete(id);
      throw err;
    }
    return id;
  }

  function cancel(id: unknown): void {
    if (typeof id !== 'number') return;
    if (!timers.delete(id)) return;
    try {
      bridge.__host_clearTimer(id);
    } catch {
      /* host already tore the realm down */
    }
  }

  g['setTimeout'] = (fn: unknown, delay?: unknown, ...args: unknown[]): number =>
    schedule(false, fn, delay, args);
  g['setInterval'] = (fn: unknown, delay?: unknown, ...args: unknown[]): number =>
    schedule(true, fn, delay, args);
  g['clearTimeout'] = cancel;
  g['clearInterval'] = cancel;
  // `queueMicrotask` needs no host clock - the realm's own job queue runs it,
  // and the supervisor pumps that after every turn.
  g['queueMicrotask'] = (fn: unknown): void => {
    if (typeof fn !== 'function') throw new TypeError('queueMicrotask expects a function');
    void Promise.resolve().then(() => {
      try {
        (fn as TimerCallback)();
      } catch (err) {
        onTimerError(err);
      }
    });
  };

  return {
    fireTimer(id: number): void {
      const rec = timers.get(id);
      if (!rec) return;
      // A one-shot is done the moment it fires. An interval stays registered;
      // the host re-arms its own clock.
      if (!rec.repeating) timers.delete(id);
      try {
        rec.fn(...rec.args);
      } catch (err) {
        onTimerError(err);
      }
    },
    clearAllTimers(): void {
      for (const id of Array.from(timers.keys())) cancel(id);
    },
    pendingTimerCount(): number {
      return timers.size;
    },
  };
}
