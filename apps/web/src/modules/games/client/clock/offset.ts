/**
 * Client-side clock synchronisation.
 *
 * Every instruction the server sends that involves time is an absolute
 * `ServerTime`. A phone can only act on one of those if it knows how far its
 * own clock sits from the server's, so this module measures that distance and
 * keeps measuring it. Two things depend on the answer being good:
 *
 * - Timed reveals. A wrong offset shows the answer early on one phone and late
 *   on another, and the room notices immediately.
 * - Buzz ordering, which is decided by the buzz timestamp translated into
 *   server time. A phone whose offset is wrong loses races it should win, so
 *   the measurement's own confidence travels with it and lets the server flag
 *   a clock it cannot trust rather than silently deciding rounds with it.
 *
 * The handshake is the usual network-time one: timestamp before sending,
 * server timestamp in the reply, timestamp on receipt.
 */

import { API } from '../../shared/protocol.js';
import type {
  ClientTime,
  ServerTime,
  TimeSyncRequest,
  TimeSyncResponse,
} from '../../shared/protocol.js';

/** One completed round trip, reduced to the two numbers that matter. */
export interface ClockSample {
  /** `t3 - t0`: everything the network and the server spent on this exchange. */
  rttMs: number;
  /** Add to a client timestamp to get the corresponding server timestamp. */
  offsetMs: number;
}

/** The published result of a measurement. */
export interface ClockEstimate {
  /** Add to a client timestamp to get the corresponding server timestamp. */
  offsetMs: number;
  /** Round trip of the sample this offset came from, not an average. */
  rttMs: number;
  /**
   * Widest disagreement between the samples of this measurement. It is the
   * confidence signal: a handful of samples that agree closely came from a
   * calm link, while a wide spread means the offset could be off by roughly
   * that much in either direction.
   */
  spreadMs: number;
  /** How many round trips actually completed; failed pings are not counted. */
  samples: number;
  /** On the client's own clock, so staleness is checkable without the server. */
  measuredAt: ClientTime;
}

/** What a measurement is worth reporting as, once it exists. */
export interface ClockReport {
  offsetMs: number;
  rttMs: number;
  spreadMs: number;
}

const DEFAULT_SAMPLE_COUNT = 4;

/**
 * Pings are spaced rather than fired back to back, because a burst of four
 * requests tends to queue behind itself and produce four samples distorted the
 * same way — which looks like agreement and is not.
 */
const DEFAULT_SPACING_MS = 50;

/**
 * Cheap clocks drift by seconds a day, and a phone that suspends can come back
 * further out than that, so the offset is re-measured rather than assumed to
 * hold for a whole session.
 */
const DEFAULT_RESYNC_INTERVAL_MS = 60_000;

/**
 * Beyond this much disagreement between samples the offset is a guess. It is
 * still used — a rough offset beats no offset — but it is reported as
 * untrusted so a buzz decided by it can be treated with suspicion.
 */
const DEFAULT_SPREAD_LIMIT_MS = 250;

/**
 * Reduce one round trip to a sample.
 *
 * The offset averages the two one-way views of the same server instant: how
 * far ahead the server looked when the request left, and how far ahead it
 * looked when the reply landed. Those two errors have opposite signs and equal
 * magnitude when the path is symmetric, so the average cancels them, and what
 * survives is half the difference between the outbound and return legs.
 */
export function sampleFrom(t0: ClientTime, tServer: ServerTime, t3: ClientTime): ClockSample {
  return {
    rttMs: t3 - t0,
    offsetMs: (tServer - t0 + (tServer - t3)) / 2,
  };
}

/**
 * Pick the sample to keep.
 *
 * The lowest round trip wins outright; the mean is deliberately not used.
 * Queueing delay is one-sided and unbounded above — it can only make a leg
 * slower, never faster — so a congested exchange inflates whichever leg it
 * landed on and shifts that sample's offset by half the asymmetry. Averaging
 * therefore drags the estimate toward whichever direction the network happened
 * to be busy in, and a single bad sample moves the answer. The fastest round
 * trip has the least room for that error to hide in: its own error is bounded
 * by half its RTT, which is a number we can see.
 */
export function bestSample(samples: readonly ClockSample[]): ClockSample | null {
  if (samples.length === 0) return null;
  return samples.reduce((best, candidate) => (candidate.rttMs < best.rttMs ? candidate : best));
}

/** Anything that can answer "what time is it on the server, in local terms". */
export interface ClockReader {
  /** Best estimate of the server's clock right now. */
  serverNow(): ServerTime;
  /** The local instant at which a given server instant arrives. */
  toLocalTime(at: ServerTime): ClientTime;
}

export interface ClockSyncOptions {
  /** Injected so tests can drive a synthetic network with no server at all. */
  exchange?: (request: TimeSyncRequest) => Promise<TimeSyncResponse>;
  now?: () => ClientTime;
  sampleCount?: number;
  spacingMs?: number;
  resyncIntervalMs?: number;
  spreadLimitMs?: number;
}

