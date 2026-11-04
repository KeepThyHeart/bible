/** W-025: a hash that opens nothing must not skip the saved-session restore. */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getSearchProvider: vi.fn(),
  tab: null as unknown,
  navigateFromHash: vi.fn(async () => true),
  navigateTo: vi.fn(async () => {}),
  updateHash: vi.fn(),
  inits: { bible: vi.fn(), commentary: vi.fn(), study: vi.fn(), dictionary: vi.fn(), search: vi.fn() },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    init: h.inits.bible, fallBackFromMissingModules: vi.fn(), getActiveTab: () => h.tab,
    navigateFromHash: h.navigateFromHash, navigateTo: h.navigateTo, setShowHome: vi.fn(),
    updateHash: h.updateHash, ensureStudyVerse: vi.fn(),
  },
}));
vi.mock('../../stores/commentaryStore', () => ({ commentaryStore: { init: h.inits.commentary, openDefaultTab: vi.fn() } }));
vi.mock('../../stores/studyStore', () => ({ studyStore: { init: h.inits.study } }));
vi.mock('../../stores/searchStore', () => ({ searchStore: { init: h.inits.search } }));
vi.mock('../../stores/dictionaryStore', () => ({ dictionaryStore: { init: h.inits.dictionary } }));
vi.mock('../../stores/moduleStore', () => ({ moduleStore: { getCommentaryModules: () => [] } }));
vi.mock('../../stores/settingsStore', () => ({ settingsStore: { getDefaultBible: () => 'KJV' } }));
vi.mock('../../offline/autoDownloadManager', () => ({ initAutoDownload: vi.fn(), runAutoCleanup: vi.fn(async () => {}) }));
vi.mock('../../offline/sharedInstances', () => ({ offlineStorageManager: {} }));
vi.mock('../../utils/clientConfig', () => ({ isTagGraphEnabled: () => false }));
vi.mock('../../modules/moduleHost', () => ({ fireActivation: vi.fn(), featureModules: { hasSubscribers: () => false } }));
vi.mock('../../host/preferredBible', () => ({ preferredBible: { setSource: vi.fn() } }));
vi.mock('../../boot/offlineBible', () => ({ getOfflineBible: vi.fn(async () => ({})) }));
vi.mock('../../boot/searchProvider', () => ({ getSearchProvider: h.getSearchProvider }));

import { bootStudy } from './studyBoot';

describe('bootStudy with an unusable hash', () => {
  it('falls through to the session restore when the hash opened nothing', async () => {
    const ctx = { providers: {}, baseUrl: '', offlineAutoDownload: false } as never;
    h.getSearchProvider.mockResolvedValue({});
    h.tab = { book: 43, chapter: 3, verses: [] };
    h.navigateFromHash.mockResolvedValueOnce(false);
    window.location.hash = '#/KJV/99/1';
    await bootStudy(ctx);
    expect(h.navigateTo).toHaveBeenCalledWith(43, 3);
  });

  it('does not restore when the hash opened its passage', async () => {
    const ctx = { providers: {}, baseUrl: '', offlineAutoDownload: false } as never;
    h.navigateTo.mockClear();
    h.navigateFromHash.mockResolvedValueOnce(true);
    window.location.hash = '#/KJV/43/3';
    await bootStudy(ctx);
    expect(h.navigateTo).not.toHaveBeenCalled();
    window.location.hash = '';
  });
});

describe('bootStudy retry', () => {
  it('a failed search-provider load leaves nothing initialised, so a retry runs each init once', async () => {
    Object.values(h.inits).forEach(f => f.mockClear());
    h.tab = null;
    window.location.hash = '';
    const ctx = { providers: {}, baseUrl: '', offlineAutoDownload: false } as never;
    h.getSearchProvider.mockRejectedValueOnce(new Error('chunk failed')).mockResolvedValue({});
    await expect(bootStudy(ctx)).rejects.toThrow('chunk failed');
    for (const fn of Object.values(h.inits)) expect(fn).not.toHaveBeenCalled();
    await bootStudy(ctx);
    for (const fn of Object.values(h.inits)) expect(fn).toHaveBeenCalledTimes(1);
  });
});
