/**
 * Privacy (task 0224): reading history and search tabs are session-only by
 * default. Covers the serializers (preference on and off), loading a session
 * written by an older version, the layout snapshot, and Clear history.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue({ verses: [], currentBook: 43, currentChapter: 3 }),
    getBookName: vi.fn().mockImplementation(async (n: number) => `Book${n}`),
    getChapter: vi.fn().mockResolvedValue({ verses: [] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: {
    getAvailableCommentaries: vi.fn().mockResolvedValue([]),
    getEntriesForVerse: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock('../helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));

const markDirty = vi.fn();
vi.mock('../useSessionStore', () => ({
  useSessionStore: { getState: () => ({ markDirty }) },
}));

import { useBibleStore } from '../bible/useBibleStore';
import { usePreferencesStore } from '../usePreferencesStore';
import { useLayoutStore } from '../useLayoutStore';
import { useSearchStore, freshSessionFields } from '../useSearchStore';
import { getSessionSerializers } from '../helpers/sessionRegistry';
import { stripTransientPanels } from '../../services/stripTransientPanels';
import { clearHistory } from '../../services/clearHistory';

const PANEL = 'p1';
const entry = (chapter: number) => ({ verseId: 43000 + chapter, bookNumber: 43, chapter, bookName: 'John' });
const visit = (chapter: number) => ({ ...entry(chapter), abbreviation: 'KJV' });

function seedPanel(): void {
  useBibleStore.setState({ panels: new Map() });
  useBibleStore.getState().initPanel(PANEL);
  const s = useBibleStore.getState();
  const ps = s.getPanelState(PANEL);
  const panels = new Map(s.panels);
  panels.set(PANEL, {
    ...ps,
    openTabs: [{
      tabId: 't1', abbreviation: 'KJV', name: 'KJV', displayMode: 'reading',
      book: 43, chapter: 3, bookName: 'John', selectedVerseId: null, history: [], historyIndex: -1,
    }],
    activeTabIndex: 0,
    currentBook: 43, currentChapter: 3, currentBookName: 'John',
    navigationHistory: [entry(1), entry(2), entry(3)],
    historyIndex: 2,
    visitStack: [visit(1), visit(2), visit(3)],
  });
  useBibleStore.setState({ panels });
}

function savedBible(): any {
  const ser = getSessionSerializers().get('bible')!;
  return ser();
}

beforeEach(() => {
  markDirty.mockReset();
  usePreferencesStore.setState({ reopenSearchTabs: false, rememberReadingHistory: false });
  seedPanel();
});

describe('defaults', () => {
  it('both preferences are off', () => {
    expect(usePreferencesStore.getInitialState().reopenSearchTabs).toBe(false);
    expect(usePreferencesStore.getInitialState().rememberReadingHistory).toBe(false);
  });

  it('a session saved by an older version (no keys) loads as off, and they round-trip when on', () => {
    usePreferencesStore.setState({ reopenSearchTabs: true, rememberReadingHistory: true });
    usePreferencesStore.getState().loadFromSession({ theme: 'light' });
    expect(usePreferencesStore.getState().reopenSearchTabs).toBe(false);
    expect(usePreferencesStore.getState().rememberReadingHistory).toBe(false);
    usePreferencesStore.getState().loadFromSession({ reopenSearchTabs: true, rememberReadingHistory: true });
    expect(usePreferencesStore.getState().getSessionData()).toMatchObject({ reopenSearchTabs: true, rememberReadingHistory: true });
    usePreferencesStore.getState().loadFromSession({ reopenSearchTabs: 'yes', rememberReadingHistory: 1 });
    expect(usePreferencesStore.getState().getSessionData()).toMatchObject({ reopenSearchTabs: false, rememberReadingHistory: false });
  });
});

describe('Bible session save', () => {
  it('off: history and Back stack are not written (panel and v1 mirror), the passage is', () => {
    const data = savedBible();
    const p = data.panels[PANEL];
    expect(p.tab.history).toEqual([]);
    expect(p.tab.historyIndex).toBe(-1);
    expect(p.visitStack).toBeUndefined();
    expect(data.openTabs[0].history).toEqual([]);
    expect(JSON.stringify(data)).not.toContain('43001');
    expect(p.tab).toMatchObject({ book: 43, chapter: 3, abbreviation: 'KJV' });
  });

  it('on: history and Back stack are written as before', () => {
    usePreferencesStore.setState({ rememberReadingHistory: true });
    const p = savedBible().panels[PANEL];
    expect(p.tab.history).toHaveLength(3);
    expect(p.tab.historyIndex).toBe(2);
    expect(p.visitStack).toHaveLength(3);
  });
});

describe('Bible session load', () => {
  const old = () => ({
    version: 2,
    panels: {
      [PANEL]: {
        tab: {
          tabId: 't1', abbreviation: 'KJV', name: 'KJV', displayMode: 'reading', book: 43, chapter: 3, bookName: 'John',
          selectedVerseId: null, history: [entry(1), entry(2)], historyIndex: 1,
        },
        visitStack: [visit(1), visit(2)],
      },
    },
  });

  it('off: an older session\'s history is dropped on load', () => {
    useBibleStore.getState().loadSessionData(old(), [PANEL]);
    const staged = useBibleStore.getState().sessionPanelStates.get(PANEL)!;
    expect(staged.tab.history).toEqual([]);
    expect(staged.visitStack).toBeUndefined();
    expect(staged.tab.chapter).toBe(3);
  });

  it('on: it is kept', () => {
    usePreferencesStore.setState({ rememberReadingHistory: true });
    useBibleStore.getState().loadSessionData(old(), [PANEL]);
    const staged = useBibleStore.getState().sessionPanelStates.get(PANEL)!;
    expect(staged.tab.history).toHaveLength(2);
    expect(staged.visitStack).toHaveLength(2);
  });

  it('a session without any history or visit stack still loads', () => {
    const raw = old();
    delete (raw.panels[PANEL] as any).visitStack;
    (raw.panels[PANEL].tab as any).history = undefined;
    useBibleStore.getState().loadSessionData(raw, [PANEL]);
    expect(useBibleStore.getState().sessionPanelStates.has(PANEL)).toBe(true);
  });
});

describe('layout snapshot', () => {
  const layout = () => ({
    grid: {
      root: {
        type: 'branch', size: 100,
        data: [
          { type: 'leaf', size: 50, data: { id: 'g1', views: ['b1'], activeView: 'b1' } },
          { type: 'leaf', size: 50, data: { id: 'g2', views: ['s1'], activeView: 's1' } },
        ],
      },
      width: 100, height: 100, orientation: 'HORIZONTAL',
    },
    panels: {
      b1: { id: 'b1', title: 'John 3', params: { contentType: 'bible' } },
      s1: { id: 's1', title: 'secret query', params: { contentType: 'search', searchQuery: 'secret query' } },
    },
    activeGroup: 'g2',
  }) as never;

  it('off: search panels (title and params) are left out of the saved layout', () => {
    const out = stripTransientPanels(layout(), { dropSearchPanels: true }) as any;
    expect(Object.keys(out.panels)).toEqual(['b1']);
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(out.activeGroup).toBe('g1');
  });

  it('on (default options): search panels stay', () => {
    const input = layout();
    expect(stripTransientPanels(input)).toBe(input);
  });

  it('serializeLayout follows the preference', () => {
    const api = { toJSON: () => layout() };
    useLayoutStore.setState({ dockviewApi: api as never });
    expect(Object.keys((useLayoutStore.getState().serializeLayout() as any).panels)).toEqual(['b1']);
    usePreferencesStore.setState({ reopenSearchTabs: true });
    expect(Object.keys((useLayoutStore.getState().serializeLayout() as any).panels).sort()).toEqual(['b1', 's1']);
    useLayoutStore.setState({ dockviewApi: null });
  });
});

describe('Clear history', () => {
  it('empties history and Back stack to the current passage, closes searches, keeps the passage', () => {
    usePreferencesStore.setState({ rememberReadingHistory: true });
    useSearchStore.setState({
      ...freshSessionFields(false),
      query: 'grace', resultsForQuery: 'grace', activeSessionId: 's1', parkedSessions: {}, sessionMeta: {},
      liveSuggestions: [{} as never],
    });
    const closeSearchResultsPanels = vi.fn();
    useLayoutStore.setState({ closeSearchResultsPanels });

    clearHistory();

    const ps = useBibleStore.getState().getPanelState(PANEL);
    expect(ps.navigationHistory).toHaveLength(1);
    expect(ps.navigationHistory[0]).toMatchObject({ bookNumber: 43, chapter: 3 });
    expect(ps.visitStack).toHaveLength(1);
    expect(ps.openTabs[0].history).toHaveLength(1);
    expect(ps.currentChapter).toBe(3);
    expect(closeSearchResultsPanels).toHaveBeenCalled();
    const s = useSearchStore.getState();
    expect(s.activeSessionId).toBeNull();
    expect(s.query).toBe('');
    expect(s.liveSuggestions).toEqual([]);
    expect(markDirty).toHaveBeenCalled();
    expect(savedBible().panels[PANEL].visitStack).toHaveLength(1);
  });

  it('also clears history still waiting for a pane that has not been shown yet', () => {
    usePreferencesStore.setState({ rememberReadingHistory: true });
    useBibleStore.getState().loadSessionData({
      version: 2,
      panels: { bg: { tab: { tabId: 'x', abbreviation: 'KJV', name: 'KJV', displayMode: 'reading', book: 43, chapter: 1, bookName: 'John', selectedVerseId: null, history: [entry(1), entry(2)], historyIndex: 1 }, visitStack: [visit(1), visit(2)] } },
    }, [PANEL]);
    expect(useBibleStore.getState().sessionPanelStates.get('bg')!.tab.history).toHaveLength(2);
    useLayoutStore.setState({ closeSearchResultsPanels: vi.fn() });
    clearHistory();
    const staged = useBibleStore.getState().sessionPanelStates.get('bg')!;
    expect(staged.tab.history).toEqual([]);
    expect(staged.visitStack).toBeUndefined();
  });
});
