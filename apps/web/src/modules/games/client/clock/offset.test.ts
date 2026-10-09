// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClockSync, sampleFrom, bestSample } from './offset.js';
import type { TimeSyncRequest, TimeSyncResponse } from '../../shared/protocol.js';

const START = 1_700_000_000_000;

/** One exchange's shape: how long each leg of the round trip takes. */
interface Leg {
  out: number;
  back: number;
}

/**
 * A synthetic network with a server whose clock is a known distance away, so
 * every assertion can be made against a number we chose rather than a number
 * we observed.
 */
function synthetic(legs: Leg[], serverAhead: number) {
  let localClock = START;
  let calls = 0;
  const exchange = async (request: TimeSyncRequest): Promise<TimeSyncResponse> => {
    const leg = legs[Math.min(calls, legs.length - 1)] ?? { out: 0, back: 0 };
    calls += 1;
    localClock += leg.out;
    const tServer = localClock + serverAhead;
    localClock += leg.back;
    return { t0: request.t0, tServer };
  };
  return {
    exchange,
    now: () => localClock,
    calls: () => calls,
    advance(ms: number) {
      localClock += ms;
    },
  };
}

/** Let queued promise callbacks run. Nothing here waits on real time. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('sampleFrom', () => {
  it('splits the difference between the two views of one server instant', () => {
    // The server is exactly 1000ms ahead; the request takes 30ms to arrive and
    // the reply 10ms to return. Half of that 20ms asymmetry is the error the
    // handshake cannot see, so the estimate lands at 1010 rather than 1000.
    const sample = sampleFrom(START, START + 30 + 1_000, START + 40);
    expect(sample.offsetMs).toBe(1_010);
    expect(sample.rttMs).toBe(40);
  });

  it('is exact when the path is symmetric', () => {
    const sample = sampleFrom(START, START + 25 + 1_000, START + 50);
    expect(sample.offsetMs).toBe(1_000);
  });
});

describe('bestSample', () => {
  it('keeps the fastest round trip rather than the average', () => {
    const samples = [
      { rttMs: 420, offsetMs: 1_190 },
      { rttMs: 20, offsetMs: 1_000 },
      { rttMs: 380, offsetMs: 1_170 },
    ];
    expect(bestSample(samples)).toEqual({ rttMs: 20, offsetMs: 1_000 });
  });

  it('has nothing to say about an empty measurement', () => {
    expect(bestSample([])).toBeNull();
  });
});

describe('ClockSync', () => {
  let clock: ClockSync | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    setVisibility('visible');
  });

  afterEach(() => {
    clock?.stop();
    clock = null;
    vi.useRealTimers();
  });

  it('measures the offset from a round trip with known asymmetry', async () => {
    const net = synthetic([{ out: 30, back: 10 }], 1_000);
    clock = new ClockSync({
      exchange: net.exchange,
      now: net.now,
      sampleCount: 1,
      spacingMs: 0,
    });

    const estimate = await clock.measure();
    expect(estimate).not.toBeNull();
    expect(estimate?.offsetMs).toBe(1_010);
    expect(estimate?.rttMs).toBe(40);
    expect(estimate?.samples).toBe(1);
  });

  it('keeps the lowest-latency sample even when the mean disagrees', async () => {
    // One clean exchange and three congested ones. The congested samples all
    // lean the same way, so their mean is nowhere near the truth: averaging
    // all four gives 1142.5 against a real offset of 1000.
    const net = synthetic(
      [
        { out: 10, back: 10 },
        { out: 400, back: 20 },
        { out: 400, back: 20 },
        { out: 400, back: 20 },
      ],
      1_000
    );
    clock = new ClockSync({
      exchange: net.exchange,
      now: net.now,
      sampleCount: 4,
      spacingMs: 0,
    });

    const estimate = await clock.measure();
    expect(estimate?.offsetMs).toBe(1_000);
    expect(estimate?.rttMs).toBe(20);
    expect(estimate?.offsetMs).not.toBe(1_142.5);
    // The congested samples are not thrown away: they are the confidence signal.
    expect(estimate?.spreadMs).toBe(190);
    expect(estimate?.samples).toBe(4);
  });

  it('reports a wide spread as untrustworthy', async () => {
    const noisy = synthetic(
      [
        { out: 10, back: 10 },
        { out: 400, back: 20 },
      ],
      1_000
    );
    clock = new ClockSync({
      exchange: noisy.exchange,
      now: noisy.now,
      sampleCount: 2,
      spacingMs: 0,
      spreadLimitMs: 100,
    });
    await clock.measure();
    expect(clock.trusted()).toBe(false);

    const calm = synthetic([{ out: 10, back: 10 }], 1_000);
    const steady = new ClockSync({
      exchange: calm.exchange,
      now: calm.now,
      sampleCount: 3,
      spacingMs: 0,
      spreadLimitMs: 100,
    });
    await steady.measure();
    expect(steady.trusted()).toBe(true);
    expect(steady.report()).toEqual({ offsetMs: 1_000, rttMs: 20, spreadMs: 0 });
  });

  it('converts between the two clocks once it has an offset', async () => {
    const net = synthetic([{ out: 10, back: 10 }], 4_000);
    clock = new ClockSync({
      exchange: net.exchange,
      now: net.now,
      sampleCount: 1,
      spacingMs: 0,
    });

    // Before any measurement the clocks are assumed to agree.
    expect(clock.serverNow()).toBe(net.now());
    expect(clock.report()).toBeNull();

    await clock.measure();
    expect(clock.serverNow()).toBe(net.now() + 4_000);
    expect(clock.toLocalTime(net.now() + 4_000)).toBe(net.now());
  });

  it('re-measures on a timer to catch drift', async () => {
    const net = synthetic([{ out: 10, back: 10 }], 1_000);
    clock = new ClockSync({
      exchange: net.exchange,
      now: net.now,
      sampleCount: 1,
      spacingMs: 0,
      resyncIntervalMs: 30_000,
    });

    clock.start();
    await flush();
    expect(net.calls()).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(net.calls()).toBe(2);
  });

  it('re-measures when the page comes back into view', async () => {
    const net = synthetic([{ out: 10, back: 10 }], 1_000);
    clock = new ClockSync({
      exchange: net.exchange,
      now: net.now,
      sampleCount: 1,
      spacingMs: 0,
      resyncIntervalMs: 30_000,
    });

    clock.start();
    await flush();
    expect(net.calls()).toBe(1);

    setVisibility('hidden');
    await flush();
    expect(net.calls()).toBe(1);

    setVisibility('visible');
    await flush();
    expect(net.calls()).toBe(2);
  });

  it('stops measuring once stopped', async () => {
    const net = synthetic([{ out: 10, back: 10 }], 1_000);
    clock = new ClockSync({
      exchange: net.exchange,
      now: net.now,
      sampleCount: 1,
      spacingMs: 0,
      resyncIntervalMs: 30_000,
    });

    clock.start();
    await flush();
    clock.stop();

    await vi.advanceTimersByTimeAsync(90_000);
    setVisibility('hidden');
    setVisibility('visible');
    await flush();
    expect(net.calls()).toBe(1);
  });

  it('shares one measurement between concurrent callers', async () => {
    const net = synthetic([{ out: 10, back: 10 }], 1_000);
    clock = new ClockSync({
      exchange: net.exchange,
      now: net.now,
      sampleCount: 1,
      spacingMs: 0,
    });

    const [first, second] = await Promise.all([clock.measure(), clock.measure()]);
    expect(net.calls()).toBe(1);
    expect(first).toEqual(second);
  });

  it('keeps the last good estimate when every ping fails', async () => {
    const net = synthetic([{ out: 10, back: 10 }], 1_000);
    let failing = false;
    clock = new ClockSync({
      exchange: (request) =>
        failing ? Promise.reject(new Error('offline')) : net.exchange(request),
      now: net.now,
      sampleCount: 2,
      spacingMs: 0,
    });

    const good = await clock.measure();
    expect(good?.offsetMs).toBe(1_000);

    failing = true;
    expect(await clock.measure()).toBeNull();
    expect(clock.estimate()?.offsetMs).toBe(1_000);
    expect(clock.serverNow()).toBe(net.now() + 1_000);
  });

  it('still produces an estimate when only some pings fail', async () => {
    const net = synthetic([{ out: 10, back: 10 }], 1_000);
    let attempt = 0;
    clock = new ClockSync({
      exchange: (request) => {
        attempt += 1;
        return attempt === 1 ? Promise.reject(new Error('offline')) : net.exchange(request);
      },
      now: net.now,
      sampleCount: 3,
      spacingMs: 0,
    });

    const estimate = await clock.measure();
    expect(estimate?.samples).toBe(2);
    expect(estimate?.offsetMs).toBe(1_000);
  });

  it('tells listeners about every completed measurement', async () => {
    const net = synthetic([{ out: 10, back: 10 }], 1_000);
    clock = new ClockSync({
      exchange: net.exchange,
      now: net.now,
      sampleCount: 1,
      spacingMs: 0,
    });

    const seen: number[] = [];
    const unsubscribe = clock.onChange((estimate) => seen.push(estimate.offsetMs));
    await clock.measure();
    unsubscribe();
    await clock.measure();

    expect(seen).toEqual([1_000]);
  });
});
