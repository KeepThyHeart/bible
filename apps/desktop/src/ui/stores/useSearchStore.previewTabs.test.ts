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
});
