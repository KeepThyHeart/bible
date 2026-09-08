/**
 * Verse-rendering behavior in Standard and Reading display modes:
 *  - verse.verse === 0 (a chapter preface/superscription stored as a literal
 *    verse 0 in legacy v1-style data) gets no verse-number affordance and
 *    italic/secondary "preface" styling instead of rendering as an ordinary
 *    numbered verse.
 *  - verse.formatting.sectionHeading (Module Format v2's real-world carrier
 *    for Psalm superscriptions and section headings, attached to the verse
 *    that follows) renders as a heading block.
 *  - Standard and Reading modes: clicking the verse TEXT selects the verse
 *    (matching the web app). The drag-select constraint is enforced by ignoring
 *    a click that ends a non-collapsed text selection, so highlighting a phrase
 *    still works.
 *  - Standard mode: the verse number is accent-colored, not neutral gray.
 *  - Standard/Study modes: the flex row is `items-start`, so the verse number
 *    sits on the verse's first line instead of centering against a tall verse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import BibleVerseList from './BibleVerseList';
import { BiblePaneProvider, BiblePaneContextValue } from './BiblePaneContext';
import { useSessionStore } from '../stores/useSessionStore';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));

vi.mock('./BibleHeader', () => ({ default: () => <div data-testid="bible-header" /> }));
// The click guard lives in `utils/selectionUtils`, not here, so a plain
// default-only mock is safe again.
vi.mock('./study/StudyModeView', () => ({ default: () => <div data-testid="study-mode-view" /> }));
vi.mock('./ParallelBibleView', () => ({ default: () => <div data-testid="parallel-view" /> }));
vi.mock('./SearchResultsPane', () => ({ default: () => <div data-testid="search-results" /> }));

const handleVerseClick = vi.fn();
const handleVerseContextMenu = vi.fn();

const KJV_ABBR = 'KJV';

function makeVerse(overrides: Record<string, unknown> = {}) {
  return {
    verse_id: 19003001,
    book_number: 19,
    chapter: 3,
    verse: 1,
    text: 'Lord, how are they increased that trouble me!',
    text_html: 'Lord, how are they increased that trouble me!',
    is_paragraph_start: true,
    ...overrides,
  };
}

function makeContext(overrides: Partial<BiblePaneContextValue> = {}): BiblePaneContextValue {
  const activeTab = {
    tabId: 'tab-1',
    abbreviation: KJV_ABBR,
    name: 'King James Version',
    book: 19,
    bookName: 'Psalms',
    chapter: 3,
    moduleId: 1,
    displayMode: 'standard',
  };
  return {
    panelId: 'panel-1',
    isDetached: false,
    availableBibles: [{ abbreviation: KJV_ABBR, name: 'King James Version' }],
    loadingBibles: false,
    initialLoadComplete: true,
    openTabs: [activeTab],
    activeTab,
    activeTabIndex: 0,
    isParallelViewMode: false,
    currentBook: 19,
    currentChapter: 3,
    currentBookName: 'Psalms',
    selectedVerseId: null,
    currentVerses: [makeVerse()],
    isLoading: false,
    error: null,
    displayMode: 'standard',
    scrollTrigger: 0,
    scrollMode: 'nearest',
    loadInitialData: vi.fn(),
    openBible: vi.fn(),
    closeBible: vi.fn(),
    setDisplayMode: vi.fn(),
    toggleParallelView: vi.fn(),
    changeTabVersion: vi.fn(),
    openPassageInNewPanel: vi.fn(),
    loadChapter: vi.fn(),
    setSelectedVerse: vi.fn(),
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: vi.fn(),
    goForward: vi.fn(),
    getHistory: () => [],
    navigateToHistoryEntry: vi.fn(),
    saveScrollPosition: vi.fn(),
    bibleTextRef: { current: null },
    selectedVerseRef: { current: null },
    highlightRepository: {} as BiblePaneContextValue['highlightRepository'],
    highlightMenu: { visible: false, position: { x: 0, y: 0 }, selection: null },
    setHighlightMenu: vi.fn(),
    handleSelectHighlight: vi.fn(),
    handleCancelHighlightMenu: vi.fn(),
    handleRemoveHighlight: vi.fn(),
    handleShowHighlightMenu: vi.fn(),
    floatingToolbar: { visible: false, selection: null, hasExistingMarkup: false },
    handleFloatingHighlight: vi.fn(),
    handleFloatingUnderline: vi.fn(),
    handleFloatingRemoveFormatting: vi.fn(),
    dismissFloatingToolbar: vi.fn(),
    showFloatingToolbar: vi.fn(),
    buildSelectionFromDOM: vi.fn(),
    contextMenu: null,
    setContextMenu: vi.fn(),
    copyOptionsDialog: null,
    setCopyOptionsDialog: vi.fn(),
    noteTooltip: { visible: false, verseId: 0, position: { x: 0, y: 0 } },
    setNoteTooltip: vi.fn(),
    handleNoteTooltipClose: vi.fn(),
    handleNoteTooltipEnter: vi.fn(),
    handlePreviousChapter: vi.fn(),
    handleNextChapter: vi.fn(),
    goBackWithScroll: vi.fn(),
    goForwardWithScroll: vi.fn(),
    navigateToHistoryEntryWithScroll: vi.fn(),
    handleVerseClick,
    handleStrongsClick: vi.fn(),
    handleVerseContextMenu,
    handleNoteIndicatorClick: vi.fn(),
    handleNoteIndicatorHover: vi.fn(),
    handleNoteIndicatorLeave: vi.fn(),
    versesWithNotes: new Set<number>(),
    showSelector: false,
    setShowSelector: vi.fn(),
    showHistoryDropdown: false,
    setShowHistoryDropdown: vi.fn(),
    showBookPicker: false,
    setShowBookPicker: vi.fn(),
    versionSelectorTabId: null,
    setVersionSelectorTabId: vi.fn(),
    showParallelPicker: false,
    setShowParallelPicker: vi.fn(),
    parallelSelections: [],
    setParallelSelections: vi.fn(),
    syncAllNotesPanelsWithVerse: vi.fn(),
    setStudyPaneActiveTab: vi.fn(),
    handleMouseUpWithToolbar: vi.fn(),
    handleSetDisplayMode: vi.fn(),
    handleDetachPane: vi.fn(),
    ...overrides,
  } as BiblePaneContextValue;
}

function renderWithContext(overrides: Partial<BiblePaneContextValue> = {}) {
  const ctx = makeContext(overrides);
  return render(
    <BiblePaneProvider value={ctx}>
      <BibleVerseList />
    </BiblePaneProvider>,
  );
}

describe('BibleVerseList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // react-resizable-panels measures its container; jsdom has no ResizeObserver.
    (global as unknown as { ResizeObserver: unknown }).ResizeObserver =
      (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    // Most tests below exercise pane behavior with an active tab already
    // open, where isSessionLoaded is irrelevant. Default it to "loaded" so
    // the dedicated restore-gating tests are the only ones that need to
    // think about it.
    useSessionStore.setState({ isSessionLoaded: true });
  });

  describe('Standard mode', () => {
    it('clicking the verse text selects the verse', () => {
      renderWithContext({ displayMode: 'standard' });

      // The verse row, away from the verse-number button: the text is a click
      // target here, so selecting a verse does not mean aiming at the number.
      screen.getByTestId('verse-1').click();

      expect(handleVerseClick).toHaveBeenCalledWith(19003001, false);
    });

    it('does NOT select the verse on the click that ends a drag-selection', () => {
      // The reason the row body was click-free before: a drag across the text
      // for a highlight ends with a click on the row, and selecting the verse
      // from it tore down the selection the highlight toolbar was about to use.
      const original = window.getSelection;
      window.getSelection = () =>
        ({ isCollapsed: false, toString: () => 'how are they increased' }) as unknown as Selection;
      try {
        renderWithContext({ displayMode: 'standard' });
        screen.getByTestId('verse-1').click();
        expect(handleVerseClick).not.toHaveBeenCalled();
      } finally {
        window.getSelection = original;
      }
    });

    it('clicking the verse-number button selects the verse (also the keyboard path)', () => {
      renderWithContext({ displayMode: 'standard' });

      const button = screen.getByRole('button', { name: /Select/i });
      button.click();

      expect(handleVerseClick).toHaveBeenCalledWith(19003001, false);
    });

    it('top-aligns the verse number against a multi-line verse', () => {
      renderWithContext({ displayMode: 'standard' });

      // jsdom cannot measure layout, so pin the class: without it the flex
      // default `stretch` centers the number in a tall row.
      expect(screen.getByTestId('verse-1').className).toContain('items-start');
    });

    it('does not nest an interactive element inside another: the row itself carries no button/role', () => {
      renderWithContext({ displayMode: 'standard' });

      const row = screen.getByTestId('verse-1');
      expect(row.tagName).toBe('DIV');
      expect(row.getAttribute('role')).toBeNull();
      expect(row.tabIndex).toBe(-1); // jsdom default for a non-focusable div is -1
    });

    it('gives the verse number accent-colored, bold styling instead of neutral gray', () => {
      renderWithContext({ displayMode: 'standard' });

      const button = screen.getByRole('button', { name: /Select/i });
      const numberEl = button.querySelector('bdi')!;
      expect(numberEl.className).toContain('text-accent');
      expect(numberEl.className).toContain('font-bold');
      expect(numberEl.className).not.toContain('text-text-secondary');
    });

    it('verse 0 (chapter preface) renders with no verse-number button and preface styling', () => {
      renderWithContext({
        displayMode: 'standard',
        currentVerses: [makeVerse({ verse: 0, verse_id: 19003000, text: 'A Psalm of David.' })],
      });

      // No numbered "Select ..." button for the preface row.
      expect(screen.queryByRole('button', { name: /Select/i })).not.toBeInTheDocument();

      const row = screen.getByTestId('verse-0');
      expect(row.className).toContain('italic');
      expect(row.className).toContain('text-text-secondary');
    });

    it('renders formatting.sectionHeading (Module Format v2 Psalm superscription) as a heading block above the verse', () => {
      renderWithContext({
        displayMode: 'standard',
        currentVerses: [makeVerse({
          formatting: { sectionHeading: 'A Psalm of David, when he fled from Absalom his son.' },
        })],
      });

      expect(screen.getByText('A Psalm of David, when he fled from Absalom his son.')).toBeInTheDocument();
      // The verse itself is still verse 1 - a real, numbered verse - since the
      // heading rides on it rather than replacing it.
      expect(screen.getByRole('button', { name: /Select/i })).toBeInTheDocument();
    });

    it('a verse with no section heading and no preface renders neither', () => {
      renderWithContext({ displayMode: 'standard', currentVerses: [makeVerse()] });

      expect(screen.getByRole('button', { name: /Select/i })).toBeInTheDocument();
      const row = screen.getByTestId('verse-1');
      expect(row.className).not.toContain('italic');
    });
  });

  describe('Reading mode', () => {
    it('verse 0 gets italic/secondary preface styling inline', () => {
      renderWithContext({
        displayMode: 'reading',
        currentVerses: [makeVerse({ verse: 0, verse_id: 19003000, text: 'A Psalm of David.' })],
      });

      const span = screen.getByTestId('verse-0');
      expect(span.className).toContain('italic');
      expect(span.className).toContain('text-text-secondary');
    });

    it('renders formatting.sectionHeading above the paragraph', () => {
      renderWithContext({
        displayMode: 'reading',
        currentVerses: [makeVerse({
          formatting: { sectionHeading: 'A Psalm of David, when he fled from Absalom his son.' },
        })],
      });

      expect(screen.getByText('A Psalm of David, when he fled from Absalom his son.')).toBeInTheDocument();
    });

    it('clicking a verse span still selects the verse', () => {
      renderWithContext({ displayMode: 'reading' });

      const span = screen.getByTestId('verse-1');
      span.click();

      expect(handleVerseClick).toHaveBeenCalledWith(19003001, false);
    });
  });

  // ---------------------------------------------------------------------
  // Shift-click passage selection. The store owns the anchor/end model
  // (verseSlice.rangeSelection.test.ts); what has to hold HERE is that the
  // shift key survives the trip from the DOM event to `handleVerseClick`,
  // that the drag-select guard does not swallow it, and that the swept
  // verses render with the washed-out `.verse-in-range` fill while the
  // anchor keeps `.verse-selected`.
  // ---------------------------------------------------------------------
  describe('shift-click range selection', () => {
    const VERSES = [
      makeVerse({ verse_id: 19003001, verse: 1, text: 'Verse one', text_html: 'Verse one' }),
      makeVerse({ verse_id: 19003002, verse: 2, text: 'Verse two', text_html: 'Verse two' }),
      makeVerse({ verse_id: 19003003, verse: 3, text: 'Verse three', text_html: 'Verse three' }),
      makeVerse({ verse_id: 19003004, verse: 4, text: 'Verse four', text_html: 'Verse four' }),
    ];

    it('Standard mode: passes the shift key through to handleVerseClick', () => {
      renderWithContext({ displayMode: 'standard', currentVerses: VERSES });

      fireEvent.click(screen.getByTestId('verse-3'), { shiftKey: true });

      expect(handleVerseClick).toHaveBeenCalledWith(19003003, true);
    });

    it('Standard mode: a shift-click is NOT swallowed by the drag-selection guard', () => {
      // A selection left over from an earlier drag must not make shift-click
      // silently do nothing - the shift-click's own mousedown is
      // preventDefault-ed, so it never creates one of its own.
      const original = window.getSelection;
      window.getSelection = () =>
        ({ isCollapsed: false, toString: () => 'leftover' }) as unknown as Selection;
      try {
        renderWithContext({ displayMode: 'standard', currentVerses: VERSES });
        fireEvent.click(screen.getByTestId('verse-3'), { shiftKey: true });
        expect(handleVerseClick).toHaveBeenCalledWith(19003003, true);
      } finally {
        window.getSelection = original;
      }
    });

    it('Standard mode: shift+mousedown is prevented, so no native text selection is swept', () => {
      renderWithContext({ displayMode: 'standard', currentVerses: VERSES });

      const shifted = fireEvent.mouseDown(screen.getByTestId('verse-3'), { shiftKey: true });
      // fireEvent returns false when a handler called preventDefault().
      expect(shifted).toBe(false);

      // A plain mousedown is left completely alone, so dragging out a phrase
      // for a highlight still works.
      const plain = fireEvent.mouseDown(screen.getByTestId('verse-3'));
      expect(plain).toBe(true);
    });

    it('Standard mode: swept verses get .verse-in-range, the anchor keeps .verse-selected', () => {
      renderWithContext({
        displayMode: 'standard',
        currentVerses: VERSES,
        selectedVerseId: 19003002,
        selectionEndVerseId: 19003004,
      });

      expect(screen.getByTestId('verse-2').className).toContain('verse-selected');
      expect(screen.getByTestId('verse-2').className).not.toContain('verse-in-range');
      expect(screen.getByTestId('verse-3').className).toContain('verse-in-range');
      expect(screen.getByTestId('verse-4').className).toContain('verse-in-range');
      // Outside the range.
      expect(screen.getByTestId('verse-1').className).not.toContain('verse-in-range');
    });

    it('Standard mode: an UPWARD range washes the verses above the anchor', () => {
      // The end sits numerically below the anchor here; without the ordered
      // range nothing would be marked at all.
      renderWithContext({
        displayMode: 'standard',
        currentVerses: VERSES,
        selectedVerseId: 19003004,
        selectionEndVerseId: 19003002,
      });

      expect(screen.getByTestId('verse-2').className).toContain('verse-in-range');
      expect(screen.getByTestId('verse-3').className).toContain('verse-in-range');
      expect(screen.getByTestId('verse-4').className).toContain('verse-selected');
      expect(screen.getByTestId('verse-4').className).not.toContain('verse-in-range');
    });

    it('Standard mode: no range means no verse is washed', () => {
      renderWithContext({
        displayMode: 'standard',
        currentVerses: VERSES,
        selectedVerseId: 19003002,
        selectionEndVerseId: null,
      });

      for (const n of [1, 2, 3, 4]) {
        expect(screen.getByTestId(`verse-${n}`).className).not.toContain('verse-in-range');
      }
    });

    it('Reading mode: the shift key and the in-range class work the same way', () => {
      renderWithContext({
        displayMode: 'reading',
        currentVerses: VERSES,
        selectedVerseId: 19003002,
        selectionEndVerseId: 19003004,
      });

      fireEvent.click(screen.getByTestId('verse-3'), { shiftKey: true });
      expect(handleVerseClick).toHaveBeenCalledWith(19003003, true);

      expect(screen.getByTestId('verse-2').className).toContain('verse-selected');
      expect(screen.getByTestId('verse-3').className).toContain('verse-in-range');
      expect(screen.getByTestId('verse-4').className).toContain('verse-in-range');
      expect(screen.getByTestId('verse-1').className).not.toContain('verse-in-range');
    });
  });

  // ---------------------------------------------------------------------
  // 5.2 - startup empty-state flash: an empty `openTabs` during session
  // restore must show a neutral skeleton, not the alarming "no translation
  // open" empty state.
  // ---------------------------------------------------------------------
  describe('startup restore gating (5.2)', () => {
    it('shows a neutral loading skeleton, not the empty state, while session restore is in progress', () => {
      useSessionStore.setState({ isSessionLoaded: false });
      renderWithContext({ openTabs: [], activeTab: undefined });

      expect(screen.getByTestId('bible-loading-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('biblePane.noTranslationOpen')).not.toBeInTheDocument();
    });

    it('shows the real empty state once restore has resolved with genuinely zero tabs', () => {
      useSessionStore.setState({ isSessionLoaded: true });
      renderWithContext({ openTabs: [], activeTab: undefined });

      expect(screen.queryByTestId('bible-loading-skeleton')).not.toBeInTheDocument();
      expect(screen.getByText('biblePane.noTranslationOpen')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------
  // A tab already published (openTabs.length > 0, e.g. session restore's
  // synchronous publish, or a brand-new tab whose chapter fetch hasn't
  // resolved) but whose content hasn't loaded yet must not be indistinguishable
  // from "genuinely empty", or it flashes "no verses loaded". loadingByTab is
  // seeded true at the same moment openTabs is published, so isLoading reads
  // true here and this must show the shared skeleton instead.
  // ---------------------------------------------------------------------
  describe('first-load skeleton (a tab is open, but nothing has loaded yet)', () => {
    // BibleVerseList runs ctx.isLoading through useDeferredLoading (80ms
    // debounce) before using it, so these two need to wait past that window -
    // same as CommentaryContentArea's equivalent tests.
    it('shows the loading skeleton, not "no verses loaded", on the very first load for the tab', async () => {
      renderWithContext({ isLoading: true, currentVerses: [] });

      await act(async () => {
        await new Promise(r => setTimeout(r, 100));
      });

      expect(screen.getByTestId('bible-loading-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('biblePane.noVersesLoaded')).not.toBeInTheDocument();
    });

    it('keeps the ordinary loading indicator (not the skeleton) once the tab has loaded content before', async () => {
      renderWithContext({ isLoading: true, currentVerses: [makeVerse()] });

      await act(async () => {
        await new Promise(r => setTimeout(r, 100));
      });

      expect(screen.queryByTestId('bible-loading-skeleton')).not.toBeInTheDocument();
      expect(screen.getByText('biblePane.loadingBibleText')).toBeInTheDocument();
    });

    it('shows the genuine "no verses loaded" state once loading has finished with nothing to show', () => {
      renderWithContext({ isLoading: false, currentVerses: [] });

      expect(screen.queryByTestId('bible-loading-skeleton')).not.toBeInTheDocument();
      expect(screen.getByText('biblePane.noVersesLoaded')).toBeInTheDocument();
    });
  });
});
