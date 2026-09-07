import { describe, it, expect, vi } from 'vitest';
import { mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of resolution timing', async () => {
    const items = [10, 5, 1, 8, 3];
    // Larger values resolve later, so completion order != input order.
    const results = await mapWithConcurrency(items, 2, (n) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(n * 2), n)),
    );
    expect(results).toEqual([20, 10, 2, 16, 6]);
  });

  it('never exceeds the concurrency limit of in-flight tasks', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 30 }, (_, i) => i);

    await mapWithConcurrency(items, 6, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return null;
    });

    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(maxInFlight).toBeGreaterThan(1); // actually ran in parallel
  });

  it('runs every item exactly once', async () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const seen = new Set<number>();
    const fn = vi.fn(async (n: number) => { seen.add(n); return n; });

    const results = await mapWithConcurrency(items, 4, fn);

    expect(fn).toHaveBeenCalledTimes(25);
    expect(seen.size).toBe(25);
    expect(results).toEqual(items);
  });

  it('handles an empty list without spawning workers', async () => {
    const fn = vi.fn();
    const results = await mapWithConcurrency([], 6, fn);
    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('caps workers at the item count when concurrency exceeds length', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = [1, 2, 3];
    await mapWithConcurrency(items, 100, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return null;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('rejects if any task rejects', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