async function postTime(request: TimeSyncRequest): Promise<TimeSyncResponse> {
  const response = await fetch(API.time, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`time sync rejected with status ${response.status}`);
  return (await response.json()) as TimeSyncResponse;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Measures and maintains this client's offset from the server clock.
 *
 * One of these is normally shared through `getClock()`; the class is exported
 * so a test, or a second connection, can have its own without touching the
 * shared one.
 */
export class ClockSync implements ClockReader {
  private readonly exchange: (request: TimeSyncRequest) => Promise<TimeSyncResponse>;
  private readonly now: () => ClientTime;
  private readonly sampleCount: number;
  private readonly spacingMs: number;
  private readonly resyncIntervalMs: number;
  private readonly spreadLimitMs: number;

  private latest: ClockEstimate | null = null;
  private pending: Promise<ClockEstimate | null> | null = null;
  private resyncHandle: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<(estimate: ClockEstimate) => void>();

  constructor(options: ClockSyncOptions = {}) {
    this.exchange = options.exchange ?? postTime;
    this.now = options.now ?? (() => Date.now());
    this.sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;
    this.spacingMs = options.spacingMs ?? DEFAULT_SPACING_MS;
    this.resyncIntervalMs = options.resyncIntervalMs ?? DEFAULT_RESYNC_INTERVAL_MS;
    this.spreadLimitMs = options.spreadLimitMs ?? DEFAULT_SPREAD_LIMIT_MS;
  }

  /**
   * Begin measuring and keep measuring. Safe to call more than once; the
   * second call is a no-op rather than a second set of timers, because the
   * shell mounting twice in development must not double the ping rate.
   */
  start(): void {
    if (this.resyncHandle !== null) return;
    this.resyncHandle = setInterval(() => {
      void this.measure();
    }, this.resyncIntervalMs);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibility);
    }
    void this.measure();
  }

  stop(): void {
    if (this.resyncHandle !== null) {
      clearInterval(this.resyncHandle);
      this.resyncHandle = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
  }

  /**
   * A phone that has been asleep is exactly where drift becomes visible: the
   * suspend itself can move the clock, and the periodic timer that would have
   * caught it was throttled or stopped while the page was hidden. So coming
   * back to the foreground triggers its own measurement rather than waiting
   * for the next interval.
   */
  private readonly handleVisibility = (): void => {
    if (document.visibilityState === 'visible') void this.measure();
  };

  /**
   * Run one measurement. Concurrent callers share a single run — a wake-up
   * that lands on top of the periodic tick should not double the traffic.
   */
  measure(): Promise<ClockEstimate | null> {
    if (this.pending) return this.pending;
    const run = this.runMeasurement().then((estimate) => {
      this.pending = null;
      return estimate;
    });
    this.pending = run;
    return run;
  }

  private async runMeasurement(): Promise<ClockEstimate | null> {
    const samples: ClockSample[] = [];
    for (let index = 0; index < this.sampleCount; index += 1) {
      if (index > 0 && this.spacingMs > 0) await wait(this.spacingMs);
      const sample = await this.ping();
      if (sample) samples.push(sample);
    }

    const best = bestSample(samples);
    // Every ping failed. The last good estimate is better than nothing and far
    // better than an offset of zero, so it is left in place untouched.
    if (!best) return null;

    const offsets = samples.map((sample) => sample.offsetMs);
    const estimate: ClockEstimate = {
      offsetMs: best.offsetMs,
      rttMs: best.rttMs,
      spreadMs: Math.max(...offsets) - Math.min(...offsets),
      samples: samples.length,
      measuredAt: this.now(),
    };
    this.latest = estimate;
    for (const listener of this.listeners) listener(estimate);
    return estimate;
  }

  private async ping(): Promise<ClockSample | null> {
    const t0 = this.now();
    // A single ping fails for entirely ordinary reasons: a phone changing
    // cell, a tab that just lost the network. Losing one sample is not a
    // reason to abandon the measurement or to surface an error to a player
    // mid-game, so the failure is absorbed and the remaining samples still
    // produce an estimate.
    const response = await this.exchange({ t0 }).catch(() => null);
    if (!response) return null;
    return sampleFrom(t0, response.tServer, this.now());
  }

  /** The most recent estimate, or null if nothing has been measured yet. */
  estimate(): ClockEstimate | null {
    return this.latest;
  }

  /**
   * What to send the server so it can correct this player's timestamps. Null
   * until a measurement lands, which is itself information: a buzz arriving
   * with no reported offset can only be ordered by arrival.
   */
  report(): ClockReport | null {
    if (!this.latest) return null;
    return {
      offsetMs: this.latest.offsetMs,
      rttMs: this.latest.rttMs,
      spreadMs: this.latest.spreadMs,
    };
  }

  /**
   * Whether the estimate is tight enough to decide a race with. A false here
   * does not stop anything; it marks the measurement as one to be sceptical of.
   */
  trusted(): boolean {
    return this.latest !== null && this.latest.spreadMs <= this.spreadLimitMs;
  }

  /** Zero offset until the first measurement: assume the clocks agree. */
  private offset(): number {
    return this.latest?.offsetMs ?? 0;
  }

  serverNow(): ServerTime {
    return this.now() + this.offset();
  }

  toLocalTime(at: ServerTime): ClientTime {
    return at - this.offset();
  }

  /** Notified on every completed measurement, for a sync indicator in the UI. */
  onChange(listener: (estimate: ClockEstimate) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

let shared: ClockSync | null = null;

/**
 * The clock the rest of the client uses. It is a singleton because the offset
 * is a property of this device, not of any one screen: the lobby, the game
 * view and the reveal must all convert server times identically or they will
 * disagree with each other on the same phone.
 */
export function getClock(): ClockSync {
  shared ??= new ClockSync();
  return shared;
}

/** Replaces the shared clock. Exists so a test can install a driven one. */
export function setClock(clock: ClockSync | null): void {
  shared = clock;
}
