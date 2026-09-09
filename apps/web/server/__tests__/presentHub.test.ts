import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PresentHub, type SseSink } from '../present/PresentHub';
import { initialState } from '../present/reducer';
import type { PresentState } from '../../src/present/protocol';

/** A sink that records what was written, and can be made to fail on demand. */
class FakeSink implements SseSink {
  readonly chunks: string[] = [];
  ended = false;
  /** Mimics a socket whose buffer is full, which for this stream means gone. */
  backpressure = false;
  /** Mimics a destroyed socket. */
  throwOnWrite = false;

  write(chunk: string): boolean {
    if (this.throwOnWrite) throw new Error('socket destroyed');
    this.chunks.push(chunk);
    return !this.backpressure;
  }

  end(): void {
    this.ended = true;
  }

  get text(): string {
    return this.chunks.join('');
  }

  /** The parsed payloads of every `state` frame this sink received. */
  states(): PresentState[] {
    return this.chunks
      .filter(c => c.includes('event: state'))
      .map(c => JSON.parse(c.slice(c.indexOf('data: ') + 6).trim()) as PresentState);
  }
}

function wireState(version = 0): PresentState {
  const stored = initialState('SESSION000000000', 'ABCD2345');
  return { ...stored, version, session: { ...stored.session, viewerCount: 0 } };
}

let hub: PresentHub;

beforeEach(() => {
  hub = new PresentHub();
});

afterEach(() => {
  hub.dispose();
});

describe('subscribing', () => {
  it('sends current state immediately rather than waiting for the next change', () => {
    // A viewer that connects and waits shows a blank wall until the presenter
    // happens to touch something.
    const sink = new FakeSink();
    const result = hub.subscribe('s1', sink, wireState(4));

    expect(result.ok).toBe(true);
    expect(sink.states()).toHaveLength(1);
    expect(sink.states()[0].version).toBe(4);
  });

  it('advertises a reconnection delay before anything else', () => {
    const sink = new FakeSink();
    hub.subscribe('s1', sink, wireState());
    expect(sink.chunks[0]).toMatch(/^retry: \d+/);
  });

  it('tags each state frame with its version as the event id', () => {
    const sink = new FakeSink();
    hub.subscribe('s1', sink, wireState(7));
    expect(sink.text).toContain('id: 7');
  });

  it('counts viewers per session', () => {
    hub.subscribe('s1', new FakeSink(), wireState());
    hub.subscribe('s1', new FakeSink(), wireState());
    hub.subscribe('s2', new FakeSink(), wireState());

    expect(hub.viewerCount('s1')).toBe(2);
    expect(hub.viewerCount('s2')).toBe(1);
    expect(hub.viewerCount('nobody')).toBe(0);
    expect(hub.totalViewers()).toBe(3);
  });

  it('releases the slot when a viewer disconnects', () => {
    const sink = new FakeSink();
    const result = hub.subscribe('s1', sink, wireState());
    expect(result.ok && result.subscription).toBeTruthy();

    if (result.ok) result.subscription.close();
    expect(hub.viewerCount('s1')).toBe(0);
    expect(hub.totalViewers()).toBe(0);
  });

  it('treats a second close as a no-op', () => {
    // `req.on('close')` can fire after an explicit teardown; double-counting
    // that would drive the total negative and silently raise the real cap.
    const result = hub.subscribe('s1', new FakeSink(), wireState());
    if (result.ok) {
      result.subscription.close();
      result.subscription.close();
    }
    expect(hub.totalViewers()).toBe(0);
  });
});

describe('capacity', () => {
  it('refuses once a session is full', () => {
    const small = new PresentHub(2, 100);
    expect(small.subscribe('s1', new FakeSink(), wireState()).ok).toBe(true);
    expect(small.subscribe('s1', new FakeSink(), wireState()).ok).toBe(true);

    const third = small.subscribe('s1', new FakeSink(), wireState());
    expect(third).toEqual({ ok: false, reason: 'session-full' });
    // A different session is unaffected.
    expect(small.subscribe('s2', new FakeSink(), wireState()).ok).toBe(true);
    small.dispose();
  });

  it('refuses once the whole server is full', () => {
    const small = new PresentHub(100, 1);
    expect(small.subscribe('s1', new FakeSink(), wireState()).ok).toBe(true);
    expect(small.subscribe('s2', new FakeSink(), wireState()))
      .toEqual({ ok: false, reason: 'server-full' });
    small.dispose();
  });

  it('frees capacity as viewers leave', () => {
    const small = new PresentHub(1, 100);
    const first = small.subscribe('s1', new FakeSink(), wireState());
    expect(small.subscribe('s1', new FakeSink(), wireState()).ok).toBe(false);
    if (first.ok) first.subscription.close();
    expect(small.subscribe('s1', new FakeSink(), wireState()).ok).toBe(true);
    small.dispose();
  });
});

