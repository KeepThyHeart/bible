/**
 * The tab-loss regression.
 *
 * `DictionaryPane` is rendered conditionally *inside* `BookPane`, so its React
 * component unmounts on an ordinary tab switch - and its unmount cleanup used
 * to call `destroyPanel`, which deletes the panel's whole state entry. The open
 * dictionary tabs vanished, and because the session serializers read the same
 * live map, the next autosave persisted the emptied state over the good one.
 *
 * The fix splits the lifecycle: unmount now calls `detachPanel` (keep identity,
 * drop caches) and only dockview's `onDidRemovePanel` calls `destroyPanel`.
 * These tests pin both halves, for both stores that share a Books pane.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDictionaryStore } from './useDictionaryStore';
import { useBookStore } from './useBookStore';
import { useLayoutStore } from './useLayoutStore';
import { destroyPanelState } from './helpers/panelDisposal';
import { getSessionSerializers } from './helpers/sessionRegistry';

vi.mock('../services/electronAPI', () => ({
  dictionaryAPI: {
    getAvailableDictionaries: vi.fn().mockResolvedValue([]),
    getEntryByKey: vi.fn().mockResolvedValue(null),
    getAllEntries: vi.fn().mockResolvedValue([]),
  },
  bookAPI: {
    getAvailableBooks: vi.fn().mockResolvedValue([]),
    getSection: vi.fn().mockResolvedValue(null),
    getAllSectionSummaries: vi.fn().mockResolvedValue([]),
    getTopLevelSections: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));

const PANEL = 'book_abc123';

beforeEach(() => {
  useDictionaryStore.setState({ panels: new Map() });
  useBookStore.setState({ panels: new Map() });
  useLayoutStore.setState({ panels: new Map() });
});

describe('dictionary tabs survive the pane component unmounting', () => {
  function openTwoDictionaries(): void {
    const store = useDictionaryStore.getState();
    store.initPanel(PANEL);
    store.openDictionary(PANEL, 'StrongsGreek', "Strong's Greek");
    store.openDictionary(PANEL, 'Easton', "Easton's");
  }

  it('keeps the open tabs when the pane detaches and re-initialises', () => {
    openTwoDictionaries();
    expect(useDictionaryStore.getState().getPanelState(PANEL).openTabs).toHaveLength(2);

    // Switching to a book tab unmounts DictionaryPane; switching back mounts it
    // again, which re-runs initPanel.
    useDictionaryStore.getState().detachPanel(PANEL);
    useDictionaryStore.getState().initPanel(PANEL);

    const after = useDictionaryStore.getState().getPanelState(PANEL);
    expect(after.openTabs.map((t) => t.abbreviation)).toEqual(['StrongsGreek', 'Easton']);
  });

  it('keeps which tab was active, and the entry each tab was showing', () => {
    openTwoDictionaries();
    useDictionaryStore.getState().setActiveTab(PANEL, 1);
    // The open entry is a reading position, not a cache: it is what the session
    // serializer turns into `currentEntryByTab`.
    useDictionaryStore.setState({
      panels: new Map(useDictionaryStore.getState().panels).set(PANEL, {
        ...useDictionaryStore.getState().getPanelState(PANEL),
        entriesByTab: new Map([['Easton', { entry_key: 'Abednego', definition: 'x' }]]),
      }),
    });

    useDictionaryStore.getState().detachPanel(PANEL);

    const after = useDictionaryStore.getState().getPanelState(PANEL);
    expect(after.activeTabIndex).toBe(1);
    expect(after.entriesByTab.get('Easton')?.entry_key).toBe('Abednego');
  });

  it('drops caches and in-flight flags, so nothing comes back stuck on a spinner', () => {
    openTwoDictionaries();
    useDictionaryStore.setState({
      panels: new Map(useDictionaryStore.getState().panels).set(PANEL, {
        ...useDictionaryStore.getState().getPanelState(PANEL),
        loadingByTab: new Map([['Easton', true]]),
        searchingByTab: new Map([['Easton', true]]),
        errorByTab: new Map([['Easton', 'boom']]),
        allEntriesByTab: new Map([['Easton', [{ entry_key: 'A', definition: 'a' }]]]),
        searchResultsByTab: new Map([['Easton', [{ entry_key: 'A', definition: 'a' }]]]),
      }),
    });

    useDictionaryStore.getState().detachPanel(PANEL);

    const after = useDictionaryStore.getState().getPanelState(PANEL);
    expect(after.loadingByTab.size).toBe(0);
    expect(after.searchingByTab.size).toBe(0);
    expect(after.errorByTab.size).toBe(0);
    expect(after.allEntriesByTab.size).toBe(0);
    expect(after.searchResultsByTab.size).toBe(0);
  });

  it('still clears everything when the pane is genuinely removed', () => {
    openTwoDictionaries();

    useDictionaryStore.getState().destroyPanel(PANEL);

    expect(useDictionaryStore.getState().panels.has(PANEL)).toBe(false);
    expect(useDictionaryStore.getState().getPanelState(PANEL).openTabs).toEqual([]);
  });
});

describe('book tabs survive the pane component unmounting', () => {
  it('keeps the tab strip, its interleaved order, and each reading position', () => {
    const store = useBookStore.getState();
    store.initPanel(PANEL);
    store.openBook(PANEL, 'pilgrim', "Pilgrim's Progress");
    store.setTabOrder(PANEL, [
      { type: 'book', abbreviation: 'pilgrim' },
      { type: 'dictionary', abbreviation: 'Easton' },
    ]);
    useBookStore.setState({
      panels: new Map(useBookStore.getState().panels).set(PANEL, {
        ...useBookStore.getState().getPanelState(PANEL),
        currentSectionByTab: new Map([['pilgrim', 42]]),
        loadingByTab: new Map([['pilgrim', true]]),
      }),
    });

    useBookStore.getState().detachPanel(PANEL);

    const after = useBookStore.getState().getPanelState(PANEL);
    expect(after.openTabs.map((t) => t.abbreviation)).toEqual(['pilgrim']);
    expect(after.tabOrder).toHaveLength(2);
    expect(after.currentSectionByTab.get('pilgrim')).toBe(42);
    // ...but not the in-flight flag.
    expect(after.loadingByTab.size).toBe(0);
  });
});

describe('destroyPanelState (dockview onDidRemovePanel)', () => {
  it('clears both stores, since one Books panel owns an entry in each', () => {
    useDictionaryStore.getState().initPanel(PANEL);
    useDictionaryStore.getState().openDictionary(PANEL, 'Easton', "Easton's");
    useBookStore.getState().initPanel(PANEL);
    useBookStore.getState().openBook(PANEL, 'pilgrim', "Pilgrim's Progress");

    destroyPanelState(PANEL, 'book');

    expect(useDictionaryStore.getState().panels.has(PANEL)).toBe(false);
    expect(useBookStore.getState().panels.has(PANEL)).toBe(false);
  });

  it('leaves other content types alone', () => {
    useDictionaryStore.getState().initPanel(PANEL);
    useDictionaryStore.getState().openDictionary(PANEL, 'Easton', "Easton's");

    destroyPanelState(PANEL, 'commentary');

    expect(useDictionaryStore.getState().panels.has(PANEL)).toBe(true);
  });
});

/**
 * Step 2 of the same fix: the serializers must not save
 * `panels.values().next().value` - "whatever was inserted first into the
 * *content* store" - because after a destroy/init cycle that could be a
 * freshly created empty default, written over the user's real tabs on the
 * next autosave. They resolve the panel through the layout instead, which is
 * what the restore side already does (`panelIdFromLayout` in AppInitService).
 */
