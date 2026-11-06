import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchStore, freshSessionFields } from './useSearchStore';

describe('search preview/pinned tabs', () => {
  beforeEach(() => {
    useSearchStore.setState({
      ...freshSessionFields(false),
      activeSessionId: 's1',
      parkedSessions: {},
      sessionMeta: { s1: { hasPanel: true, lastUsed: 1, createdAt: 1, hostPanelId: null } },
    });
  });

  it('pinSession toggles, or sets explicitly', () => {
    const { pinSession } = useSearchStore.getState();
    pinSession('s1');
    expect(useSearchStore.getState().sessionMeta.s1.pinned).toBe(true);
    pinSession('s1');
    expect(useSearchStore.getState().sessionMeta.s1.pinned).toBe(false);
    pinSession('s1', true);
    expect(useSearchStore.getState().sessionMeta.s1.pinned).toBe(true);
    pinSession('missing');
    expect(useSearchStore.getState().sessionMeta.missing).toBeUndefined();
  });

  it('restored tabs come back pinned', () => {
    useSearchStore.getState().restoreSessions([{ id: 'r1', query: 'love' }]);
    expect(useSearchStore.getState().sessionMeta.r1.pinned).toBe(true);
  });

  it('a plain search with a pinned active tab reuses an existing unpinned tab instead of opening another', async () => {
    useSearchStore.setState({
      activeSessionId: 's1',
      parkedSessions: { s2: { ...freshSessionFields(false) } },
      sessionMeta: {
        s1: { hasPanel: true, lastUsed: 2, createdAt: 1, hostPanelId: null, pinned: true },
        s2: { hasPanel: true, lastUsed: 1, createdAt: 1, hostPanelId: null },
      },
    });
    await useSearchStore.getState().performSearch('grace').catch(() => undefined);
    const st = useSearchStore.getState();
    expect(st.activeSessionId).toBe('s2');
    expect(Object.keys(st.sessionMeta).sort()).toEqual(['s1', 's2']);
  });
});
