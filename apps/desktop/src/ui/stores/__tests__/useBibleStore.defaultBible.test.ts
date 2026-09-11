/**
 * The Bible store's default-Bible choice, and the places that lean on it.
 *
 * Modules install separately, so KJV may not be installed. Every "open
 * something when nothing was asked for" path must then land on a Bible that
 * is installed - and must not ask the main process for KJV along the way,
 * which opens a database that does not exist and shows the reader an error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerseIdHelper } from '@bible/core';
import { pickDefaultBible } from '../../../../electron/ipc/defaultBible';

const getAvailableBibles = vi.fn();
const getInitialData = vi.fn();
const getChapter = vi.fn();
const getBookName = vi.fn();
const getVerse = vi.fn();

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: (...args: unknown[]) => getAvailableBibles(...args),
    getInitialData: (...args: unknown[]) => getInitialData(...args),
    getChapter: (...args: unknown[]) => getChapter(...args),
    getBookName: (...args: unknown[]) => getBookName(...args),
    getVerse: (...args: unknown[]) => getVerse(...args),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { useBibleStore } from '../useBibleStore';
import { useLayoutStore } from '../useLayoutStore';
import type { BiblePanelSession, BibleTab } from '../bible/types';

const PANEL = 'test_panel_default_bible';

const KJV = { abbreviation: 'KJV', name: 'King James Version', database_path: 'modules/bible_kjv.db', module_id: 1 };
const ASV = { abbreviation: 'ASV', name: 'American Standard Version', database_path: 'modules/bible_asv.db', module_id: 2 };

const JOHN_3 = [{ verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: 'For God so loved the world' }];

function panelState() {
  return useBibleStore.getState().getPanelState(PANEL);
}

/** Every argument of every call made to the main process, flattened. */
function allBibleApiArguments(): unknown[] {
  return [getAvailableBibles, getInitialData, getChapter, getBookName, getVerse]
    .flatMap(fn => fn.mock.calls.flat());
}

/**
 * Stand in for the main process with only `installed` on disk: the initial
 * load picks with the shared rule, and a chapter from anything else fails the
 * way `requireBibleRepository` does.
 */
