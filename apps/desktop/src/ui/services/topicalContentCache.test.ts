import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clearTopicalContentCache,
  hasTopicDetail,
  loadAlsoIn,
  loadTopicDetail,
  loadTopicVerses,
  prefetchTopic,
} from './topicalContentCache';

const getTopic = vi.fn();
const getVersesForTopic = vi.fn();
const getAlsoIn = vi.fn();

beforeEach(() => {
  clearTopicalContentCache();
  getTopic.mockReset();
  getVersesForTopic.mockReset();
  getAlsoIn.mockReset();
  (globalThis as { window?: unknown }).window = globalThis;
  (globalThis as unknown as { electron: unknown }).electron = {
    topical: { getTopic, getVersesForTopic, getAlsoIn },
  };
});

/** The IPC layer wraps every result in a `Result<T>`; `unwrap` unpacks it. */
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });

describe('topicalContentCache', () => {
  it('fetches a topic once and serves the rest from cache', async () => {
    getTopic.mockImplementation(() => ok({ topic: { topic_id: 7, name: 'Grace' } }));

    const first = await loadTopicDetail('nave', 7);
    const second = await loadTopicDetail('nave', 7);

    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('dedupes concurrent requests for the same topic', async () => {
    getTopic.mockImplementation(() => ok({ topic: { topic_id: 7, name: 'Grace' } }));

    await Promise.all([loadTopicDetail('nave', 7), loadTopicDetail('nave', 7)]);

    expect(getTopic).toHaveBeenCalledTimes(1);
  });

  it('keys by module as well as topic id', async () => {
    getTopic.mockImplementation(() => ok({ topic: { topic_id: 7, name: 'Grace' } }));

    await loadTopicDetail('nave', 7);
    await loadTopicDetail('torrey', 7);

    expect(getTopic).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failure, so a transient error can be retried', async () => {
    getTopic.mockImplementationOnce(() => Promise.reject(new Error('db locked')));
    getTopic.mockImplementation(() => ok({ topic: { topic_id: 7, name: 'Grace' } }));

    await expect(loadTopicDetail('nave', 7)).rejects.toThrow('db locked');
    await expect(loadTopicDetail('nave', 7)).resolves.toEqual({ topic: { topic_id: 7, name: 'Grace' } });
    expect(getTopic).toHaveBeenCalledTimes(2);
  });

  it('caches only the first page of passages', async () => {
    getVersesForTopic.mockImplementation(() => ok([]));

    await loadTopicVerses('nave', 7, 50, 0);
    await loadTopicVerses('nave', 7, 50, 0);
    await loadTopicVerses('nave', 7, 50, 50);
    await loadTopicVerses('nave', 7, 50, 50);

    // One call for the cached first page, one per uncached later page.
    expect(getVersesForTopic).toHaveBeenCalledTimes(3);
  });

  it('reports whether a topic is already in hand', async () => {
    getTopic.mockImplementation(() => ok({ topic: { topic_id: 7, name: 'Grace' } }));

    expect(hasTopicDetail('nave', 7)).toBe(false);
    await loadTopicDetail('nave', 7);
    expect(hasTopicDetail('nave', 7)).toBe(true);
  });

  it('prefetch warms everything the topic view renders', async () => {
    getTopic.mockImplementation(() => ok({ topic: { topic_id: 7, name: 'Grace' } }));
    getVersesForTopic.mockImplementation(() => ok([]));
    getAlsoIn.mockImplementation(() => ok([]));

    await prefetchTopic('nave', 7, 50);
    // Let the two follow-up requests, which prefetch deliberately does not
    // await, settle before asserting.
    await Promise.resolve();
    await Promise.resolve();

    await loadTopicDetail('nave', 7);
    await loadTopicVerses('nave', 7, 50, 0);
    await loadAlsoIn('Grace', 'nave');

    expect(getTopic).toHaveBeenCalledTimes(1);
    expect(getVersesForTopic).toHaveBeenCalledTimes(1);
    expect(getAlsoIn).toHaveBeenCalledTimes(1);
  });

  it('prefetch stops quietly when the topic does not exist', async () => {
    getTopic.mockImplementation(() => ok(null));

    await expect(prefetchTopic('nave', 999, 50)).resolves.toBeUndefined();
    expect(getVersesForTopic).not.toHaveBeenCalled();
  });
});
