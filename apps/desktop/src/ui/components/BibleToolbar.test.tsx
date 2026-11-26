/**
 * Bible toolbar behaviour tests.
 *
 * Three defects motivated most of these: the toolbar clips its own overflow, so
 * the history dropdown was rendered *inside* a ~33px-tall clip rectangle and
 * never appeared (the button looked dead); and the Interlinear/Notes toggles were
 * shown in every display mode even though only Study mode renders anything they
 * control. The gear opens a panel of the Bible pane's settings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

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
  useI18n: () => ({
    t: (key: string) => `[${key}]`,
    locale: 'en',
    i18n: {},
    localizer: { formatNumber: (n: number) => String(n) },
  }),
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
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useTextSettingsStore } from '../stores/useTextSettingsStore';
import { readerToolbarItems } from '../modules/host/slots';

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
    currentBookName: 'John',
    setShowBookPicker: vi.fn(),
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
    // The menu stays portalled even though the toolbar no longer clips: it now wraps its
    // controls onto a second row (B-105) instead of hiding the ones that do not fit.
    expect(toolbar.className).toContain('flex-wrap');
    expect(toolbar.className).not.toContain('overflow-hidden');
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

describe('BibleToolbar — settings panel', () => {
  beforeEach(() => {
    usePreferencesStore.getState().resetTypography();
    useTextSettingsStore.getState().resetSettings('bible');
  });

  const openPanel = () => {
    fireEvent.click(screen.getByTestId('passage-settings'));
    return screen.getByRole('dialog', { name: '[biblePane.settingsPanelTitle]' });
  };

  it('opens a panel of Bible pane settings in place, not the Preferences dialog', () => {
    const fonts = vi.fn();
    window.addEventListener('open-preferences-fonts', fonts);
    render(<BibleToolbar />);

    const gear = screen.getByTestId('passage-settings');
    expect(gear.getAttribute('aria-haspopup')).toBe('dialog');
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    openPanel();
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    expect(fonts).not.toHaveBeenCalled();
    window.removeEventListener('open-preferences-fonts', fonts);
  });

  it('changes the Typography Bible size while the pane follows Typography', () => {
    render(<BibleToolbar />);
    openPanel();
    fireEvent.click(screen.getByTestId('bible-settings-larger'));
    expect(usePreferencesStore.getState().typography.bibleFontSize).toBe(21);
    expect(useTextSettingsStore.getState().customized.bible).toBe(false);
  });

  it('changes the pane override instead once Preferences > Fonts has customized the Bible pane', () => {
    useTextSettingsStore.getState().updateSettings('bible', { fontSize: 24 });
    render(<BibleToolbar />);
    openPanel();
    fireEvent.click(screen.getByTestId('bible-settings-smaller'));
    expect(useTextSettingsStore.getState().settings.bible.fontSize).toBe(23);
    expect(usePreferencesStore.getState().typography.bibleFontSize).toBe(20);
  });

  it('sets the text width of the display mode on screen only', () => {
    h.ctx.value = makeCtx({ displayMode: 'reading' });
    render(<BibleToolbar />);
    openPanel();
    fireEvent.change(screen.getByTestId('bible-settings-width'), { target: { value: 'full' } });
    const { standardWidth, readingWidth, studyWidth } = usePreferencesStore.getState().typography;
    expect([standardWidth, readingWidth, studyWidth]).toEqual(['medium', 'full', 'medium']);
  });

  it('has no text width in Parallel view, which fills the pane', () => {
    h.ctx.value = makeCtx({ isParallelViewMode: true });
    render(<BibleToolbar />);
    openPanel();
    expect(screen.queryByTestId('bible-settings-width')).not.toBeInTheDocument();
  });

  it('links to the full Typography preferences and closes', () => {
    const section = vi.fn();
    window.addEventListener('open-preferences-section', section);
    render(<BibleToolbar />);
    openPanel();
    fireEvent.click(screen.getByTestId('bible-settings-all'));
    expect((section.mock.calls[0]![0] as CustomEvent<string>).detail).toBe('typography');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    window.removeEventListener('open-preferences-section', section);
  });

  it('sets the app-wide scrollbar size', () => {
    render(<BibleToolbar />);
    openPanel();
    fireEvent.change(screen.getByTestId('bible-settings-scrollbar'), { target: { value: 'large' } });
    expect(usePreferencesStore.getState().scrollbarSize).toBe('large');
    usePreferencesStore.getState().setScrollbarSize('standard');
  });

  it('closes on Escape', () => {
    render(<BibleToolbar />);
    openPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

describe('BibleToolbar - module toolbar items', () => {
  it('renders the items feature modules register into the toolbar slot, for the active tab', () => {
    const reg = readerToolbarItems.register(({ tabId }) => <button data-testid="module-toggle" data-tab={tabId} aria-pressed="false" />);
    render(<BibleToolbar />);
    const toggle = screen.getByTestId('module-toggle');
    expect(toggle).toHaveAttribute('data-tab', 'tab1');
    expect(screen.getByRole('toolbar').contains(toggle)).toBe(true);
    act(() => reg.dispose());
    expect(screen.queryByTestId('module-toggle')).toBeNull();
  });

  it('renders nothing extra while no module registers an item', () => {
    render(<BibleToolbar />);
    expect(screen.queryByTestId('keywords-toggle')).toBeNull();
  });
});

describe('BibleToolbar — chapter arrows at the Bible boundaries (B-002)', () => {
  it('disables Next at Revelation 22 and Prev at Genesis 1', () => {
    h.ctx.value = makeCtx({ currentBook: 66, currentChapter: 22 });
    const { unmount } = render(<BibleToolbar />);
    expect(screen.getByTestId('next-chapter')).toBeDisabled();
    expect(screen.getByTestId('prev-chapter')).not.toBeDisabled();
    unmount();
    h.ctx.value = makeCtx({ currentBook: 1, currentChapter: 1 });
    render(<BibleToolbar />);
    expect(screen.getByTestId('prev-chapter')).toBeDisabled();
    expect(screen.getByTestId('next-chapter')).not.toBeDisabled();
  });
});

describe('BibleToolbar — current reference', () => {
  it('shows book and chapter and opens the picker', () => {
    const setShowBookPicker = vi.fn();
    h.ctx.value = makeCtx({ setShowBookPicker });
    render(<BibleToolbar />);

    const btn = screen.getByTestId('toolbar-reference');
    expect(btn).toHaveTextContent('John 3');
    fireEvent.click(btn);
    expect(setShowBookPicker).toHaveBeenCalledWith(true);
  });
});
