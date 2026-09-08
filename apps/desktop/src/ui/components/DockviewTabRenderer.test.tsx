/**
 * Unit tests for the dockview tab context menu, focused on "Pop Out to Window".
 *
 * This component is where pop-out *starts*: it reads the live pane state out of
 * the relevant Zustand store, flattens it into a plain serializable object, and
 * hands it to `window.electron.window.detachPane`. Everything downstream - the
 * window title, whether the detached pane comes up populated or blank - is
 * decided by what this function gathers.
 *
 * That makes it the single highest-value place to test: `DockviewLayout.test.tsx`
 * mocks this component out entirely, so nothing else exercises it.
 *
 * The payload has to survive Electron's structured clone on the way to the main
 * process, so the tests also assert Maps are serialized to entry arrays rather
 * than sent as live Maps.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetBiblePanelState = vi.fn();
const mockGetCommentaryPanelState = vi.fn();
const mockGetBookPanelState = vi.fn();
const mockGetNotesPanelNavState = vi.fn();
const mockGetStudyPanelState = vi.fn();
const mockGetTopicsPanelState = vi.fn();

vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: { getState: () => ({ getPanelState: mockGetBiblePanelState }) },
}));

vi.mock('../stores/useCommentaryStore', () => ({
  useCommentaryStore: { getState: () => ({ getPanelState: mockGetCommentaryPanelState }) },
}));

vi.mock('../stores/useBookStore', () => ({
  useBookStore: { getState: () => ({ getPanelState: mockGetBookPanelState }) },
}));

vi.mock('../stores/useStudyStore', () => ({
  useStudyStore: { getState: () => ({ getPanelState: mockGetStudyPanelState }) },
}));

vi.mock('../stores/useTopicsStore', () => ({
  useTopicsStore: { getState: () => ({ getPanelState: mockGetTopicsPanelState }) },
}));

vi.mock('../stores/useFileNotesStore', () => ({
  getNotesPanelNavState: (...args: unknown[]) => mockGetNotesPanelNavState(...args),
}));

vi.mock('../utils/verseReference', () => ({
  formatVerseReference: (verseId: number) => `ref:${verseId}`,
}));

vi.mock('../stores/useLayoutStore', () => ({
  useLayoutStore: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../utils/paneNames', () => ({
  localizePaneLabel: (_t: unknown, _type: unknown, label: string) => label,
}));

vi.mock('../utils/overlayPosition', () => ({
  anchorAtPointerX: () => ({ left: 0 }),
}));

vi.mock('../hooks/useOverlayDismissal', () => ({
  useOverlayDismissal: vi.fn(),
}));

import DockviewTabRenderer from './DockviewTabRenderer';
import { PANEL_CONTENT_ICONS, tabIconFor } from './paneIcons';
import type { PanelContentType } from '../stores/useLayoutStore';

const PANEL_ID = 'panel-7';

let detachPane: ReturnType<typeof vi.fn>;

function makeProps(
  contentType: string | undefined,
  title = 'Tab',
  /** Tabs in this tab's own group - what the close "x" is gated on. */
  groupTabCount = 1,
  /** Tabs in the whole workbench - what the context menu's Close is gated on. */
  workbenchTabCount = groupTabCount,
) {
  const groupPanels = Array.from({ length: groupTabCount }, (_, i) => ({ id: `${PANEL_ID}-g${i}` }));
  return {
    api: {
      id: PANEL_ID,
      title,
      group: { id: 'group-1', panels: groupPanels },
      onDidTitleChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidGroupChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      close: vi.fn(),
    },
    containerApi: {
      panels: Array.from({ length: workbenchTabCount }, (_, i) => ({ id: `${PANEL_ID}-w${i}` })),
      onDidLayoutChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      getPanel: vi.fn().mockReturnValue({ id: PANEL_ID, api: { moveTo: vi.fn() } }),
      addGroup: vi.fn().mockReturnValue({ id: 'group-2' }),
    },
    params: { contentType },
  } as any;
}

/** Right-click the tab and click "Pop Out to Window". */
async function popOut(contentType: string) {
  const user = userEvent.setup();
  render(<DockviewTabRenderer {...makeProps(contentType)} />);

  await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Tab') });
  await user.click(screen.getByRole('button', { name: 'ui.dockviewTab.popOutToWindow' }));
}

