import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESENT_SESSION_KEY } from '../lib/sessionKey';

const listeners = new Set<() => void>();
const presentStore = {
  session: null as object | null,
  restore: vi.fn(),
  subscribe: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)),
};
vi.mock('../stores/presentStore', () => ({ presentStore }));

import { ensurePresenterRuntime, hasStoredPresenterSession, resetPresenterRuntimeForTest, setPresenterBusySink } from '../runtime';

afterEach(() => {
  localStorage.clear();
  resetPresenterRuntimeForTest();
  listeners.clear();
  presentStore.session = null;
  presentStore.restore.mockClear();
});

describe('presenterRuntime', () => {
  it('detects a stored session by key', () => {
    expect(hasStoredPresenterSession()).toBe(false);
    localStorage.setItem(PRESENT_SESSION_KEY, '{}');
    expect(hasStoredPresenterSession()).toBe(true);
  });

  it('treats an expired or corrupt saved session as absent and removes it', () => {
    localStorage.setItem(PRESENT_SESSION_KEY, JSON.stringify({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(hasStoredPresenterSession()).toBe(false);
    expect(localStorage.getItem(PRESENT_SESSION_KEY)).toBeNull();
    localStorage.setItem(PRESENT_SESSION_KEY, 'not json');
    expect(hasStoredPresenterSession()).toBe(false);
    localStorage.setItem(PRESENT_SESSION_KEY, JSON.stringify({ expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    expect(hasStoredPresenterSession()).toBe(true);
  });

  it('restores once (memoised) and mirrors busy state to the sink', async () => {
    const sink = vi.fn();
    setPresenterBusySink(sink);
    const adopted = { sessionId: 'S' } as never;
    await Promise.all([ensurePresenterRuntime(adopted), ensurePresenterRuntime(adopted)]);
    expect(presentStore.restore).toHaveBeenCalledTimes(1);
    expect(presentStore.restore).toHaveBeenCalledWith(adopted);
    expect(sink).toHaveBeenLastCalledWith(false);
    presentStore.session = {};
    listeners.forEach(f => f());
    expect(sink).toHaveBeenLastCalledWith(true);
  });
});
