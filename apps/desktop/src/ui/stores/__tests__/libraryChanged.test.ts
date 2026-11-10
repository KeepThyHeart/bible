/**
 * Installing a module must reach the Bible store.
 *
 * Regression: after installing the FIRST Bible the reading pane stayed on its
 * empty state until the app restarted - `loadInitialData` latched
 * `initialLoadComplete` on the zero-Bible path, no install event ever reached
 * `useBibleStore`, and `availableBibles` was never refetched. The module store
 * now raises `notifyLibraryChanged` (crossStoreBridge) when an install
 * finishes; `storeSync` refreshes `availableBibles` and, from the empty state
 * only, seeds the pane.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getAvailableBibles = vi.fn();
const getInitialData = vi.fn();
const getAvailableCommentaries = vi.fn();
const getAvailableDictionaries = vi.fn();
const getAvailableBooks = vi.fn();
const getChapter = vi.fn();

// The main process announces modules it registered on its own (the startup
// scan) on this channel; captured so a test can fire it.
const libraryChangedListeners = vi.hoisted(() => [] as Array<(event: { moduleTypes: string[] }) => void>);
vi.hoisted(() => {
  (window as unknown as { electron: unknown }).electron = {
    moduleManager: {
      onLibraryChanged: (cb: (event: { moduleTypes: string[] }) => void) => {
        libraryChangedListeners.push(cb);
        return () => undefined;
      },
    },
  };
});

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: (...args: unknown[]) => getAvailableBibles(...args),
    getInitialData: (...args: unknown[]) => getInitialData(...args),
    getChapter: (...args: unknown[]) => getChapter(...args),
    getBookName: vi.fn().mockResolvedValue('John'),
  },
  commentaryAPI: {
    getAvailableCommentaries: (...args: unknown[]) => getAvailableCommentaries(...args),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
  dictionaryAPI: {
    getAvailableDictionaries: (...args: unknown[]) => getAvailableDictionaries(...args),
  },
  bookAPI: {
    getAvailableBooks: (...args: unknown[]) => getAvailableBooks(...args),
  },
}));

vi.mock('../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
  setSessionDirtyCallback: vi.fn(),
}));

const getInstalledModules = vi.fn();
const installModuleIpc = vi.fn();
const uninstallModuleIpc = vi.fn();

vi.mock('../module/moduleAPI', () => ({
  moduleAPI: {
    getInstalledModules: (...args: unknown[]) => getInstalledModules(...args),
    installModule: (...args: unknown[]) => installModuleIpc(...args),
    uninstallModule: (...args: unknown[]) => uninstallModuleIpc(...args),
    getActiveDownloads: vi.fn().mockResolvedValue([]),
  },
}));

import { useBibleStore } from '../useBibleStore';
import { useCommentaryStore } from '../useCommentaryStore';
import { useDictionaryStore } from '../useDictionaryStore';
import { useBookStore } from '../useBookStore';
import { useModuleStore } from '../module/useModuleStore';
import { useSessionStore } from '../useSessionStore';
import { wireStoreSync } from '../storeSync';

const PANEL = 'library_changed_panel';

const KJV = { abbreviation: 'KJV', name: 'King James Version', database_path: 'modules/bible_kjv.db', module_id: 1 };
const JOHN_3 = [{ verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: 'For God so loved the world' }];

const installedBible = { module_id: 1, module_type: 'bible', abbreviation: 'KJV', version: '1.0', user_hidden: false };
const installedDictionary = { module_id: 9, module_type: 'dictionary', abbreviation: 'STR', version: '1.0', user_hidden: false };

/** The main process before/after the first Bible is on disk. */
function bibleInstalledOnDisk(): void {
  getAvailableBibles.mockResolvedValue([KJV]);
  getInitialData.mockResolvedValue({
    availableBibles: [KJV],
    defaultBible: KJV,
    defaultVerses: JOHN_3,
    bookNumber: 43,
    chapter: 3,
    bookName: 'John',
  });
}

function panelTabs() {
  return useBibleStore.getState().getPanelState(PANEL).openTabs;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAvailableCommentaries.mockResolvedValue([]);
  getAvailableDictionaries.mockResolvedValue([]);
  getAvailableBooks.mockResolvedValue([]);
  getChapter.mockResolvedValue({ verses: [] });
  wireStoreSync();
  getAvailableBibles.mockResolvedValue([]);
  getInitialData.mockResolvedValue({
    availableBibles: [], defaultBible: null, defaultVerses: [], bookNumber: 43, chapter: 3, bookName: 'John',
  });
  installModuleIpc.mockResolvedValue({ moduleId: 1, moduleName: 'King James Version' });
  uninstallModuleIpc.mockResolvedValue(true);
  useBibleStore.setState({
    panels: new Map(),
    availableBibles: [],
    initialLoadComplete: false,
    sessionPanelStates: new Map(),
  });
  useBibleStore.getState().initPanel(PANEL);
  useModuleStore.setState({ installedModules: [] });
  useSessionStore.setState({ isSessionLoaded: true });
});