/** The (paneType, initialState) pair handed to the main process. */
function detachCall(): [string, Record<string, any>] {
  expect(detachPane).toHaveBeenCalledTimes(1);
  return detachPane.mock.calls[0] as [string, Record<string, any>];
}

const BIBLE_PANEL_STATE = {
  openTabs: [
    { abbreviation: 'KJV', name: 'King James Version' },
    { abbreviation: 'ESV', name: 'English Standard Version' },
  ],
  activeTabIndex: 1,
  currentBook: 43,
  currentChapter: 3,
  currentBookName: 'John',
  selectedVerseId: 43003016,
};

const COMMENTARY_PANEL_STATE = {
  openTabs: [{ abbreviation: 'MHC', name: 'Matthew Henry' }],
  activeTabIndex: 0,
  currentVerseId: 43003016,
  entriesByTab: new Map([['MHC', [{ entry_id: 1, text: 'For God so loved...' }]]]),
  browseModeByTab: new Map([['MHC', true]]),
};

const BOOK_PANEL_STATE = {
  openTabs: [{ abbreviation: 'book_pp', name: "Pilgrim's Progress" }],
  activeTabIndex: 0,
  currentSectionByTab: new Map([['book_pp', 12]]),
  sectionsByTab: new Map([['book_pp', { section_id: 12, title: 'The Slough of Despond' }]]),
  childSectionsByTab: new Map([['book_pp', [{ section_id: 13, title: 'Chapter 2' }]]]),
  sectionSummariesByTab: new Map([['book_pp', [{ section_id: 12, title: 'Chapter 1' }]]]),
  loadingByTab: new Map(),
  errorByTab: new Map(),
  loadingSummariesByTab: new Map(),
};

beforeEach(() => {
  vi.clearAllMocks();

  detachPane = vi.fn().mockResolvedValue({ success: true, windowId: 'detached-1' });
  (window as any).electron = {
    ...(window as any).electron,
    window: { detachPane },
  };

  mockGetBiblePanelState.mockReturnValue(BIBLE_PANEL_STATE);
  mockGetCommentaryPanelState.mockReturnValue(COMMENTARY_PANEL_STATE);
  mockGetBookPanelState.mockReturnValue(BOOK_PANEL_STATE);
  mockGetStudyPanelState.mockReturnValue({ currentVerseId: 43003016 });
  mockGetTopicsPanelState.mockReturnValue({ currentVerseId: null, liveVerseId: 43003016 });
  mockGetNotesPanelNavState.mockReturnValue(undefined);
});

describe('close button', () => {
  it('is hidden when this pane is down to its last tab', () => {
    // Closing it would take the whole pane with it - the split collapses and
    // there is no obvious way to bring it back. Right-click -> Close still
    // offers the action for anyone who means it.
    render(<DockviewTabRenderer {...makeProps('bible', 'John 3', 1, 3)} />);
    expect(screen.queryByTestId('close-tab')).not.toBeInTheDocument();
  });

  it('is shown once the pane holds more than one tab', () => {
    render(<DockviewTabRenderer {...makeProps('bible', 'John 3', 2)} />);
    expect(screen.getByTestId('close-tab')).toBeInTheDocument();
  });

  it('counts tabs in this group, not in the whole workbench', () => {
    // Regression: the count came from `containerApi.panels`, so a lone Bible
    // tab in the left pane still offered a x whenever any other pane had tabs.
    render(<DockviewTabRenderer {...makeProps('bible', 'John 3', 1, 6)} />);
    expect(screen.queryByTestId('close-tab')).not.toBeInTheDocument();
  });

  it('closes the panel when clicked', async () => {
    const user = userEvent.setup();
    const props = makeProps('bible', 'John 3', 2);
    render(<DockviewTabRenderer {...props} />);

    await user.click(screen.getByTestId('close-tab'));
    expect(props.api.close).toHaveBeenCalledTimes(1);
  });

  it('re-reads the group when the layout changes', () => {
    // dockview does not re-render tab headers when a sibling tab is closed.
    const props = makeProps('bible', 'John 3', 2);
    render(<DockviewTabRenderer {...props} />);
    expect(screen.getByTestId('close-tab')).toBeInTheDocument();

    props.api.group.panels = [{ id: 'only-one' }];
    act(() => {
      const notify = props.containerApi.onDidLayoutChange.mock.calls[0][0] as () => void;
      notify();
    });

    expect(screen.queryByTestId('close-tab')).not.toBeInTheDocument();
  });
});

