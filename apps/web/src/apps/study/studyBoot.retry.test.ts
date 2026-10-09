import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getSearchProvider: vi.fn(),
  inits: { bible: vi.fn(), commentary: vi.fn(), study: vi.fn(), dictionary: vi.fn(), search: vi.fn() },
}));

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    init: h.inits.bible, fallBackFromMissingModules: vi.fn(), getActiveTab: () => null,
    navigateFromHash: vi.fn(async () => {}),
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
vi.mock('../../utils/featureFlags', () => ({ featureFlags: {} }));
vi.mock('../../audio/config', () => ({ getAudioConfig: () => null }));
vi.mock('../../host/preferredBible', () => ({ preferredBible: { setSource: vi.fn() } }));
vi.mock('../../boot/offlineBible', () => ({ getOfflineBible: vi.fn(async () => ({})) }));
vi.mock('../../boot/searchProvider', () => ({ getSearchProvider: h.getSearchProvider }));

import { bootStudy } from './studyBoot';

describe('bootStudy retry', () => {
  it('a failed search-provider load leaves nothing initialised, so a retry runs each init once', async () => {
    const ctx = { providers: {}, baseUrl: '', offlineAutoDownload: false } as never;
    h.getSearchProvider.mockRejectedValueOnce(new Error('chunk failed')).mockResolvedValue({});
    await expect(bootStudy(ctx)).rejects.toThrow('chunk failed');
    for (const fn of Object.values(h.inits)) expect(fn).not.toHaveBeenCalled();
    await bootStudy(ctx);
    for (const fn of Object.values(h.inits)) expect(fn).toHaveBeenCalledTimes(1);
  });
});
