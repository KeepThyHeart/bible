import { describe, it, expect, beforeEach, vi } from 'vitest';

// =============================================================================
// 1. SearchStore - Strong's Pattern Detection & refToVerseId
// =============================================================================

describe('SearchStore - Strong\'s pattern detection', () => {
  // Recreate the module-level regex (same as searchStore.ts)
  const STRONGS_PATTERN = /^(?:strongs:)?[GH]\d+$/i;

  it('detects Greek number G25', () => {
    expect(STRONGS_PATTERN.test('G25')).toBe(true);
  });

  it('detects Hebrew number H7225', () => {
    expect(STRONGS_PATTERN.test('H7225')).toBe(true);
  });

  it('detects with strongs: prefix', () => {
    expect(STRONGS_PATTERN.test('strongs:G25')).toBe(true);
  });

  it('detects case insensitive lowercase g', () => {
    expect(STRONGS_PATTERN.test('g25')).toBe(true);
  });

  it('detects case insensitive lowercase h', () => {
    expect(STRONGS_PATTERN.test('h100')).toBe(true);
  });

  it('detects with uppercase STRONGS prefix', () => {
    expect(STRONGS_PATTERN.test('STRONGS:H1234')).toBe(true);
  });

  it('rejects plain words', () => {
    expect(STRONGS_PATTERN.test('love')).toBe(false);
  });

  it('rejects partial match with trailing text', () => {
    expect(STRONGS_PATTERN.test('G25 word')).toBe(false);
  });

  it('rejects just letter G with no digits', () => {
    expect(STRONGS_PATTERN.test('G')).toBe(false);
  });

  it('rejects number without G or H prefix', () => {
    expect(STRONGS_PATTERN.test('25')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(STRONGS_PATTERN.test('')).toBe(false);
  });
});

describe('SearchStore - refToVerseId', () => {
  // Recreate the module-level function (same as searchStore.ts)
  function refToVerseId(book: number, chapter: number, verse?: number): number {
    return book * 1000000 + chapter * 1000 + (verse || 1);
  }

  it('computes John 3:16 = 43003016', () => {
    expect(refToVerseId(43, 3, 16)).toBe(43003016);
  });

  it('computes Genesis 1:1 = 1001001', () => {
    expect(refToVerseId(1, 1, 1)).toBe(1001001);
  });

  it('defaults verse to 1 when omitted', () => {
    expect(refToVerseId(43, 3)).toBe(43003001);
  });

  it('computes Revelation 22:21 = 66022021', () => {
    expect(refToVerseId(66, 22, 21)).toBe(66022021);
  });

  it('computes Psalm 119:176 = 19119176', () => {
    expect(refToVerseId(19, 119, 176)).toBe(19119176);
  });
});

// =============================================================================
// 2. SearchStore - promoteDetectedRef logic
// =============================================================================

describe('SearchStore - promoteDetectedRef logic', () => {
  interface FakeResult { verseId: number; reference?: string; text?: string }

  function promoteDetectedRef(results: FakeResult[], detectedVerseId: number): FakeResult[] {
    const idx = results.findIndex(r => r.verseId === detectedVerseId);
    if (idx > 0) {
      const [item] = results.splice(idx, 1);
      results.unshift(item);
    } else if (idx === -1) {
      results.unshift({ verseId: detectedVerseId, reference: 'synthetic', text: '(exact reference match)' });
    }
    return results;
  }

  it('moves existing match to front', () => {
    const results = [
      { verseId: 1001001 },
      { verseId: 43003016 },
      { verseId: 19023001 },
    ];
    promoteDetectedRef(results, 43003016);
    expect(results[0].verseId).toBe(43003016);
    expect(results.length).toBe(3);
  });

  it('creates synthetic entry if not found', () => {
    // Annotated: without it the literal infers as `{ verseId: number }[]` and
    // the `results[0].text` assertion below does not compile.
    const results: FakeResult[] = [{ verseId: 1001001 }, { verseId: 19023001 }];
    promoteDetectedRef(results, 43003016);
    expect(results[0].verseId).toBe(43003016);
    expect(results[0].text).toBe('(exact reference match)');
    expect(results.length).toBe(3);
  });

  it('does nothing if already first', () => {
    const results = [
      { verseId: 43003016 },
      { verseId: 1001001 },
    ];
    promoteDetectedRef(results, 43003016);
    expect(results[0].verseId).toBe(43003016);
    expect(results.length).toBe(2);
  });

  it('handles empty results by adding synthetic entry', () => {
    const results: FakeResult[] = [];
    promoteDetectedRef(results, 43003016);
    expect(results.length).toBe(1);
    expect(results[0].verseId).toBe(43003016);
  });

  it('preserves order of remaining results after promotion', () => {
    const results = [
      { verseId: 1001001 },
      { verseId: 2001001 },
      { verseId: 43003016 },
      { verseId: 66022021 },
    ];
    promoteDetectedRef(results, 43003016);
    expect(results.map(r => r.verseId)).toEqual([43003016, 1001001, 2001001, 66022021]);
  });
});

// =============================================================================
// 3. OfflineStore - Module Management & Staleness
// =============================================================================

describe('OfflineStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('isModuleDownloaded returns false for unknown module', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    expect(offlineStore.isModuleDownloaded('KJV')).toBe(false);
  });

  it('addDownloadedModule makes it discoverable', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    offlineStore.addDownloadedModule({
      abbreviation: 'KJV',
      name: 'King James Version',
      type: 'bible',
      sizeBytes: 5000000,
      downloadedAt: new Date().toISOString(),
    });
    expect(offlineStore.isModuleDownloaded('KJV')).toBe(true);
  });

  it('addDownloadedModule deduplicates by abbreviation', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    const mod = {
      abbreviation: 'KJV',
      name: 'King James Version',
      type: 'bible' as const,
      sizeBytes: 5000000,
      downloadedAt: new Date().toISOString(),
    };
    offlineStore.addDownloadedModule(mod);
    offlineStore.addDownloadedModule({ ...mod, sizeBytes: 6000000 });
    expect(offlineStore.downloadedModules.filter(m => m.abbreviation === 'KJV').length).toBe(1);
    expect(offlineStore.downloadedModules[0].sizeBytes).toBe(6000000);
  });

  it('removeDownloadedModule removes the module', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    offlineStore.addDownloadedModule({
      abbreviation: 'KJV',
      name: 'King James Version',
      type: 'bible',
      sizeBytes: 5000000,
      downloadedAt: new Date().toISOString(),
    });
    offlineStore.removeDownloadedModule('KJV');
    expect(offlineStore.isModuleDownloaded('KJV')).toBe(false);
  });

  it('setDownloadProgress removes entry on complete', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    offlineStore.setDownloadProgress('KJV', { module: 'KJV', loaded: 50, total: 100, status: 'downloading' });
    expect(offlineStore.activeDownloads.has('KJV')).toBe(true);
    offlineStore.setDownloadProgress('KJV', { module: 'KJV', loaded: 100, total: 100, status: 'complete' });
    expect(offlineStore.activeDownloads.has('KJV')).toBe(false);
  });

  it('setDownloadProgress removes entry on error', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    offlineStore.setDownloadProgress('KJV', { module: 'KJV', loaded: 50, total: 100, status: 'downloading' });
    offlineStore.setDownloadProgress('KJV', { module: 'KJV', loaded: 50, total: 100, status: 'error', error: 'Network error' });
    expect(offlineStore.activeDownloads.has('KJV')).toBe(false);
  });

  it('setDownloadProgress keeps downloading entries', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    offlineStore.setDownloadProgress('KJV', { module: 'KJV', loaded: 50, total: 100, status: 'downloading' });
    expect(offlineStore.activeDownloads.get('KJV')?.loaded).toBe(50);
  });

  it('touchModule updates lastUsedAt', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    const before = new Date().toISOString();
    offlineStore.addDownloadedModule({
      abbreviation: 'KJV',
      name: 'King James Version',
      type: 'bible',
      sizeBytes: 5000000,
      downloadedAt: '2024-01-01T00:00:00.000Z',
    });
    offlineStore.touchModule('KJV');
    const mod = offlineStore.downloadedModules.find(m => m.abbreviation === 'KJV');
    expect(mod?.lastUsedAt).toBeDefined();
    expect(new Date(mod!.lastUsedAt!).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('getStaleAutoModules returns only auto-downloaded stale modules', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    offlineStore.addDownloadedModule({
      abbreviation: 'KJV',
      name: 'King James Version',
      type: 'bible',
      sizeBytes: 5000000,
      downloadedAt: '2024-01-01T00:00:00.000Z',
      autoDownloaded: true,
    });
    offlineStore.addDownloadedModule({
      abbreviation: 'ESV',
      name: 'English Standard Version',
      type: 'bible',
      sizeBytes: 5000000,
      downloadedAt: new Date().toISOString(),
      autoDownloaded: true,
    });
    const stale = offlineStore.getStaleAutoModules(30);
    expect(stale.length).toBe(1);
    expect(stale[0].abbreviation).toBe('KJV');
  });

  it('getStaleAutoModules excludes manually downloaded', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    offlineStore.addDownloadedModule({
      abbreviation: 'KJV',
      name: 'King James Version',
      type: 'bible',
      sizeBytes: 5000000,
      downloadedAt: '2024-01-01T00:00:00.000Z',
      autoDownloaded: false,
    });
    const stale = offlineStore.getStaleAutoModules(30);
    expect(stale.length).toBe(0);
  });

  it('getStaleAutoModules uses downloadedAt if lastUsedAt not set', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    offlineStore.addDownloadedModule({
      abbreviation: 'KJV',
      name: 'King James Version',
      type: 'bible',
      sizeBytes: 5000000,
      downloadedAt: '2024-01-01T00:00:00.000Z',
      autoDownloaded: true,
    });
    // No lastUsedAt set, so downloadedAt (old date) should be used
    const stale = offlineStore.getStaleAutoModules(30);
    expect(stale.length).toBe(1);
  });

  it('updateStorageInfo updates stats', async () => {
    const { offlineStore } = await import('../stores/offlineStore');
    offlineStore.updateStorageInfo(50000000, 200000000);
    expect(offlineStore.storageUsed).toBe(50000000);
    expect(offlineStore.storageQuota).toBe(200000000);
  });
});

