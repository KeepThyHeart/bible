/**
 * The background fill must never be felt.
 *
 * `better-sqlite3` is synchronous, so a sweep that walks the canon in a loop
 * holds the main process's event loop for the whole walk - trading the flicker
 * this work set out to remove for a stutter. The sweeper therefore does at most
 * ONE chapter per turn and returns to the loop through a real timer between
 * units. These tests pin that shape: the yields are counted, the units are
 * counted, and cancellation is checked mid-walk, because "it finishes
 * eventually" is not the property that matters here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => tmpdir(), getAppPath: () => tmpdir() },
}));
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { StudyCacheSweeper } from './StudyCacheSweeper';
import type { AggregationContext, StudyCacheService } from './StudyCacheService';

const CONTEXT = { fingerprint: 'fp-1' } as AggregationContext;

/** A stand-in cache that records the chapters it is asked to fill. */
function fakeCache(overrides: Partial<StudyCacheService> = {}): {
  cache: StudyCacheService;
  filled: Array<[number, number]>;
} {
  const filled: Array<[number, number]> = [];
  const cache = {
    contextOrNull: () => CONTEXT,
    fillChapter: (book: number, chapter: number) => {
      filled.push([book, chapter]);
      return true;
    },
    sizeBytes: () => 0,
    ...overrides,
  } as unknown as StudyCacheService;
  return { cache, filled };
}

/** Genesis 1-3 and Exodus 1-2: small enough to walk exactly. */
const CANON: Array<[number, number]> = [
  [1, 3],
  [2, 2],
];

describe('StudyCacheSweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function sweeper(cache: StudyCacheService, overrides = {}): StudyCacheSweeper {
    return new StudyCacheSweeper(cache, {
      startupDelayMs: 1000,
      chapterIntervalMs: 10,
      canon: CANON,
      ...overrides,
    });
  }

  it('computes nothing until well after start(), so startup is untouched', async () => {
    const { cache, filled } = fakeCache();
    const s = sweeper(cache);

    s.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(filled).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(filled).toHaveLength(1);
    s.stop();
  });

  it('does one chapter per turn, yielding to the event loop between them', async () => {
    const { cache, filled } = fakeCache();
    const s = sweeper(cache);
    s.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(filled).toEqual([[1, 1]]);

    // Time advanced by one interval buys exactly one more chapter. If the sweep
    // ever loops internally, this expectation collapses - which is the point.
    await vi.advanceTimersByTimeAsync(10);
    expect(filled).toEqual([[1, 1], [1, 2]]);

    await vi.advanceTimersByTimeAsync(10);
    expect(filled).toHaveLength(3);
    s.stop();
  });

  it('yields at least once per chapter', async () => {
    const { cache, filled } = fakeCache();
    const s = sweeper(cache);
    s.start();
    await vi.advanceTimersByTimeAsync(5000);

    expect(filled).toHaveLength(5); // the whole tiny canon
    // One scheduled turn for the startup delay, then one per chapter.
    expect(s.yieldCount()).toBeGreaterThanOrEqual(filled.length);
    expect(s.isRunning()).toBe(false);
  });

  it('walks the whole canon in order', async () => {
    const { cache, filled } = fakeCache();
    const s = sweeper(cache);
    s.start();
    await vi.advanceTimersByTimeAsync(5000);

    expect(filled).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
    ]);
  });

  it('stops mid-walk when cancelled, and stays stopped', async () => {
    const { cache, filled } = fakeCache();
    const s = sweeper(cache);
    s.start();
    await vi.advanceTimersByTimeAsync(1010);
    const atCancel = filled.length;
    expect(atCancel).toBeGreaterThan(0);
    expect(atCancel).toBeLessThan(5);

    s.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(filled).toHaveLength(atCancel);
    expect(s.isRunning()).toBe(false);
  });

  it('is safe to stop before it has done anything, and to stop twice', async () => {
    const { cache, filled } = fakeCache();
    const s = sweeper(cache);
    s.start();
    s.stop();
    s.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(filled).toEqual([]);
  });

  it('does not sweep at all when there is nothing to aggregate', async () => {
    const { cache, filled } = fakeCache({ contextOrNull: () => null });
    const s = sweeper(cache);
    s.start();
    await vi.advanceTimersByTimeAsync(5000);

    expect(filled).toEqual([]);
    expect(s.isRunning()).toBe(false);
  });

  it('keeps going when one chapter fails', async () => {
    const filled: Array<[number, number]> = [];
    const cache = {
      contextOrNull: () => CONTEXT,
      fillChapter: (book: number, chapter: number) => {
        if (book === 1 && chapter === 2) throw new Error('bad module');
        filled.push([book, chapter]);
        return true;
      },
      sizeBytes: () => 0,
    } as unknown as StudyCacheService;

    const s = sweeper(cache);
    s.start();
    await vi.advanceTimersByTimeAsync(5000);

    // Four of five, and the sweep ran to the end rather than dying at Gen 1:2.
    expect(filled).toHaveLength(4);
    expect(s.isRunning()).toBe(false);
  });

  it('stops once the cache passes its size budget', async () => {
    const { cache, filled } = fakeCache({ sizeBytes: () => 999_999_999 });
    // Check the size every chapter so the budget bites inside this tiny canon.
    const s = new StudyCacheSweeper(cache, {
      startupDelayMs: 1000,
      chapterIntervalMs: 10,
      canon: [[1, 200]],
      maxCacheBytes: 1024,
    });
    s.start();
    await vi.advanceTimersByTimeAsync(60_000);

    // It stopped well short of 200 chapters rather than growing without bound.
    expect(filled.length).toBeLessThan(200);
    expect(s.isRunning()).toBe(false);
  });

  it('counts only the chapters it actually wrote', async () => {
    const { cache } = fakeCache({ fillChapter: () => false });
    const s = sweeper(cache);
    s.start();
    await vi.advanceTimersByTimeAsync(5000);
    // Everything was already cached: the walk still completes, writing nothing.
    expect(s.filledCount()).toBe(0);
  });
});
