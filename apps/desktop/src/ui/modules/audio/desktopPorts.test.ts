import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue(null),
    getBookName: vi.fn().mockResolvedValue('John'),
    getChapter: vi.fn().mockResolvedValue({ verses: [{ verse_id: 43003001, verse: 1, text: 'x' }] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: { getAvailableCommentaries: vi.fn().mockResolvedValue([]), getEntriesForVerse: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../stores/helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));

import { useBibleStore } from '../../stores/useBibleStore';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { desktopModulesPort, desktopReaderPort, panelIdOfTab } from './desktopPorts';

const P = 'audio_panel_a';
const Q = 'audio_panel_b';
const KJV = { abbreviation: 'KJV', name: 'King James', database_path: 'k.db', module_id: 1, language_code: 'en' };
const ESV = { abbreviation: 'ESV', name: 'ESV', database_path: 'e.db', module_id: 2, language_code: 'en' };

describe('desktopReaderPort', () => {
  beforeEach(async () => {
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV, ESV], initialLoadComplete: false });
    for (const id of [P, Q]) {
      useBibleStore.getState().initPanel(id);
      useBibleStore.getState().openBible(id, 'KJV', KJV.name);
    }
    await useBibleStore.getState().loadChapter(P, 43, 3);
    useLayoutStore.setState({ lastActiveBiblePanelId: P });
  });

  it('maps a pane to a tab', () => {
    const t = desktopReaderPort.tab(P)!;
    expect(t).toMatchObject({ id: P, moduleAbbr: 'KJV', book: 43, chapter: 3, loading: false });
    expect(t.verses.map(v => v.verse)).toEqual([1]);
    expect(t.studyVerse).toBe(43003001);
    expect(desktopReaderPort.tab(P)).toBe(t); // stable while nothing changed
  });

  it('activeTab is the last active pane', () => {
    expect(desktopReaderPort.activeTab()?.id).toBe(P);
    useLayoutStore.setState({ lastActiveBiblePanelId: Q });
    expect(desktopReaderPort.activeTab()?.id).toBe(Q);
    useLayoutStore.setState({ lastActiveBiblePanelId: 'gone' });
    expect(desktopReaderPort.activeTab()?.id).toBeDefined();
  });

  it('selectionStart is the start of the selected range', () => {
    useBibleStore.getState().setSelectedVerse(P, 43003016);
    useBibleStore.getState().extendSelectionTo(P, 43003014);
    expect(desktopReaderPort.selectionStart(P)).toBe(43003014);
    expect(desktopReaderPort.selectionStart('none')).toBeNull();
  });

  it('closing a pane makes tab() undefined', () => {
    useBibleStore.setState({ panels: new Map([...useBibleStore.getState().panels].filter(([id]) => id !== P)) });
    expect(desktopReaderPort.tab(P)).toBeUndefined();
  });

  it('a translation change shows in moduleAbbr and notifies', () => {
    const listener = vi.fn();
    const off = desktopReaderPort.subscribe(listener);
    useBibleStore.getState().openBible(P, 'ESV', ESV.name);
    expect(listener).toHaveBeenCalled();
    off();
    expect(desktopReaderPort.tab(P)!.moduleAbbr).toBe('ESV');
  });

  it('maps a Bible tab id to its pane', () => {
    const panel = useBibleStore.getState().getPanelState(Q);
    expect(panelIdOfTab(panel.openTabs[panel.activeTabIndex].tabId)).toBe(Q);
    expect(panelIdOfTab('nope')).toBeUndefined();
  });

  it('followTo turns the page without moving the selection', async () => {
    useBibleStore.getState().setSelectedVerse(P, 43003016);
    await desktopReaderPort.followTo(P, 43, 4);
    expect(desktopReaderPort.tab(P)).toMatchObject({ book: 43, chapter: 4, studyVerse: 43003016 });
  });

  it('markStopped selects the verse (collapsing a range) and reveal activates the dockview panel', () => {
    useBibleStore.getState().setSelectedVerse(P, 43003014);
    useBibleStore.getState().extendSelectionTo(P, 43003016);
    desktopReaderPort.markStopped!(P, 43003001);
    const ps = useBibleStore.getState().getPanelState(P);
    expect(ps.selectedVerseId).toBe(43003001);
    expect(ps.selectionEndVerseId).toBeNull();
    const setActive = vi.fn();
    useLayoutStore.setState({ dockviewApi: { getPanel: (id: string) => (id === P ? { api: { setActive } } : undefined) } as never });
    desktopReaderPort.reveal!(P);
    desktopReaderPort.reveal!('gone');
    expect(setActive).toHaveBeenCalledTimes(1);
    useLayoutStore.setState({ dockviewApi: null as never });
  });
});

describe('desktopModulesPort', () => {
  it('languageOf and change notifications', () => {
    useBibleStore.setState({ availableBibles: [KJV] });
    expect(desktopModulesPort.languageOf('KJV')).toBe('en');
    expect(desktopModulesPort.languageOf('XXX')).toBe('');
    const l = vi.fn();
    const off = desktopModulesPort.subscribe(l);
    useBibleStore.setState({ availableBibles: [KJV, ESV] });
    expect(l).toHaveBeenCalledTimes(1);
    useBibleStore.setState({ initialLoadComplete: true });
    expect(l).toHaveBeenCalledTimes(1);
    off();
  });
});