describe('tab icons', () => {
  it.each(['study', 'commentary', 'topics', 'dictionary'])(
    'shows no icon on the staple %s tab',
    (contentType) => {
      render(<DockviewTabRenderer {...makeProps(contentType, 'Tab')} />);
      expect(tabIconFor(contentType as PanelContentType)).toBeUndefined();
      // The label is the tab's only content.
      expect(screen.getByText('Tab').closest('.dockview-tab-content')?.textContent).toBe('Tab');
    },
  );

  it('keeps the icon on a Books tab', () => {
    render(<DockviewTabRenderer {...makeProps('book', 'Tab')} />);
    const icon = PANEL_CONTENT_ICONS.book;
    expect(icon).toBeDefined();
    expect(screen.getByText('Tab').closest('.dockview-tab-content')?.textContent).toContain(icon);
  });

  it('keeps the icon on a Bible tab', () => {
    render(<DockviewTabRenderer {...makeProps('bible', 'Tab')} />);
    expect(screen.getByText('Tab').closest('.dockview-tab-content')?.textContent)
      .toContain(PANEL_CONTENT_ICONS.bible);
  });
});

describe('context menu', () => {
  it('offers Pop Out to Window on right-click', async () => {
    const user = userEvent.setup();
    render(<DockviewTabRenderer {...makeProps('bible')} />);

    expect(screen.queryByRole('button', { name: 'ui.dockviewTab.popOutToWindow' })).not.toBeInTheDocument();
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Tab') });
    expect(screen.getByRole('button', { name: 'ui.dockviewTab.popOutToWindow' })).toBeInTheDocument();
  });

  it('closes the menu after popping out', async () => {
    await popOut('bible');
    expect(screen.queryByRole('button', { name: 'ui.dockviewTab.popOutToWindow' })).not.toBeInTheDocument();
  });
});

describe('pop out: pane type routing', () => {
  it.each([
    ['bible', 'bible'],
    ['commentary', 'commentary'],
    ['book', 'book'],
    // Dictionaries ride in the Books window: the two share one tab strip in
    // the docked layout, and `DetachedWindow` has no dictionary-only component.
    ['dictionary', 'book'],
    ['notes', 'verse-notes'],
    // Each of these needs a window type of its own: Prayer must open a Prayer
    // window, and Study and Topics their own, not a Bible one seeded with
    // nothing at all.
    ['prayer', 'prayer'],
    ['study', 'study'],
    ['topics', 'topics'],
  ])('maps content type %s to pane type %s', async (contentType, expected) => {
    await popOut(contentType);
    expect(detachCall()[0]).toBe(expected);
  });

  it.each(['search', 'newtab'])(
    'does not offer %s a window of its own',
    async (contentType) => {
      const user = userEvent.setup();
      render(<DockviewTabRenderer {...makeProps(contentType as any)} />);

      await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Tab') });

      // Search results live in a store the new window does not share, and the
      // "+" page is a way to make a pane, not one worth keeping - so the menu
      // leaves the item off rather than offering a gesture that does nothing.
      expect(
        screen.queryByRole('button', { name: 'ui.dockviewTab.popOutToWindow' })
      ).not.toBeInTheDocument();
    }
  );

  it('reads state from the panel that was right-clicked', async () => {
    await popOut('bible');
    expect(mockGetBiblePanelState).toHaveBeenCalledWith(PANEL_ID);
  });
});

describe('pop out: verse-following panes', () => {
  // Both panes seed themselves from the Bible pane on mount, and a detached
  // window has no Bible pane - so the verse has to travel in the payload or
  // the window opens on an empty state.
  it('carries the Study pane verse across', async () => {
    await popOut('study');
    const [, state] = detachCall();

    expect(state.initialVerseId).toBe(43003016);
    expect(state.verseName).toBe('ref:43003016');
  });

  it('falls back to the Topics pane live verse when it has navigated away', async () => {
    await popOut('topics');
    const [, state] = detachCall();

    expect(state.initialVerseId).toBe(43003016);
  });

  it('sends no verse when the pane never had one', async () => {
    mockGetStudyPanelState.mockReturnValue({ currentVerseId: null });
    await popOut('study');
    const [, state] = detachCall();

    expect(state.initialVerseId).toBeNull();
    expect(state.verseName).toBeUndefined();
  });
});