// =============================================================================
// 4. SettingsStore - Font Clamping & Persistence
// =============================================================================

describe('SettingsStore - font clamping', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('setFontSize clamps to max 48', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setFontSize(100);
    expect(settingsStore.fontSize).toBe(48);
  });

  it('setFontSize clamps to min 12', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setFontSize(5);
    expect(settingsStore.fontSize).toBe(12);
  });

  it('setStudyFontSize clamps to max 36', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setStudyFontSize(50);
    expect(settingsStore.studyFontSize).toBe(36);
  });

  it('setStudyFontSize clamps to min 12', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setStudyFontSize(5);
    expect(settingsStore.studyFontSize).toBe(12);
  });

  it('setUiFontSize clamps to max 24', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setUiFontSize(50);
    expect(settingsStore.uiFontSize).toBe(24);
  });

  it('setUiFontSize clamps to min 10', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setUiFontSize(5);
    expect(settingsStore.uiFontSize).toBe(10);
  });

  it('setLineHeight clamps to range 1.2 - 2.5', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setLineHeight(0.5);
    expect(settingsStore.lineHeight).toBe(1.2);
    settingsStore.setLineHeight(5.0);
    expect(settingsStore.lineHeight).toBe(2.5);
  });

  it('adjustAllFontSizes clamps each size independently', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    // Set UI near its max (24)
    settingsStore.setUiFontSize(23);
    // Bible font at 18 (default), study at 15 (default)
    settingsStore.adjustAllFontSizes(5);
    expect(settingsStore.uiFontSize).toBe(24); // clamped
    expect(settingsStore.fontSize).toBe(23); // 18 + 5
    expect(settingsStore.studyFontSize).toBe(20); // 15 + 5
  });
});

