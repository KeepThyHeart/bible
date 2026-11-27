import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferencesStore, MAX_RECENT_BIBLE_VERSIONS } from './usePreferencesStore';

describe('usePreferencesStore: recent Bible versions', () => {
  beforeEach(() => usePreferencesStore.setState({ recentBibleVersions: [] }));

  it('records most recent first without duplicates', () => {
    const s = usePreferencesStore.getState();
    s.recordRecentBibleVersion('KJV');
    s.recordRecentBibleVersion('ESV');
    s.recordRecentBibleVersion('KJV');
    expect(usePreferencesStore.getState().recentBibleVersions).toEqual(['KJV', 'ESV']);
  });

  it('caps the list', () => {
    const s = usePreferencesStore.getState();
    for (let i = 0; i < MAX_RECENT_BIBLE_VERSIONS + 3; i++) s.recordRecentBibleVersion(`V${i}`);
    const list = usePreferencesStore.getState().recentBibleVersions;
    expect(list).toHaveLength(MAX_RECENT_BIBLE_VERSIONS);
    expect(list[0]).toBe(`V${MAX_RECENT_BIBLE_VERSIONS + 2}`);
  });

  it('ignores empty ids and round-trips through the session blob, sanitising garbage', () => {
    const s = usePreferencesStore.getState();
    s.recordRecentBibleVersion('');
    s.recordRecentBibleVersion('NIV');
    const blob = JSON.parse(JSON.stringify(usePreferencesStore.getState().getSessionData()));
    usePreferencesStore.setState({ recentBibleVersions: [] });
    usePreferencesStore.getState().loadFromSession(blob);
    expect(usePreferencesStore.getState().recentBibleVersions).toEqual(['NIV']);
    usePreferencesStore.getState().loadFromSession({ recentBibleVersions: 'x' });
    expect(usePreferencesStore.getState().recentBibleVersions).toEqual([]);
    usePreferencesStore.getState().loadFromSession({});
    expect(usePreferencesStore.getState().recentBibleVersions).toEqual([]);
  });
});