describe('session serializers key off the layout, not content-store insertion order', () => {
  const STALE = 'book_stale';
  const LIVE = 'book_live';

  function serialize(key: 'book' | 'dictionary'): Record<string, unknown> {
    const fn = getSessionSerializers().get(key);
    if (!fn) throw new Error(`no serializer registered for ${key}`);
    return fn() as Record<string, unknown>;
  }

  beforeEach(() => {
    // Only the second panel is in the layout. The first is the leftover the
    // old code would have picked.
    useLayoutStore.getState().registerPanel({
      panelId: LIVE,
      contentType: 'dictionary',
      displayName: 'Books',
    });
  });

  it('saves the dictionary tabs of the panel the layout actually has', () => {
    const dict = useDictionaryStore.getState();
    dict.initPanel(STALE); // inserted first, and empty
    dict.initPanel(LIVE);
    dict.openDictionary(LIVE, 'Easton', "Easton's");

    const saved = serialize('dictionary');

    expect(saved.openTabs).toHaveLength(1);
    expect((saved.openTabs as Array<{ abbreviation: string }>)[0].abbreviation).toBe('Easton');
  });

  it('saves the book tabs of the same panel, since both halves share it', () => {
    const book = useBookStore.getState();
    book.initPanel(STALE);
    book.initPanel(LIVE);
    book.openBook(LIVE, 'pilgrim', "Pilgrim's Progress");

    const saved = serialize('book');

    expect((saved.openTabs as Array<{ abbreviation: string }>)[0].abbreviation).toBe('pilgrim');
  });

  it('falls back to the first entry when the layout knows of no such panel', () => {
    // Detached windows and unit fixtures have panel state but no dockview
    // registry; returning nothing there would save an empty session.
    useLayoutStore.setState({ panels: new Map() });
    const dict = useDictionaryStore.getState();
    dict.initPanel(LIVE);
    dict.openDictionary(LIVE, 'Easton', "Easton's");

    const saved = serialize('dictionary');

    expect(saved.openTabs).toHaveLength(1);
  });
});
