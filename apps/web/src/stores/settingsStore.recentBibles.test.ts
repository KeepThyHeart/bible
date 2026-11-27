import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsStore, MAX_RECENT_BIBLE_VERSIONS } from './settingsStore';

describe('settingsStore: recent Bible versions', () => {
  beforeEach(() => localStorage.clear());

  it('records most recent first, case-insensitively de-duplicated, and caps', () => {
    const s = new SettingsStore();
    s.recordRecentBibleVersion('KJV');
    s.recordRecentBibleVersion('ESV');
    s.recordRecentBibleVersion('kjv');
    expect(s.recentBibleVersions).toEqual(['kjv', 'ESV']);
    for (let i = 0; i < 10; i++) s.recordRecentBibleVersion(`V${i}`);
    expect(s.recentBibleVersions).toHaveLength(MAX_RECENT_BIBLE_VERSIONS);
  });

  it('persists on this device and reloads, ignoring junk', () => {
    const s = new SettingsStore();
    s.recordRecentBibleVersion('NIV');
    const again = new SettingsStore();
    again.load();
    expect(again.recentBibleVersions).toEqual(['NIV']);
    localStorage.setItem('bible-reader-settings', JSON.stringify({ recentBibleVersions: [1, 'A', null] }));
    const junk = new SettingsStore();
    junk.load();
    expect(junk.recentBibleVersions).toEqual(['A']);
  });
});