describe('pop out: Bible state handover', () => {
  it('carries the passage across', async () => {
    await popOut('bible');
    const [, state] = detachCall();

    expect(state.currentBook).toBe(43);
    expect(state.currentChapter).toBe(3);
    expect(state.currentBookName).toBe('John');
    expect(state.selectedVerseId).toBe(43003016);
  });

  it('carries the open tabs and active index across', async () => {
    await popOut('bible');
    const [, state] = detachCall();

    expect(state.openTabs).toEqual(BIBLE_PANEL_STATE.openTabs);
    expect(state.activeTabIndex).toBe(1);
  });

  it('includes activeTab so the window gets a correct title', async () => {
    // Regression: paneConfig.bible.titleFormat reads `state.activeTab.abbreviation`.
    // Omitting it made every popped-out passage read "Bible - Bible - John 3".
    await popOut('bible');
    const [, state] = detachCall();

    expect(state.activeTab).toEqual({ abbreviation: 'ESV', name: 'English Standard Version' });
  });

  it('resolves activeTab from the active index, not the first tab', async () => {
    await popOut('bible');
    expect(detachCall()[1].activeTab.abbreviation).toBe('ESV');
  });

  it('survives a panel with no open tabs', async () => {
    mockGetBiblePanelState.mockReturnValue({
      ...BIBLE_PANEL_STATE, openTabs: [], activeTabIndex: 0,
    });
    await popOut('bible');
    const [, state] = detachCall();

    expect(state.openTabs).toEqual([]);
    expect(state.activeTab).toBeUndefined();
  });
});

describe('pop out: Commentary state handover', () => {
  it('carries tabs and the current verse across', async () => {
    await popOut('commentary');
    const [, state] = detachCall();

    expect(state.openTabs).toEqual(COMMENTARY_PANEL_STATE.openTabs);
    expect(state.activeTabIndex).toBe(0);
    expect(state.currentVerseId).toBe(43003016);
  });

  it('serializes per-tab Maps as entry arrays', async () => {
    // The payload crosses an IPC boundary; a live Map does not survive
    // structured clone in a form the detached renderer can rebuild from.
    await popOut('commentary');
    const [, state] = detachCall();

    expect(Array.isArray(state.entriesByTab)).toBe(true);
    expect(state.entriesByTab).toEqual([['MHC', [{ entry_id: 1, text: 'For God so loved...' }]]]);
    expect(Array.isArray(state.browseModeByTab)).toBe(true);
    expect(state.browseModeByTab).toEqual([['MHC', true]]);
  });

  it('opens on the overview when no commentary tabs are open', async () => {
    mockGetCommentaryPanelState.mockReturnValue({
      ...COMMENTARY_PANEL_STATE, openTabs: [],
    });
    await popOut('commentary');
    expect(detachCall()[1].overviewActive).toBe(true);
  });

  it('does not force the overview when a commentary tab is open', async () => {
    await popOut('commentary');
    expect(detachCall()[1].overviewActive).toBe(false);
  });
});

describe('pop out: Book state handover', () => {
  it('carries the open books across', async () => {
    // Regression: this branch did not exist, so the Books pane popped out with
    // an empty payload and the detached window rendered a blank pane.
    await popOut('book');
    const [, state] = detachCall();

    expect(state.openTabs).toEqual(BOOK_PANEL_STATE.openTabs);
    expect(state.activeTabIndex).toBe(0);
  });

  it('carries the current section so the window opens where the user was reading', async () => {
    await popOut('book');
    const [, state] = detachCall();

    expect(state.currentSectionByTab).toEqual([['book_pp', 12]]);
    expect(state.sectionsByTab).toEqual([
      ['book_pp', { section_id: 12, title: 'The Slough of Despond' }],
    ]);
  });

  it('serializes the navigation Maps as entry arrays', async () => {
    await popOut('book');
    const [, state] = detachCall();

    for (const key of ['currentSectionByTab', 'sectionsByTab', 'childSectionsByTab', 'sectionSummariesByTab']) {
      expect(Array.isArray(state[key]), key).toBe(true);
    }
  });

  it('reads book state from the right panel', async () => {
    await popOut('book');
    expect(mockGetBookPanelState).toHaveBeenCalledWith(PANEL_ID);
  });
});