describe('SettingsStore - study font custom properties', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    document.documentElement.removeAttribute('style');
  });

  it('publishes --study-font-size and --study-font-scale on load', async () => {
    await import('../stores/settingsStore');
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--study-font-size')).toBe('15px');
    expect(style.getPropertyValue('--study-font-scale')).toBe('1');
  });

  it('updates the study custom properties when the size changes', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setStudyFontSize(30);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--study-font-size')).toBe('30px');
    expect(style.getPropertyValue('--study-font-scale')).toBe('2');
  });

  it('updates the study custom properties from adjustAllFontSizes', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.adjustAllFontSizes(-3);
    expect(settingsStore.studyFontSize).toBe(12);
    expect(document.documentElement.style.getPropertyValue('--study-font-size')).toBe('12px');
  });
});

describe('SettingsStore - resetTextSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    document.documentElement.removeAttribute('style');
  });

  it('restores only the text settings, leaving theme and font scheme alone', async () => {
    const { settingsStore, DEFAULT_SETTINGS } = await import('../stores/settingsStore');
    settingsStore.setTheme('dark');
    settingsStore.setFontScheme('merriweather');
    settingsStore.setFontSize(30);
    settingsStore.setStudyFontSize(26);
    settingsStore.setUiFontSize(20);
    settingsStore.setLineHeight(2.4);
    settingsStore.setStudyLineHeight(2.2);

    settingsStore.resetTextSettings();

    expect(settingsStore.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(settingsStore.studyFontSize).toBe(DEFAULT_SETTINGS.studyFontSize);
    expect(settingsStore.uiFontSize).toBe(DEFAULT_SETTINGS.uiFontSize);
    expect(settingsStore.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
    expect(settingsStore.studyLineHeight).toBe(DEFAULT_SETTINGS.studyLineHeight);
    // Untouched
    expect(settingsStore.theme).toBe('dark');
    expect(settingsStore.fontSchemeId).toBe('merriweather');
  });

  it('re-applies the CSS variables and persists', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setStudyFontSize(30);
    settingsStore.setUiFontSize(20);

    settingsStore.resetTextSettings();

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--study-font-scale')).toBe('1');
    expect(style.getPropertyValue('--ui-font-scale')).toBe('1');
    const parsed = JSON.parse(localStorage.getItem('bible-reader-settings')!);
    expect(parsed.studyFontSize).toBe(15);
    expect(parsed.uiFontSize).toBe(14);
  });
});