afterEach(() => {
  useModuleStore.getState().stopDownloadPolling();
});

describe('zero-Bible startup', () => {
  it('does not latch initialLoadComplete, so a later install can still seed the pane', async () => {
    await useBibleStore.getState().loadInitialData(PANEL);

    expect(getInitialData).toHaveBeenCalledTimes(1);
    expect(panelTabs()).toHaveLength(0);
    expect(useBibleStore.getState().initialLoadComplete).toBe(false);
  });
});

describe('installing the first Bible', () => {
  it('refreshes availableBibles and seeds the empty reading pane', async () => {
    // Boot with nothing installed.
    await useBibleStore.getState().loadInitialData(PANEL);
    expect(useBibleStore.getState().availableBibles).toEqual([]);
    getAvailableBibles.mockClear();
    getInitialData.mockClear();

    // The install finishes: the installed list now holds the Bible.
    bibleInstalledOnDisk();
    getInstalledModules.mockResolvedValue([installedBible]);
    await expect(useModuleStore.getState().installModule('kjv')).resolves.toBe(true);

    expect(getAvailableBibles).toHaveBeenCalled();
    expect(getInitialData).toHaveBeenCalled();
    expect(useBibleStore.getState().availableBibles).toEqual([KJV]);
    expect(panelTabs()).toHaveLength(1);
    expect(panelTabs()[0].abbreviation).toBe('KJV');
    expect(useBibleStore.getState().getPanelState(PANEL).versesByTab.get(panelTabs()[0].tabId)).toEqual(JOHN_3);
  });

  it('waits for the install to finish - nothing is announced while it is still in flight', async () => {
    bibleInstalledOnDisk();
    getInstalledModules.mockResolvedValue([installedBible]);
    let finish!: () => void;
    installModuleIpc.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));

    const pending = useModuleStore.getState().installModule('kjv');
    await Promise.resolve();
    expect(getAvailableBibles).not.toHaveBeenCalled();
    expect(panelTabs()).toHaveLength(0);

    finish();
    await pending;
    expect(getAvailableBibles).toHaveBeenCalled();
    expect(panelTabs()).toHaveLength(1);
  });

  it('does not seed before the session has loaded (it may be about to restore tabs)', async () => {
    useSessionStore.setState({ isSessionLoaded: false });
    bibleInstalledOnDisk();
    getInstalledModules.mockResolvedValue([installedBible]);

    await useModuleStore.getState().installModule('kjv');

    expect(getAvailableBibles).toHaveBeenCalled();
    expect(getInitialData).not.toHaveBeenCalled();
    expect(panelTabs()).toHaveLength(0);
  });
});

describe('when a Bible is already open', () => {
  beforeEach(() => {
    useBibleStore.getState().openBible(PANEL, 'ASV', 'American Standard Version');
    useBibleStore.setState({ initialLoadComplete: true });
    getAvailableBibles.mockClear();
    getInitialData.mockClear();
  });

  it('refreshes availableBibles but does not re-seed', async () => {
    getAvailableBibles.mockResolvedValue([KJV]);
    getInstalledModules.mockResolvedValue([installedBible]);
    const openBefore = panelTabs().map(t => t.tabId);

    await useModuleStore.getState().installModule('kjv');

    expect(getAvailableBibles).toHaveBeenCalled();
    expect(getInitialData).not.toHaveBeenCalled();
    expect(panelTabs().map(t => t.tabId)).toEqual(openBefore);
  });

  it('does not re-seed even when the Bible store has not latched initialLoadComplete', async () => {
    useBibleStore.setState({ initialLoadComplete: false });
    getInstalledModules.mockResolvedValue([installedBible]);

    await useModuleStore.getState().installModule('kjv');

    expect(getInitialData).not.toHaveBeenCalled();
  });
});

describe('installing other kinds of module', () => {
  // On a fresh install every pane starts on "nothing installed". Each must hear
  // about an install of its own kind, or it says so until the app restarts.
  const installedCommentary = { module_id: 5, module_type: 'commentary', abbreviation: 'Wesley', version: '1.0', user_hidden: false };
  const installedBook = { module_id: 6, module_type: 'book', abbreviation: 'Pilgrim', version: '1.0', user_hidden: false };

  it('refreshes the commentary list', async () => {
    getAvailableCommentaries.mockResolvedValue([{ abbreviation: 'Wesley', name: "Wesley's Notes" }]);
    getInstalledModules.mockResolvedValue([installedCommentary]);

    await useModuleStore.getState().installModule('wesley');

    expect(useCommentaryStore.getState().availableCommentaries.map(c => c.abbreviation)).toEqual(['Wesley']);
  });

  it('refreshes the dictionary list', async () => {
    getAvailableDictionaries.mockResolvedValue([{ abbreviation: 'STR', name: 'Strongs' }]);
    getInstalledModules.mockResolvedValue([installedDictionary]);

    await useModuleStore.getState().installModule('strongs');

    expect(useDictionaryStore.getState().availableDictionaries.map(d => d.abbreviation)).toEqual(['STR']);
  });

  it('refreshes the book list', async () => {
    getAvailableBooks.mockResolvedValue([{ abbreviation: 'Pilgrim', name: "Pilgrim's Progress" }]);
    getInstalledModules.mockResolvedValue([installedBook]);

    await useModuleStore.getState().installModule('pilgrim');

    expect(useBookStore.getState().availableBooks.map(b => b.abbreviation)).toEqual(['Pilgrim']);
  });

  it('leaves the other stores alone', async () => {
    getInstalledModules.mockResolvedValue([installedCommentary]);

    await useModuleStore.getState().installModule('wesley');

    expect(getAvailableDictionaries).not.toHaveBeenCalled();
    expect(getAvailableBooks).not.toHaveBeenCalled();
  });
});

