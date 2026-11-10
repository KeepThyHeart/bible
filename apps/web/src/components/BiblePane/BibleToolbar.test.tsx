/**
 * Component tests for BibleToolbar.
 *
 * Pattern: Store-connected component with modal dialog.
 * bibleStore, moduleStore, and moduleDescriptions are mocked so tests
 * control exactly what the toolbar sees. useStore is mocked to call the
 * selector immediately (no subscription).
 */
// The toolbar now pulls in @bible/ui (through the keyword button), which loads preact/compat. Loading
// compat first keeps its patched event handling in place from the first render, as in the real app.
import 'preact/compat';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import type { BibleTab } from '../../stores/bibleStore';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// ---- Module descriptions -------------------------------------------------
vi.mock('../../moduleDescriptions', () => {
  const descriptions: Record<string, { tagline?: string; description: string }> = {
    KJV: { tagline: 'King James Version', description: 'The classic English Bible' },
    NIV: { tagline: 'New International Version', description: 'A modern translation' },
  };
  return {
    RECOMMENDED_BIBLES: ['KJV', 'NIV'],
    getBibleDescription: (abbr: string) => descriptions[abbr],
  };
});

// ---- Store state ---------------------------------------------------------
function makeTab(overrides: Partial<BibleTab> = {}): BibleTab {
  return {
    id: 'tab-1',
    moduleAbbr: 'KJV',
    moduleName: 'King James Version',
    book: 43,
    chapter: 3,
    studyVerse: null,
    previewVerse: null,
    previewVerseEnd: null,
    selectionEndVerse: null,
    verses: [],
    loading: false,
    scrollPosition: 0,
    pendingScrollVerse: null,
    pendingScrollTop: null,
    hasInterlinearData: false,
    displayMode: 'standard',
    history: [],
    historyIndex: -1,
    showBackBar: false,
    ...overrides,
  };
}

let mockActiveTab: BibleTab | undefined = makeTab();
let mockBibleModules: { abbreviation: string; name: string; type: string }[] = [
  { abbreviation: 'KJV', name: 'King James Version', type: 'bible' },
  { abbreviation: 'NIV', name: 'New International Version', type: 'bible' },
];
let mockCanGoBack = false;
let mockHistory: Array<{ moduleAbbr: string; book: number; chapter: number; verse?: number }> = [];
let mockHistoryIndex = -1;
const mockGoToHistoryEntry = vi.fn();

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

const mockSetTabTranslation = vi.fn();
const mockGoBack = vi.fn();
const mockSetDisplayMode = vi.fn();
const mockScrollToVerse = vi.fn();
const mockNavigateTo = vi.fn();

vi.mock('../../stores/bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => mockActiveTab,
    canGoBack: () => mockCanGoBack,
    getHistory: () => mockHistory,
    getHistoryIndex: () => mockHistoryIndex,
    goToHistoryEntry: (i: number) => mockGoToHistoryEntry(i),
    setTabTranslation: (id: string, abbr: string) => mockSetTabTranslation(id, abbr),
    goBack: () => mockGoBack(),
    setDisplayMode: (id: string, mode: string) => mockSetDisplayMode(id, mode),
    scrollToVerse: (id: number) => mockScrollToVerse(id),
    // Options are forwarded: the chapter buttons must mark their move as a
    // sequential page (replace) rather than a jump.
    navigateTo: (book: number, ch: number, verse?: number, options?: unknown) =>
      mockNavigateTo(book, ch, verse, options),
  },
}));

const mockGetBibleModules = vi.fn(() => mockBibleModules);
const mockGetBookByNumber = vi.fn((n: number) => ({ book_number: n, book_name: 'John', chapter_count: 21 }));
const mockGetBibleSections = vi.fn(() => null);
// Parameters spelled out because the mock is called with them below; an
// argument-less implementation narrows the mock to zero arity.
const mockGetModuleDescription = vi.fn((_type: string, _abbr: string) => null);