describe('SettingsStore - save/load persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('save stores to localStorage', async () => {
    const { settingsStore } = await import('../stores/settingsStore');
    settingsStore.setFontSize(22);
    const raw = localStorage.getItem('bible-reader-settings');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.fontSize).toBe(22);
  });

  it('load restores from localStorage', async () => {
    localStorage.setItem('bible-reader-settings', JSON.stringify({
      theme: 'dark',
      fontSize: 24,
      studyFontSize: 18,
      uiFontSize: 16,
      lineHeight: 2.0,
      wordsOfChristInRed: false,
    }));
    const { settingsStore } = await import('../stores/settingsStore');
    expect(settingsStore.theme).toBe('dark');
    expect(settingsStore.fontSize).toBe(24);
    expect(settingsStore.studyFontSize).toBe(18);
    expect(settingsStore.wordsOfChristInRed).toBe(false);
  });

  it('handles corrupted localStorage gracefully', async () => {
    localStorage.setItem('bible-reader-settings', 'NOT VALID JSON{{{');
    const { settingsStore } = await import('../stores/settingsStore');
    // Should fall back to defaults without crashing
    expect(settingsStore.fontSize).toBe(18);
    expect(settingsStore.theme).toBe('auto');
  });
});

// =============================================================================
// 5. StudyStore - Pin & History Logic
// =============================================================================

