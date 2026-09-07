/**
 * Bounded-concurrency async map.
 *
 * Runs at most `concurrency` invocations of `fn` at a time, preserving the
 * order of results relative to `items`. Used to cap request fan-out — e.g.
 * fetching every chapter of a book for "copy whole book" — so the client does
 * not open dozens of simultaneous connections and trip the server's per-IP
 * rate limiter. Rejects as soon as any invocation rejects (matching
 * `Promise.all` semantics), so callers can keep their existing `.catch`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (items.length === 0) return results;

  const limit = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    // Pull indices off the shared cursor until the list is exhausted.
    for (let i = nextIndex++; i < items.length; i = nextIndex++) {
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