vi.mock('../../stores/moduleStore', () => ({
  moduleStore: {
    getBibleModules: () => mockGetBibleModules(),
    getBookByNumber: (n: number) => mockGetBookByNumber(n),
    getBookName: (n: number) => `Book ${n}`,
    getBibleSections: () => mockGetBibleSections(),
    getModuleDescription: (type: string, abbr: string) => mockGetModuleDescription(type, abbr),
  },
}));

import { readerToolbarItems } from '../../host/slots';

// The text-size popover has its own tests; here it only has to be present and wired.
vi.mock('../common/TextSizeButton', async () => {
  const { h } = await import('preact');
  return {
    TextSizeButton: ({ target, className, onMoreOptions }: { target: string; className?: string; onMoreOptions?: () => void }) =>
      h('button', { class: className, 'data-testid': `text-size-btn-${target}`, onClick: () => onMoreOptions?.() }, 'size'),
  };
});

import { BibleToolbar } from './BibleToolbar';

/** The prev/next chapter pair, isolated from the history group's buttons. */
function chapterNavButtons(container: Element): HTMLButtonElement[] {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('.bible-toolbar__chapter-nav .bible-toolbar__nav-btn')
  );
}

describe('BibleToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = makeTab();
    mockBibleModules = [
      { abbreviation: 'KJV', name: 'King James Version', type: 'bible' },
      { abbreviation: 'NIV', name: 'New International Version', type: 'bible' },
    ];
    mockCanGoBack = false;
    mockGetBibleModules.mockReturnValue(mockBibleModules);
    mockGetBookByNumber.mockImplementation((n: number) => ({
      book_number: n, book_name: 'John', chapter_count: 21,
    }));
    mockGetBibleSections.mockReturnValue(null);
    mockGetModuleDescription.mockReturnValue(null);
  });

  // ------------------------------------------------------------------
  // Basic rendering
  // ------------------------------------------------------------------
  it('renders nothing when there is no active tab', () => {
    mockActiveTab = undefined;
    const { container } = render(<BibleToolbar />);
    expect(container.querySelector('.bible-toolbar')).toBeNull();
  });

  it('renders the toolbar container when a tab is active', () => {
    const { container } = render(<BibleToolbar />);
    expect(container.querySelector('.bible-toolbar')).toBeTruthy();
  });

  it('renders the current translation abbreviation', () => {
    render(<BibleToolbar />);
    expect(screen.getByText('KJV', { exact: false })).toBeTruthy();
  });

  it('renders the display mode select with the current value', () => {
    const { container } = render(<BibleToolbar />);
    const select = container.querySelector<HTMLSelectElement>('.bible-toolbar__mode-select');
    expect(select).toBeTruthy();
    expect(select!.value).toBe('standard');
  });

  it('renders a module toolbar item (readerToolbarItems slot) first in the right group', () => {
    const handle = readerToolbarItems.register(() => <button data-testid="fixture-toolbar-item">x</button>);
    const { container, unmount } = render(<BibleToolbar />);
    try {
      const item = screen.getByTestId('fixture-toolbar-item');
      const right = container.querySelector('.bible-toolbar__right')!;
      expect(right.firstElementChild).toBe(item);
    } finally {
      unmount(); // before dispose, so no re-render of a finished test runs into the next one
      handle.dispose();
    }
  });

  it('renders no module item while none is registered', () => {
    render(<BibleToolbar />);
    expect(screen.queryByTestId('fixture-toolbar-item')).toBeNull();
  });

  it('renders the text-size button', () => {
    render(<BibleToolbar />);
    expect(screen.getByTestId('text-size-btn-bible')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // History navigation buttons
  // ------------------------------------------------------------------
  it('back button is disabled when canGoBack is false', () => {
    mockCanGoBack = false;
    const { container } = render(<BibleToolbar />);
    const navBtns = container.querySelectorAll<HTMLButtonElement>('.bible-toolbar__nav-btn');
    // First nav section: [back, recent-passages menu]
    expect(navBtns[0].disabled).toBe(true);
  });

  it('back button is enabled when canGoBack is true', () => {
    mockCanGoBack = true;
    const { container } = render(<BibleToolbar />);
    const navBtns = container.querySelectorAll<HTMLButtonElement>('.bible-toolbar__nav-btn');
    expect(navBtns[0].disabled).toBe(false);
  });

  it('calls goBack when the back button is clicked', () => {
    mockCanGoBack = true;
    const { container } = render(<BibleToolbar />);
    const navBtns = container.querySelectorAll<HTMLButtonElement>('.bible-toolbar__nav-btn');
    fireEvent.click(navBtns[0]);
    expect(mockGoBack).toHaveBeenCalled();
  });

  // There is no forward button: Back plus the Recent Passages menu covers it,
  // and the menu names its destination. The button that follows Back in the
  // history group is the menu toggle.
  it('renders no forward button — the history group is back + recent passages', () => {
    const { container } = render(<BibleToolbar />);
    const navBtns = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.bible-toolbar__nav .bible-toolbar__nav-btn')
    ).filter(b => !b.closest('.bible-toolbar__chapter-nav'));
    expect(navBtns).toHaveLength(2);
    expect(navBtns[1].getAttribute('data-testid')).toBe('history-dropdown-toggle');
  });

  // ------------------------------------------------------------------
  // Chapter navigation buttons (far right)
  // ------------------------------------------------------------------
  it('prev-chapter button is disabled at Genesis 1', () => {
    mockActiveTab = makeTab({ book: 1, chapter: 1 });
    mockGetBookByNumber.mockReturnValue({ book_number: 1, book_name: 'Genesis', chapter_count: 50 });
    const { container } = render(<BibleToolbar />);
    // Scoped to the chapter-nav group rather than indexed off the flat button
    // list: the history group's own button count is not this test's business.
    expect(chapterNavButtons(container)[0].disabled).toBe(true);
  });

  it('next-chapter button is disabled at Revelation 22', () => {
    mockActiveTab = makeTab({ book: 66, chapter: 22 });
    mockGetBookByNumber.mockReturnValue({ book_number: 66, book_name: 'Revelation', chapter_count: 22 });
    const { container } = render(<BibleToolbar />);
    expect(chapterNavButtons(container)[1].disabled).toBe(true);
  });

  it('prev-chapter button calls navigateTo with prev chapter', () => {
    mockActiveTab = makeTab({ book: 43, chapter: 5 });
    mockGetBookByNumber.mockReturnValue({ book_number: 43, book_name: 'John', chapter_count: 21 });
    const { container } = render(<BibleToolbar />);
    fireEvent.click(chapterNavButtons(container)[0]);
    expect(mockNavigateTo).toHaveBeenCalledWith(43, 4, undefined, { replace: true });
  });

  it('next-chapter button calls navigateTo with next chapter', () => {
    mockActiveTab = makeTab({ book: 43, chapter: 3 });
    mockGetBookByNumber.mockReturnValue({ book_number: 43, book_name: 'John', chapter_count: 21 });
    const { container } = render(<BibleToolbar />);
    fireEvent.click(chapterNavButtons(container)[1]);
    expect(mockNavigateTo).toHaveBeenCalledWith(43, 4, undefined, { replace: true });
  });

  // The class of bug: paging through chapters used to leave one history entry
  // per chapter, filling "Recent Passages" with a reading trail. Both chapter
  // buttons must mark the move as a sequential step, at the call site.
  it('marks both chapter steps as sequential (replace), including across a book boundary', () => {
    mockActiveTab = makeTab({ book: 43, chapter: 21 });
    mockGetBookByNumber.mockImplementation((n: number) => ({
      book_number: n, book_name: 'John', chapter_count: 21,
    }));
    const { container } = render(<BibleToolbar />);
    fireEvent.click(chapterNavButtons(container)[1]);
    expect(mockNavigateTo).toHaveBeenCalledWith(44, 1, undefined, { replace: true });
  });

  // ------------------------------------------------------------------
  // Display mode select
  // ------------------------------------------------------------------
  it('calls setDisplayMode when the display mode select changes', () => {
    const { container } = render(<BibleToolbar />);
    const select = container.querySelector<HTMLSelectElement>('.bible-toolbar__mode-select')!;
    fireEvent.change(select, { target: { value: 'reading' } });
    expect(mockSetDisplayMode).toHaveBeenCalledWith('tab-1', 'reading');
  });

  it('scrolls the selected verse back into view after a mode switch (W-056)', () => {
    mockActiveTab = makeTab({ studyVerse: 43003016 });
    const { container } = render(<BibleToolbar />);
    fireEvent.change(container.querySelector<HTMLSelectElement>('.bible-toolbar__mode-select')!, { target: { value: 'study' } });
    expect(mockScrollToVerse).toHaveBeenCalledWith(43003016);
  });

  // ------------------------------------------------------------------
  // Translation dialog
  // ------------------------------------------------------------------
  it('translation dialog is not shown initially', () => {
    const { container } = render(<BibleToolbar />);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('names the translation button for assistive tech, not just by its abbreviation', () => {
    const { container } = render(<BibleToolbar />);
    const btn = container.querySelector('.bible-toolbar__translation-btn')!;
    expect(btn.getAttribute('aria-label')).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe('bibleToolbar.translationButton');
    expect(btn.textContent).toContain('KJV');
  });

  it('opens the translation dialog when the translation button is clicked', () => {
    const { container } = render(<BibleToolbar />);
    fireEvent.click(container.querySelector('.bible-toolbar__translation-btn')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeTruthy();
  });

  it('lists available Bible modules in the dialog', () => {
    const { container } = render(<BibleToolbar />);
    fireEvent.click(container.querySelector('.bible-toolbar__translation-btn')!);
    const cards = container.querySelectorAll('.module-card');
    expect(cards.length).toBeGreaterThan(0);
    expect(screen.getAllByText('KJV').length).toBeGreaterThan(0);
  });

  it('closes the dialog when the close button is clicked', () => {
    const { container } = render(<BibleToolbar />);
    fireEvent.click(container.querySelector('.bible-toolbar__translation-btn')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeTruthy();
    fireEvent.click(container.querySelector('.module-dialog__close')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('closes the dialog when the overlay backdrop is clicked', () => {
    const { container } = render(<BibleToolbar />);
    fireEvent.click(container.querySelector('.bible-toolbar__translation-btn')!);
    fireEvent.click(container.querySelector('.module-dialog-overlay')!);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('calls setTabTranslation when a module card is clicked', () => {
    const { container } = render(<BibleToolbar />);
    fireEvent.click(container.querySelector('.bible-toolbar__translation-btn')!);
    const cards = container.querySelectorAll<HTMLElement>('.module-card');
    // Click the first available module card
    fireEvent.click(cards[0]);
    expect(mockSetTabTranslation).toHaveBeenCalledWith('tab-1', expect.any(String));
  });

  it('closes the dialog after selecting a translation', () => {
    const { container } = render(<BibleToolbar />);
    fireEvent.click(container.querySelector('.bible-toolbar__translation-btn')!);
    const cards = container.querySelectorAll<HTMLElement>('.module-card');
    fireEvent.click(cards[0]);
    expect(container.querySelector('.module-dialog-overlay')).toBeNull();
  });

  it('shows no-modules message when module list is empty', () => {
    mockGetBibleModules.mockReturnValue([]);
    const { container } = render(<BibleToolbar />);
    fireEvent.click(container.querySelector('.bible-toolbar__translation-btn')!);
    expect(container.querySelector('.module-dialog__empty')).toBeTruthy();
  });

  it('shows no-matches message when filter has no results', () => {
    const { container } = render(<BibleToolbar />);
    fireEvent.click(container.querySelector('.bible-toolbar__translation-btn')!);
    const filterInput = container.querySelector<HTMLInputElement>('input[type="text"]')!;
    fireEvent.input(filterInput, { target: { value: 'ZZZNOMATCH' } });
    expect(container.querySelector('.module-dialog__empty')).toBeTruthy();
  });

  it('marks the currently active translation with the on check icon', () => {
    const { container } = render(<BibleToolbar />);
    fireEvent.click(container.querySelector('.bible-toolbar__translation-btn')!);
    expect(container.querySelector('.module-card__check--on')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Settings button
  // ------------------------------------------------------------------
  it('opens Settings at "bible-font" from the text-size popover\'s more-options link', () => {
    const onOpenSettings = vi.fn();
    render(<BibleToolbar onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByTestId('text-size-btn-bible'));
    expect(onOpenSettings).toHaveBeenCalledWith('bible-font');
  });

  it('does not throw when the text-size button is clicked and onOpenSettings is not provided', () => {
    render(<BibleToolbar />);
    expect(() => fireEvent.click(screen.getByTestId('text-size-btn-bible'))).not.toThrow();
  });

  // B-156: Escape closes the Recent passages menu and returns focus to its button.
  it('Escape closes the history menu and focuses its toggle', () => {
    const { container } = render(<BibleToolbar />);
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="history-dropdown-toggle"]')!;
    fireEvent.click(toggle);
    expect(container.querySelector('.bible-toolbar__history-menu')).toBeTruthy();
    document.body.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.bible-toolbar__history-menu')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('choosing a Recent passages item returns focus to the menu button', () => {
    mockHistory = [{ moduleAbbr: 'KJV', book: 43, chapter: 3 }, { moduleAbbr: 'KJV', book: 1, chapter: 1 }];
    mockHistoryIndex = 1;
    const { container } = render(<BibleToolbar />);
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="history-dropdown-toggle"]')!;
    fireEvent.click(toggle);
    const item = container.querySelector<HTMLElement>('[role="menuitem"]')!;
    item.focus();
    fireEvent.click(item);
    expect(container.querySelector('.bible-toolbar__history-menu')).toBeNull();
    expect(document.activeElement).toBe(toggle);
    mockHistory = [];
    mockHistoryIndex = -1;
  });

  // 0209 W6: Recent passages is a keyboard menu.
  describe('Recent passages keyboard', () => {
    const twoEntries = () => {
      mockHistory = [{ moduleAbbr: 'KJV', book: 43, chapter: 3 }, { moduleAbbr: 'KJV', book: 1, chapter: 1 }];
      mockHistoryIndex = 1;
    };
    const reset = () => { mockHistory = []; mockHistoryIndex = -1; };

    it('ArrowDown on the button opens the menu and focuses the current entry; arrows move', async () => {
      twoEntries();
      const { container } = render(<BibleToolbar />);
      const toggle = container.querySelector<HTMLButtonElement>('[data-testid="history-dropdown-toggle"]')!;
      toggle.focus();
      fireEvent.keyDown(toggle, { key: 'ArrowDown' });
      await waitFor(() => expect(container.querySelector('.bible-toolbar__history-menu')).toBeTruthy());
      const items = Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      expect(items).toHaveLength(2);
      // Newest first; the current entry (index 1) is the first row.
      await waitFor(() => expect(document.activeElement).toBe(items[0]));
      fireEvent.keyDown(items[0], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items[1]);
      fireEvent.keyDown(items[1], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items[0]);
      reset();
    });

    it('Escape from an item closes the menu and focuses the button', async () => {
      twoEntries();
      const { container } = render(<BibleToolbar />);
      const toggle = container.querySelector<HTMLButtonElement>('[data-testid="history-dropdown-toggle"]')!;
      fireEvent.keyDown(toggle, { key: 'Enter' });
      const first = await waitFor(() => {
        const el = container.querySelector<HTMLElement>('[role="menuitem"]');
        expect(el).toBeTruthy();
        return el!;
      });
      await waitFor(() => expect(document.activeElement).toBe(first));
      fireEvent.keyDown(first, { key: 'Escape' });
      expect(container.querySelector('.bible-toolbar__history-menu')).toBeNull();
      expect(document.activeElement).toBe(toggle);
      reset();
    });

    it('Tab closes the menu', async () => {
      twoEntries();
      const { container } = render(<BibleToolbar />);
      const toggle = container.querySelector<HTMLButtonElement>('[data-testid="history-dropdown-toggle"]')!;
      fireEvent.keyDown(toggle, { key: 'ArrowDown' });
      const first = await waitFor(() => {
        const el = container.querySelector<HTMLElement>('[role="menuitem"]');
        expect(el).toBeTruthy();
        return el!;
      });
      fireEvent.keyDown(first, { key: 'Tab' });
      expect(container.querySelector('.bible-toolbar__history-menu')).toBeNull();
      reset();
    });
  });
});
