import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectionStore, CONNECTION_ERROR_NETWORK, NETWORK_CLEAR_QUIET_MS } from './connectionStore';

describe('connectionStore (soak WV-04)', () => {
  beforeEach(() => { vi.useFakeTimers(); connectionStore.dismiss(); });
  afterEach(() => { connectionStore.dismiss(); vi.useRealTimers(); });

  it('a successful request clears the stale network-error banner once the network has been steady', () => {
    connectionStore.setError(CONNECTION_ERROR_NETWORK);
    expect(connectionStore.error).toBe(CONNECTION_ERROR_NETWORK);
    vi.advanceTimersByTime(NETWORK_CLEAR_QUIET_MS);
    connectionStore.clearNetworkError();
    expect(connectionStore.error).toBeNull();
  });

  it('a success right after a failure waits out the quiet period instead of clearing at once', () => {
    connectionStore.setError(CONNECTION_ERROR_NETWORK);
    vi.advanceTimersByTime(300);
    connectionStore.clearNetworkError();
    expect(connectionStore.error).toBe(CONNECTION_ERROR_NETWORK);
    vi.advanceTimersByTime(NETWORK_CLEAR_QUIET_MS);
    expect(connectionStore.error).toBeNull();
  });

  it('failures interleaved with successes keep the banner up: it never toggles', () => {
    const seen: Array<string | null> = [];
    const unsubscribe = connectionStore.subscribe(() => seen.push(connectionStore.error));
    connectionStore.setError(CONNECTION_ERROR_NETWORK);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(200);
      connectionStore.clearNetworkError(); // a request elsewhere succeeded
      vi.advanceTimersByTime(200);
      connectionStore.setError(CONNECTION_ERROR_NETWORK); // the blocked one failed again
    }
    unsubscribe();
    expect(seen.every((e) => e === CONNECTION_ERROR_NETWORK)).toBe(true);
    expect(connectionStore.error).toBe(CONNECTION_ERROR_NETWORK);
  });

  it('does not clear other errors', () => {
    connectionStore.setError('Something else');
    vi.advanceTimersByTime(NETWORK_CLEAR_QUIET_MS * 2);
    connectionStore.clearNetworkError();
    expect(connectionStore.error).toBe('Something else');
  });

  it('going back online clears the network banner at once', () => {
    connectionStore.setError(CONNECTION_ERROR_NETWORK);
    window.dispatchEvent(new Event('online'));
    expect(connectionStore.error).toBeNull();
  });
});
