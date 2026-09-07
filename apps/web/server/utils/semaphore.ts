/**
 * Bounded-concurrency semaphore with a bounded wait queue.
 *
 * Used to gate CPU-bound work (ONNX embedding, cross-encoder reranking) that
 * would otherwise run as many times concurrently as there are in-flight HTTP
 * requests. Node's event loop does not protect against this: onnxruntime's
 * intra-op thread pool already saturates every core for a *single* request, so
 * extra concurrency buys no throughput — it only multiplies peak memory and
 * inflates latency for everyone.
 *
 * The queue is bounded on purpose. Once `maxQueue` callers are waiting, further
 * callers fail fast with `QueueFullError` (translated to 503 + Retry-After by
 * the route) rather than piling up behind a request timeout.
 */

/** Thrown by `run()` when the wait queue is already at `maxQueue`. */
export class QueueFullError extends Error {
  constructor(maxQueue: number) {
    super(`Work queue is full (${maxQueue} waiting)`);
    this.name = 'QueueFullError';
  }
}

export interface SemaphoreOptions {
  /** Maximum number of callbacks running at once. */
  concurrency: number;
  /** Maximum number of callers allowed to wait for a slot. */
  maxQueue: number;
}

export interface Semaphore {
  /**
   * Run `fn` once a slot is free.
   * @throws {QueueFullError} if the wait queue is already full.
   */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Number of callbacks currently running. */
  readonly active: number;
  /** Number of callers currently waiting for a slot. */
  readonly queued: number;
}

export function createSemaphore({ concurrency, maxQueue }: SemaphoreOptions): Semaphore {
  let active = 0;
  const waiters: Array<() => void> = [];

  function release(): void {
    active--;
    const next = waiters.shift();
    if (next) next();
  }

  async function acquire(): Promise<void> {
    if (active < concurrency) {
      active++;
      return;
    }
    if (waiters.length >= maxQueue) {
      throw new QueueFullError(maxQueue);
    }
    await new Promise<void>((resolveWaiter) => {
      waiters.push(() => {
        active++;
        resolveWaiter();
      });
    });
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active(): number {
      return active;
    },
    get queued(): number {
      return waiters.length;
    },
  };
}