describe('changes that are not Bible changes', () => {
  it('ignores installing a non-Bible module', async () => {
    getInstalledModules.mockResolvedValue([installedDictionary]);

    await useModuleStore.getState().installModule('strongs');

    expect(getAvailableBibles).not.toHaveBeenCalled();
    expect(getInitialData).not.toHaveBeenCalled();
  });

  it('does nothing when the reload finds the same installed set', async () => {
    getInstalledModules.mockResolvedValue([installedBible]);
    useModuleStore.setState({ installedModules: [installedBible as never] });
    await useModuleStore.getState().loadInstalledModules();

    expect(getAvailableBibles).not.toHaveBeenCalled();
  });

  it('refreshes availableBibles when a Bible is uninstalled', async () => {
    useModuleStore.setState({ installedModules: [installedBible as never] });
    getInstalledModules.mockResolvedValue([]);
    getAvailableBibles.mockResolvedValue([]);
    useBibleStore.setState({ availableBibles: [KJV] });

    await useModuleStore.getState().uninstallModule(1);

    expect(getAvailableBibles).toHaveBeenCalled();
    expect(useBibleStore.getState().availableBibles).toEqual([]);
  });
});

describe('a restored tab whose Bible was not registered yet', () => {
  // Regression: the release AppImage, run over a data directory that already
  // held modules, restored the reader's KJV tab before the startup scan had
  // registered bible_kjv.db. The chapter request failed ("Bible not found:
  // KJV") and the pane kept that error even after the scan registered it,
  // until the reader re-selected the same translation by hand.
  async function kjvTabThatFailedToLoad(): Promise<string> {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version');
    const tab = panelTabs()[0];
    getChapter.mockRejectedValueOnce(new Error('Bible not found: KJV'));
    await useBibleStore.getState().loadChapterForTab(PANEL, tab.tabId, 'KJV', tab.book, tab.chapter);
    expect(useBibleStore.getState().getPanelState(PANEL).errorByTab.get(tab.tabId)).toBe('Bible not found: KJV');
    getChapter.mockClear();
    return tab.tabId;
  }

  it('reloads the chapter once the main process announces the module was registered', async () => {
    const tabId = await kjvTabThatFailedToLoad();
    getAvailableBibles.mockResolvedValue([KJV]);
    getInstalledModules.mockResolvedValue([installedBible]);
    getChapter.mockResolvedValue({ verses: JOHN_3 });

    expect(libraryChangedListeners.length).toBeGreaterThan(0);
    for (const listener of libraryChangedListeners) listener({ moduleTypes: ['bible'] });
    await vi.waitFor(() => expect(getChapter).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(useBibleStore.getState().getPanelState(PANEL).versesByTab.get(tabId)).toEqual(JOHN_3)
    );

    const ps = useBibleStore.getState().getPanelState(PANEL);
    expect(getChapter.mock.calls[0][0]).toBe('KJV');
    expect(ps.errorByTab.get(tabId)).toBeNull();
    expect(panelTabs()[0].abbreviation).toBe('KJV');
  });

  it('reloads it after an install from the Module Manager too', async () => {
    const tabId = await kjvTabThatFailedToLoad();
    getAvailableBibles.mockResolvedValue([KJV]);
    getInstalledModules.mockResolvedValue([installedBible]);
    getChapter.mockResolvedValue({ verses: JOHN_3 });

    await useModuleStore.getState().installModule('bible_kjv');

    expect(useBibleStore.getState().getPanelState(PANEL).versesByTab.get(tabId)).toEqual(JOHN_3);
  });

  it('leaves a tab that loaded fine alone', async () => {
    useBibleStore.getState().openBible(PANEL, 'KJV', 'King James Version');
    const tab = panelTabs()[0];
    await useBibleStore.getState().loadChapterForTab(PANEL, tab.tabId, 'KJV', tab.book, tab.chapter);
    getChapter.mockClear();
    getAvailableBibles.mockResolvedValue([KJV]);
    getInstalledModules.mockResolvedValue([installedBible]);

    await useModuleStore.getState().installModule('bible_kjv');

    expect(getChapter).not.toHaveBeenCalled();
  });
});
