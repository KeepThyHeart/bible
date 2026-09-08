/**
 * Bible toolbar behaviour tests.
 *
 * Three defects motivated most of these: the toolbar clips its own overflow, so
 * the history dropdown was rendered *inside* a ~33px-tall clip rectangle and
 * never appeared (the button looked dead); the Interlinear/Notes toggles were
 * shown in every display mode even though only Study mode renders anything they
 * control; and the gear made you open a two-item menu to reach the only setting
 * it had.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  state: {
    panels: new Map<string, unknown>(),
    setTabShowInterlinear: vi.fn(),
    setTabShowNotes: vi.fn(),
  } as {
    panels: Map<string, {
      navigationHistory: unknown[];
      historyIndex: number;
      openTabs: { tabId: string; showInterlinear?: boolean; showNotes?: boolean }[];
    }>;
    setTabShowInterlinear: ReturnType<typeof vi.fn>;
    setTabShowNotes: ReturnType<typeof vi.fn>;
  },
  ctx: { value: {} as Record<string, unknown> },
}));

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => `[${key}]`, locale: 'en', i18n: {} }),
}));

vi.mock('./BiblePaneContext', () => ({
  useBiblePaneContext: () => h.ctx.value,
}));

vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(h.state),
    { getState: () => h.state },
  ),
}));

vi.mock('../utils/openModuleManager', () => ({ openModuleManager: vi.fn() }));

import BibleToolbar from './BibleToolbar';

const PANEL = 'bible_1';

const HISTORY = [
  { verseId: 43003016, bookNumber: 43, chapter: 3, bookName: 'John' },
  { verseId: 1001001, bookNumber: 1, chapter: 1, bookName: 'Genesis' },
];

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    panelId: PANEL,
    activeTab: { tabId: 'tab1', abbreviation: 'KJV', name: 'King James Version', displayMode: 'standard' },
    openTabs: [{ tabId: 'tab1', abbreviation: 'KJV' }],
    availableBibles: [{ abbreviation: 'KJV', name: 'King James Version' }],
    isParallelViewMode: false,
    isLoading: false,
    currentBook: 43,
    currentChapter: 3,
    displayMode: 'standard',
    showHistoryDropdown: false,
    setShowHistoryDropdown: vi.fn(),
    canGoBack: () => true,
    canGoForward: () => false,
    goBackWithScroll: vi.fn(),
    goForwardWithScroll: vi.fn(),
    navigateToHistoryEntryWithScroll: vi.fn(),
    setVersionSelectorTabId: vi.fn(),
    setShowSelector: vi.fn(),
    handleSetDisplayMode: vi.fn(),
    toggleParallelView: vi.fn(),
    setShowParallelPicker: vi.fn(),
    setParallelSelections: vi.fn(),
    handlePreviousChapter: vi.fn(),
    handleNextChapter: vi.fn(),
    isDetached: false,
    handleDetachPane: vi.fn(),
    ...overrides,
  };
}

function setHistory(history: unknown[], historyIndex: number) {
  h.state.panels = new Map([[PANEL, {
    navigationHistory: history,
    historyIndex,
    openTabs: [{ tabId: 'tab1' }],
  }]]);
}

beforeEach(() => {
  vi.clearAllMocks();
  setHistory(HISTORY, 1);
  h.ctx.value = makeCtx();
});

describe('BibleToolbar — navigation history', () => {
  it('renders the history menu when the dropdown is open', () => {
    h.ctx.value = makeCtx({ showHistoryDropdown: true });
    render(<BibleToolbar />);

    expect(screen.getByRole('menu', { name: '[biblePane.navHistoryHeading]' })).toBeInTheDocument();
    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('Genesis 1:1')).toBeInTheDocument();
  });

  it('renders the history menu outside the toolbar so its overflow clip cannot hide it', () => {
    h.ctx.value = makeCtx({ showHistoryDropdown: true });
    render(<BibleToolbar />);

    const toolbar = screen.getByRole('toolbar');
    const menu = screen.getByRole('menu', { name: '[biblePane.navHistoryHeading]' });
    // The regression: an in-toolbar menu is invisible, because the toolbar sets
    // overflow-hidden to keep its buttons from spilling out of a narrow pane.
    expect(toolbar.className).toContain('overflow-hidden');
    expect(toolbar.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
  });

  it('toggles the dropdown open from the history button', () => {
    const setShowHistoryDropdown = vi.fn();
    h.ctx.value = makeCtx({ setShowHistoryDropdown });
    render(<BibleToolbar />);

    fireEvent.click(screen.getByTestId('history-dropdown-toggle'));
    expect(setShowHistoryDropdown).toHaveBeenCalledWith(true);
  });

  it('navigates to the clicked entry using its original index, not the display order', () => {
    const navigateToHistoryEntryWithScroll = vi.fn();
    h.ctx.value = makeCtx({ showHistoryDropdown: true, navigateToHistoryEntryWithScroll });
    render(<BibleToolbar />);

    // The list is shown newest-first, so "John 3:16" is the *second* row but
    // history index 0.
    fireEvent.click(screen.getByText('John 3:16'));
    expect(navigateToHistoryEntryWithScroll).toHaveBeenCalledWith(0);
  });

  it('marks the current entry for assistive tech', () => {
    h.ctx.value = makeCtx({ showHistoryDropdown: true });
    render(<BibleToolbar />);

    const current = screen.getByRole('menuitem', { current: true });
    expect(current).toHaveTextContent('Genesis 1:1');
  });

  it('says so when there is no history yet', () => {
    setHistory([], -1);
    h.ctx.value = makeCtx({ showHistoryDropdown: true });
    render(<BibleToolbar />);

    expect(screen.getByText('[biblePane.noHistory]')).toBeInTheDocument();
  });
});

describe('BibleToolbar — text settings gear', () => {
  it('opens text settings on the first click, with no intermediate menu', () => {
    const listener = vi.fn();
    window.addEventListener('open-preferences-fonts', listener);
    render(<BibleToolbar />);

    fireEvent.click(screen.getByTestId('passage-settings'));

    expect(listener).toHaveBeenCalledTimes(1);
    // The gear opens Text Settings directly; nothing menu-like should appear.
    expect(screen.queryByRole('menuitem', { name: 'Text settings…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Pop out to window' })).not.toBeInTheDocument();
    window.removeEventListener('open-preferences-fonts', listener);
  });

  it('targets the Bible pane font settings', () => {
    const listener = vi.fn();
    window.addEventListener('open-preferences-fonts', listener);
    render(<BibleToolbar />);

    fireEvent.click(screen.getByTestId('passage-settings'));

    expect((listener.mock.calls[0]![0] as CustomEvent<string>).detail).toBe('bible');
    window.removeEventListener('open-preferences-fonts', listener);
  });

  it('is not advertised as a menu button', () => {
    render(<BibleToolbar />);

    const gear = screen.getByTestId('passage-settings');
    expect(gear.getAttribute('aria-haspopup')).toBeNull();
    expect(gear.getAttribute('aria-expanded')).toBeNull();
  });
});

describe('BibleToolbar — Interlinear / Notes toggles', () => {
  // The checkbox strip at the top of the chapter (`study/StudyControls.tsx`) is
  // the only control for these; the toolbar must not carry a duplicate pair of
  // toggle buttons at its right end. Asserted so that surface cannot quietly
  // come back.
  it('does not render toolbar toggles in any display mode', () => {
    for (const displayMode of ['standard', 'reading', 'study'] as const) {
      h.ctx.value = makeCtx({ displayMode });
      const { unmount } = render(<BibleToolbar />);
      expect(screen.queryByTestId('toggle-interlinear')).not.toBeInTheDocument();
      expect(screen.queryByTestId('toggle-notes')).not.toBeInTheDocument();
      unmount();
    }
  });
});