describe('StudyStore - pin logic (unit)', () => {
  it('pin captures current verse state', () => {
    // Recreate pin logic
    const state = {
      verseId: 43003016 as number | null,
      book: 43 as number | null,
      chapter: 3 as number | null,
      verse: 16 as number | null,
      pinned: false,
      pinnedVerseId: null as number | null,
      pinnedBook: null as number | null,
      pinnedChapter: null as number | null,
      pinnedVerse: null as number | null,
    };

    // Pin
    state.pinned = true;
    state.pinnedVerseId = state.verseId;
    state.pinnedBook = state.book;
    state.pinnedChapter = state.chapter;
    state.pinnedVerse = state.verse;

    expect(state.pinned).toBe(true);
    expect(state.pinnedVerseId).toBe(43003016);
    expect(state.pinnedBook).toBe(43);
  });

  it('pin prevents loadForVerse from changing state', () => {
    const state = { pinned: true, verseId: 43003016 };
    // loadForVerse early-returns when pinned
    function loadForVerse(newVerseId: number) {
      if (state.pinned) return;
      state.verseId = newVerseId;
    }
    loadForVerse(1001001);
    expect(state.verseId).toBe(43003016);
  });

  it('unpin allows loadForVerse to proceed', () => {
    const state = { pinned: false, verseId: 43003016 };
    function loadForVerse(newVerseId: number) {
      if (state.pinned) return;
      state.verseId = newVerseId;
    }
    loadForVerse(1001001);
    expect(state.verseId).toBe(1001001);
  });

  it('unpin preserves pinned verse as current if no other verse active', () => {
    // Match the actual StudyStore.unpin() behavior
    const state = {
      verseId: null as number | null,
      pinned: true,
      pinnedVerseId: 43003016 as number | null,
    };
    // Unpin logic from studyStore.ts
    if (state.pinnedVerseId && !state.verseId) {
      state.verseId = state.pinnedVerseId;
    }
    state.pinned = false;
    state.pinnedVerseId = null;

    expect(state.pinned).toBe(false);
    expect(state.verseId).toBe(43003016);
  });
});

describe('StudyStore - history deduplication', () => {
  // Recreate the addToHistory logic from studyStore.ts
  function addToHistory(
    history: Array<{ verseId: number; timestamp: number }>,
    verseId: number,
  ): Array<{ verseId: number; timestamp: number }> {
    const newChapter = Math.floor(verseId / 1000);
    const lastChapter = history.length > 0
      ? Math.floor(history[0].verseId / 1000)
      : -1;
    if (newChapter === lastChapter) return history;

    // Remove duplicate if already in history
    const filtered = history.filter(h => h.verseId !== verseId);
    filtered.unshift({ verseId, timestamp: Date.now() });
    if (filtered.length > 30) filtered.length = 30;
    return filtered;
  }

  it('adds entry to front', () => {
    const history = addToHistory([], 43003016);
    expect(history.length).toBe(1);
    expect(history[0].verseId).toBe(43003016);
  });

  it('skips duplicate from same chapter', () => {
    const history = addToHistory(
      [{ verseId: 43003016, timestamp: 1000 }],
      43003005, // same chapter (43003)
    );
    // Should not add because same chapter
    expect(history.length).toBe(1);
    expect(history[0].verseId).toBe(43003016);
  });

  it('adds entry from different chapter', () => {
    const history = addToHistory(
      [{ verseId: 43003016, timestamp: 1000 }],
      43004001, // different chapter
    );
    expect(history.length).toBe(2);
    expect(history[0].verseId).toBe(43004001);
  });

  it('caps at 30 entries', () => {
    let history: Array<{ verseId: number; timestamp: number }> = [];
    // Add 35 entries from different chapters
    for (let i = 1; i <= 35; i++) {
      history = addToHistory(history, i * 1000000 + 1000 + 1); // book i, chapter 1, verse 1
    }
    expect(history.length).toBe(30);
  });

  it('removes existing entry before re-adding to front', () => {
    let history: Array<{ verseId: number; timestamp: number }> = [
      { verseId: 43003016, timestamp: 1000 },
      { verseId: 1001001, timestamp: 900 },
      { verseId: 19023001, timestamp: 800 },
    ];
    // Jump back to Genesis 1:1 (different chapter from current front = John 3)
    history = addToHistory(history, 1001001);
    // Should be at front, no duplicate
    expect(history[0].verseId).toBe(1001001);
    expect(history.filter(h => h.verseId === 1001001).length).toBe(1);
    expect(history.length).toBe(3);
  });
});