describe('broadcasting', () => {
  it('reaches every viewer of one session and nobody else', () => {
    const a = new FakeSink();
    const b = new FakeSink();
    const other = new FakeSink();
    hub.subscribe('s1', a, wireState());
    hub.subscribe('s1', b, wireState());
    hub.subscribe('s2', other, wireState());

    hub.broadcast('s1', wireState(1));

    expect(a.states().map(s => s.version)).toEqual([0, 1]);
    expect(b.states().map(s => s.version)).toEqual([0, 1]);
    expect(other.states().map(s => s.version)).toEqual([0]);
  });

  it('does nothing for a session with no viewers', () => {
    expect(() => hub.broadcast('nobody', wireState(1))).not.toThrow();
  });
});

describe('closing', () => {
  it('tells viewers why, then hangs up', () => {
    const sink = new FakeSink();
    hub.subscribe('s1', sink, wireState());

    hub.closeSession('s1', 'ended');

    expect(sink.text).toContain('event: closed');
    expect(sink.text).toContain('"reason":"ended"');
    expect(sink.ended).toBe(true);
    expect(hub.viewerCount('s1')).toBe(0);
    expect(hub.totalViewers()).toBe(0);
  });

  it('distinguishes a refusal from an ending', () => {
    // Someone who arrived one seat late should not be told the service is over.
    const sink = new FakeSink();
    hub.subscribe('s1', sink, wireState());
    hub.closeSession('s1', 'full');
    expect(sink.text).toContain('"reason":"full"');
  });

  it('is harmless for an unknown session', () => {
    expect(() => hub.closeSession('nobody', 'ended')).not.toThrow();
  });
});

describe('reaping dead sockets', () => {
  it('drops a viewer whose socket has stopped reading', () => {
    // A leaked SSE response is how an endpoint like this survives testing and
    // then falls over after a few hours.
    const sink = new FakeSink();
    hub.subscribe('s1', sink, wireState());
    sink.backpressure = true;

    hub.broadcast('s1', wireState(1));

    expect(hub.viewerCount('s1')).toBe(0);
    expect(sink.ended).toBe(true);
  });

  it('drops a viewer whose socket throws', () => {
    const sink = new FakeSink();
    hub.subscribe('s1', sink, wireState());
    sink.throwOnWrite = true;

    hub.broadcast('s1', wireState(1));

    expect(hub.viewerCount('s1')).toBe(0);
  });

  it('keeps the healthy viewers of the same session', () => {
    const dead = new FakeSink();
    const alive = new FakeSink();
    hub.subscribe('s1', dead, wireState());
    hub.subscribe('s1', alive, wireState());
    dead.throwOnWrite = true;

    hub.broadcast('s1', wireState(1));

    expect(hub.viewerCount('s1')).toBe(1);
    expect(alive.states().map(s => s.version)).toEqual([0, 1]);
  });
});

describe('heartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps idle connections alive through proxies that drop quiet sockets', () => {
    const beating = new PresentHub(50, 500, 1_000);
    const sink = new FakeSink();
    beating.subscribe('s1', sink, wireState());

    vi.advanceTimersByTime(3_500);

    expect(sink.chunks.filter(c => c.startsWith(': heartbeat'))).toHaveLength(3);
    beating.dispose();
  });

  it('notices a peer that vanished without closing', () => {
    const beating = new PresentHub(50, 500, 1_000);
    const sink = new FakeSink();
    beating.subscribe('s1', sink, wireState());
    sink.throwOnWrite = true;

    vi.advanceTimersByTime(1_500);

    expect(beating.viewerCount('s1')).toBe(0);
    beating.dispose();
  });

  it('stops beating once disposed', () => {
    const beating = new PresentHub(50, 500, 1_000);
    const sink = new FakeSink();
    beating.subscribe('s1', sink, wireState());
    beating.dispose();
    const before = sink.chunks.length;

    vi.advanceTimersByTime(5_000);

    expect(sink.chunks).toHaveLength(before);
    expect(sink.ended).toBe(true);
  });
});