describe('pop out: Notes state handover', () => {
  it('carries the saved navigation state across', async () => {
    mockGetNotesPanelNavState.mockReturnValue({
      view: 'editor',
      currentPath: 'C:/notes/romans',
      currentNotePath: 'C:/notes/romans/ch8.bn',
    });

    await popOut('notes');
    const [paneType, state] = detachCall();

    expect(paneType).toBe('verse-notes');
    expect(state.initialView).toBe('editor');
    expect(state.initialCurrentPath).toBe('C:/notes/romans');
    expect(state.initialCurrentNotePath).toBe('C:/notes/romans/ch8.bn');
  });

  it('still pops out when the pane has no recorded nav state', async () => {
    mockGetNotesPanelNavState.mockReturnValue(undefined);
    await popOut('notes');
    expect(detachCall()[1]).toEqual({});
  });

  it('tells the in-place pane to close its editor so the note is not edited twice', async () => {
    const popOutEvents: CustomEvent[] = [];
    const listener = (e: Event) => popOutEvents.push(e as CustomEvent);
    window.addEventListener('notes-pane-popped-out', listener);

    mockGetNotesPanelNavState.mockReturnValue({
      view: 'editor', currentPath: 'C:/notes', currentNotePath: 'C:/notes/a.bn',
    });
    await popOut('notes');
    window.removeEventListener('notes-pane-popped-out', listener);

    expect(popOutEvents).toHaveLength(1);
    expect(popOutEvents[0].detail).toEqual({ panelId: PANEL_ID });
  });

  it('does not fire the dual-edit signal when the detach failed', async () => {
    // Firing it anyway would close the user's editor without having opened a
    // replacement window - losing their place for nothing.
    detachPane.mockResolvedValue({ success: false, error: 'nope' });
    const popOutEvents: Event[] = [];
    const listener = (e: Event) => popOutEvents.push(e);
    window.addEventListener('notes-pane-popped-out', listener);

    await popOut('notes');
    window.removeEventListener('notes-pane-popped-out', listener);

    expect(popOutEvents).toHaveLength(0);
  });

  it('does not fire the dual-edit signal for non-notes panes', async () => {
    const popOutEvents: Event[] = [];
    const listener = (e: Event) => popOutEvents.push(e);
    window.addEventListener('notes-pane-popped-out', listener);

    await popOut('bible');
    window.removeEventListener('notes-pane-popped-out', listener);

    expect(popOutEvents).toHaveLength(0);
  });
});

describe('pop out: payload safety', () => {
  it('sends a structured-clone-safe payload', async () => {
    // Electron throws "An object could not be cloned" if any value in the
    // payload is a function, Map, Set, or class instance. Round-tripping
    // through JSON is a close enough proxy to catch that in a unit test.
    for (const contentType of ['bible', 'commentary', 'book']) {
      cleanup(); // unmount the previous iteration's tab before rendering the next
      vi.clearAllMocks();
      detachPane.mockResolvedValue({ success: true, windowId: 'detached-1' });
      mockGetBiblePanelState.mockReturnValue(BIBLE_PANEL_STATE);
      mockGetCommentaryPanelState.mockReturnValue(COMMENTARY_PANEL_STATE);
      mockGetBookPanelState.mockReturnValue(BOOK_PANEL_STATE);

      await popOut(contentType);
      const [, state] = detachCall();

      expect(() => structuredClone(state), contentType).not.toThrow();
      expect(JSON.parse(JSON.stringify(state)), contentType).toEqual(state);
    }
  });

  it('reports a failed detach without throwing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    detachPane.mockResolvedValue({ success: false, error: 'window creation failed' });

    await popOut('bible');

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('swallows a rejected detach rather than breaking the tab', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    detachPane.mockRejectedValue(new Error('IPC channel closed'));

    await expect(popOut('bible')).resolves.not.toThrow();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not offer pop-out when the panel has no content type', async () => {
    const user = userEvent.setup();
    render(<DockviewTabRenderer {...makeProps(undefined as any)} />);

    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Tab') });

    expect(
      screen.queryByRole('button', { name: 'ui.dockviewTab.popOutToWindow' })
    ).not.toBeInTheDocument();
    expect(detachPane).not.toHaveBeenCalled();
  });
});
