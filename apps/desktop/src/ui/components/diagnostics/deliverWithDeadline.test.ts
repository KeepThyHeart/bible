/**
 * Send-then-queue timing: the dialog reports the real outcome when delivery
 * settles inside the deadline, and stops waiting ("sending in the background")
 * when it does not. Fake timers make the 3 s boundary exact.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DELIVERY_DEADLINE_MS,
  deliverWithDeadline,
  parseDeliveryEnvelope,
  type DeadlineOutcome,
} from './deliverWithDeadline';

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Track whether the race has resolved without awaiting it. */
function observe(p: Promise<DeadlineOutcome>) {
  const state: { outcome: DeadlineOutcome | null } = { outcome: null };
  void p.then((o) => {
    state.outcome = o;
  });
  return state;
}

describe('deliverWithDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits 3 seconds by default', () => {
    expect(DELIVERY_DEADLINE_MS).toBe(3000);
  });

  it('starts delivery immediately rather than after the deadline', () => {
    const deliver = vi.fn(() => new Promise<unknown>(() => {}));
    void deliverWithDeadline(deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('reports "sent" when delivery settles quickly', async () => {
    const d = deferred<unknown>();
    const state = observe(deliverWithDeadline(() => d.promise));

    await vi.advanceTimersByTimeAsync(400);
    expect(state.outcome).toBeNull();

    d.resolve({ ok: true, value: { status: 'sent' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.outcome).toEqual({ kind: 'settled', result: { status: 'sent' } });
  });

  it('still counts as settled just before the deadline', async () => {
    const d = deferred<unknown>();
    const state = observe(deliverWithDeadline(() => d.promise));

    await vi.advanceTimersByTimeAsync(DELIVERY_DEADLINE_MS - 1);
    d.resolve({ ok: true, value: { status: 'sent' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.outcome?.kind).toBe('settled');
  });

  it('goes "late" at the deadline, and hands back the still-running delivery', async () => {
    const d = deferred<unknown>();
    const state = observe(deliverWithDeadline(() => d.promise));

    await vi.advanceTimersByTimeAsync(DELIVERY_DEADLINE_MS - 1);
    expect(state.outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.outcome?.kind).toBe('late');

    // The delivery keeps going after the dialog stopped waiting for it.
    d.resolve({ ok: true, value: { status: 'sent' } });
    const outcome = state.outcome as Extract<DeadlineOutcome, { kind: 'late' }>;
    await expect(outcome.later).resolves.toEqual({ status: 'sent' });
  });

  it('passes a quick "queued because web requests are off" through as-is', async () => {
    const state = observe(
      deliverWithDeadline(async () => ({
        ok: true,
        value: { status: 'queued', reason: 'web-requests-off' },
      }))
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(state.outcome).toEqual({
      kind: 'settled',
      result: { status: 'queued', reason: 'web-requests-off' },
    });
  });

  it('treats a failed IPC call as queued, never as sent, and never rejects', async () => {
    const state = observe(deliverWithDeadline(() => Promise.reject(new Error('ipc gone'))));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.outcome).toEqual({
      kind: 'settled',
      result: { status: 'queued', reason: 'unreachable' },
    });
  });

  it('treats a synchronous throw the same way', async () => {
    const state = observe(
      deliverWithDeadline(() => {
        throw new Error('bridge missing');
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(state.outcome).toEqual({
      kind: 'settled',
      result: { status: 'queued', reason: 'unreachable' },
    });
  });

  it('honours a custom deadline', async () => {
    const state = observe(deliverWithDeadline(() => new Promise<unknown>(() => {}), 500));
    await vi.advanceTimersByTimeAsync(500);
    expect(state.outcome?.kind).toBe('late');
  });
});

describe('parseDeliveryEnvelope', () => {
  it('reads each known result', () => {
    expect(parseDeliveryEnvelope({ ok: true, value: { status: 'sent' } })).toEqual({ status: 'sent' });
    expect(parseDeliveryEnvelope({ ok: true, value: { status: 'rejected' } })).toEqual({
      status: 'rejected',
    });
    expect(
      parseDeliveryEnvelope({ ok: true, value: { status: 'queued', reason: 'no-connection' } })
    ).toEqual({ status: 'queued', reason: 'no-connection' });
  });

  it('never reads an error or unknown shape as sent', () => {
    const fallback = { status: 'queued', reason: 'unreachable' };
    expect(parseDeliveryEnvelope({ ok: false, error: { message: 'x' } })).toEqual(fallback);
    expect(parseDeliveryEnvelope(undefined)).toEqual(fallback);
    expect(parseDeliveryEnvelope({ ok: true, value: 'sent' })).toEqual(fallback);
    expect(parseDeliveryEnvelope({ ok: true, value: { status: 'queued', reason: 'bogus' } })).toEqual(
      fallback
    );
  });
});