function installOnly(...installed: (typeof KJV)[]): void {
  getAvailableBibles.mockResolvedValue(installed);
  getInitialData.mockImplementation(async (requested?: string) => {
    const target = installed.find(b => b.abbreviation === pickDefaultBible(installed, requested));
    return {
      availableBibles: installed,
      defaultBible: target ?? null,
      defaultVerses: target ? JOHN_3 : [],
      bookNumber: 43,
      chapter: 3,
      bookName: 'John',
    };
  });
  getChapter.mockImplementation(async (abbreviation: string) => {
    if (!installed.some(b => b.abbreviation === abbreviation)) {
      throw new Error(`Bible not found: ${abbreviation}`);
    }
    return { verses: JOHN_3 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getBookName.mockImplementation(async (n: number) => (n === 43 ? 'John' : `Book${n}`));
  getVerse.mockResolvedValue(null);
  useBibleStore.setState({
    panels: new Map(),
    availableBibles: [],
    initialLoadComplete: false,
    sessionPanelStates: new Map(),
  });
});

describe('getDefaultBible', () => {
  it('picks KJV when it is installed', () => {
    useBibleStore.setState({ availableBibles: [ASV, KJV] });
    expect(useBibleStore.getState().getDefaultBible()).toBe('KJV');
  });

  it('picks the first installed Bible when KJV is not installed', () => {
    useBibleStore.setState({ availableBibles: [ASV] });
    expect(useBibleStore.getState().getDefaultBible()).toBe('ASV');
  });

  it('prefers the translation the reader already has open over KJV', () => {
    useBibleStore.setState({ availableBibles: [KJV, ASV] });
    useBibleStore.getState().openBible(PANEL, 'ASV', ASV.name);

    expect(useBibleStore.getState().getDefaultBible()).toBe('ASV');
  });

  it('uses an explicit preference only when it is installed', () => {
    useBibleStore.setState({ availableBibles: [KJV, ASV] });
    expect(useBibleStore.getState().getDefaultBible('ASV')).toBe('ASV');
    expect(useBibleStore.getState().getDefaultBible('NIV')).toBe('KJV');
  });

  it('never guesses a Bible by name before the installed list has loaded', () => {
    expect(useBibleStore.getState().getDefaultBible()).toBeUndefined();
  });

  it('vouches for a translation already on screen before the list has loaded', () => {
    useBibleStore.getState().openBible(PANEL, 'ASV', ASV.name);
    expect(useBibleStore.getState().getDefaultBible()).toBe('ASV');
  });

  it('loads the installed list first when asked to resolve', async () => {
    installOnly(ASV);

    await expect(useBibleStore.getState().resolveDefaultBible()).resolves.toBe('ASV');
    expect(getAvailableBibles).toHaveBeenCalledTimes(1);
  });
});

describe('startup with only ASV installed', () => {
  beforeEach(() => {
    installOnly(ASV);
    useBibleStore.getState().initPanel(PANEL);
  });

  it('opens the first tab on ASV without ever asking for KJV', async () => {
    await useBibleStore.getState().loadInitialData(PANEL);

    // Nothing is known yet at a fresh start, so no Bible is named at all.
    expect(getInitialData).toHaveBeenCalledWith(undefined, 43, 3);
    expect(panelState().openTabs).toHaveLength(1);
    expect(panelState().openTabs[0].abbreviation).toBe('ASV');
    expect(panelState().versesByTab.get(panelState().openTabs[0].tabId)).toEqual(JOHN_3);
    expect(allBibleApiArguments()).not.toContain('KJV');
  });

  it('names the default Bible when the installed list is already known', async () => {
    useBibleStore.setState({ availableBibles: [ASV] });

    await useBibleStore.getState().loadInitialData(PANEL);

    expect(getInitialData).toHaveBeenCalledWith('ASV', 43, 3);
    expect(panelState().openTabs[0].abbreviation).toBe('ASV');
  });
});

describe('restoring a session that names a Bible no longer installed', () => {
  /** Stage a saved John 3 passage in `abbreviation`, plus any panel-level extras. */
  function stageSession(
    abbreviation: string,
    extras: Omit<BiblePanelSession, 'tab'> = {},
  ): BibleTab {
    const tab: BibleTab = {
      tabId: `restored-${abbreviation}-tab`,
      abbreviation,
      name: abbreviation,
      displayMode: 'standard',
      book: 43,
      chapter: 3,
      bookName: 'John',
      selectedVerseId: 43003016,
      history: [],
      historyIndex: -1,
    };
    useBibleStore.setState({ sessionPanelStates: new Map([[PANEL, { tab, ...extras }]]) });
    return tab;
  }

  const WEB = { abbreviation: 'WEB', name: 'World English Bible', database_path: 'modules/bible_web.db', module_id: 3 };

  function visit(chapter: number, abbreviation: string) {
    return { verseId: VerseIdHelper.calculate(43, chapter, 1), bookNumber: 43, chapter, bookName: 'John', abbreviation };
  }

  it('moves Back-stack entries off a missing Bible, leaving installed ones alone', async () => {
    installOnly(ASV, WEB);
    // The passage itself is installed, so the stack is repaired on its own -
    // onto WEB, the translation the reader has open.
    stageSession('WEB', { visitStack: [visit(1, 'KJV'), visit(2, 'ASV'), visit(3, 'WEB')] });

    await useBibleStore.getState().restorePanelFromSession(PANEL);

    expect(panelState().visitStack.map(v => v.abbreviation)).toEqual(['WEB', 'ASV', 'WEB']);
    expect(panelState().openTabs[0].abbreviation).toBe('WEB');
  });

  it('replaces a missing parallel column with the default Bible, keeping two columns', async () => {
    installOnly(ASV, WEB);
    stageSession('WEB', { isParallelViewMode: true, parallelVersions: ['KJV', 'ASV'] });

    await useBibleStore.getState().restorePanelFromSession(PANEL);

    // WEB is the default here - the translation the reader has open - and is
    // not yet a column, so it takes the missing column's place.
    expect(panelState().parallelVersions).toEqual(['WEB', 'ASV']);
    expect(panelState().isParallelViewMode).toBe(true);
  });

  it('drops a missing parallel column rather than show the default twice', async () => {
    installOnly(ASV);
    stageSession('ASV', { isParallelViewMode: true, parallelVersions: ['KJV', 'ASV'] });

    await useBibleStore.getState().restorePanelFromSession(PANEL);

    expect(panelState().parallelVersions).toEqual(['ASV']);
  });

  it('leaves parallel columns alone when all of them are installed', async () => {
    installOnly(ASV, WEB);
    stageSession('ASV', { isParallelViewMode: true, parallelVersions: ['WEB', 'ASV'] });

    await useBibleStore.getState().restorePanelFromSession(PANEL);

    expect(panelState().parallelVersions).toEqual(['WEB', 'ASV']);
  });

  it('shows the passage in an installed Bible instead of an error', async () => {
    installOnly(ASV);
    const tab = stageSession('KJV');

    await useBibleStore.getState().restorePanelFromSession(PANEL);

    await vi.waitFor(() => {
      expect(panelState().versesByTab.get(tab.tabId)).toEqual(JOHN_3);
    });
    expect(panelState().openTabs[0].abbreviation).toBe('ASV');
    expect(panelState().openTabs[0].moduleId).toBe(ASV.module_id);
    expect(panelState().errorByTab.get(tab.tabId)).toBeNull();
    expect(panelState().visitStack[0].abbreviation).toBe('ASV');
  });
});

describe('openPassageInNewPanel with no passage to inherit from', () => {
  it('opens the passage in the default Bible, loading the installed list if needed', async () => {
    installOnly(ASV);
    const addPanel = vi.fn().mockReturnValue('bible_new');
    useLayoutStore.setState({ addPanel });

    const panelId = await useBibleStore.getState().openPassageInNewPanel(1, 1, 1);

    expect(panelId).toBe('bible_new');
    expect(addPanel.mock.calls[0][1]).toBe('ASV|1|1|1001001|standard');
  });

  it('opens nothing when no Bible is installed', async () => {
    installOnly();
    const addPanel = vi.fn().mockReturnValue('bible_new');
    useLayoutStore.setState({ addPanel });

    const panelId = await useBibleStore.getState().openPassageInNewPanel(1, 1, 1);

    expect(panelId).toBeNull();
    expect(addPanel).not.toHaveBeenCalled();
  });
});
