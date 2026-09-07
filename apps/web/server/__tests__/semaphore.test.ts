import { describe, it, expect } from 'vitest';
import { createSemaphore, QueueFullError } from '../utils/semaphore';

/** A promise plus its resolver, so tests can hold work open deterministically. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('createSemaphore', () => {
  it('runs work immediately when below the concurrency limit', async () => {
    const sem = createSemaphore({ concurrency: 2, maxQueue: 5 });
    const result = await sem.run(async () => 'done');
    expect(result).toBe('done');
    expect(sem.active).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it('limits how many callbacks run at once', async () => {
    const sem = createSemaphore({ concurrency: 2, maxQueue: 5 });
    const gate = deferred();
    let running = 0;
    let peak = 0;

    const tasks = Array.from({ length: 5 }, () => sem.run(async () => {
      running++;
      peak = Math.max(peak, running);
      await gate.promise;
      running--;
    }));

    // Let the first batch reach the await.
    await Promise.resolve();
    expect(sem.active).toBe(2);
    expect(sem.queued).toBe(3);

    gate.resolve();
    await Promise.all(tasks);

    expect(peak).toBe(2);
    expect(sem.active).toBe(0);
    expect(sem.queued).toBe(0);
  });

  it('throws QueueFullError once the wait queue is full', async () => {
    const sem = createSemaphore({ concurrency: 1, maxQueue: 2 });
    const gate = deferred();

    const running = sem.run(async () => { await gate.promise; });
    const queued1 = sem.run(async () => { await gate.promise; });
    const queued2 = sem.run(async () => { await gate.promise; });

    await Promise.resolve();
    expect(sem.active).toBe(1);
    expect(sem.queued).toBe(2);

    // Third waiter exceeds maxQueue.
    await expect(sem.run(async () => 'nope')).rejects.toBeInstanceOf(QueueFullError);

    gate.resolve();
    await Promise.all([running, queued1, queued2]);
  });

  it('releases the slot when the callback throws', async () => {
    const sem = createSemaphore({ concurrency: 1, maxQueue: 1 });

    await expect(sem.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    expect(sem.active).toBe(0);
    // Slot is reusable after the failure.
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('does not consume a slot when rejected as queue-full', async () => {
    const sem = createSemaphore({ concurrency: 1, maxQueue: 0 });
    const gate = deferred();
    const running = sem.run(async () => { await gate.promise; });

    await Promise.resolve();
    await expect(sem.run(async () => 'nope')).rejects.toBeInstanceOf(QueueFullError);
    expect(sem.active).toBe(1);

    gate.resolve();
    await running;
    expect(sem.active).toBe(0);
  });

  it('hands the freed slot to waiters in FIFO order', async () => {
    const sem = createSemaphore({ concurrency: 1, maxQueue: 5 });
    const gate = deferred();
    const order: number[] = [];

    const first = sem.run(async () => { await gate.promise; order.push(0); });
    const rest = [1, 2, 3].map((n) => sem.run(async () => { order.push(n); }));

    gate.resolve();
    await Promise.all([first, ...rest]);

    expect(order).toEqual([0, 1, 2, 3]);
  });
});
