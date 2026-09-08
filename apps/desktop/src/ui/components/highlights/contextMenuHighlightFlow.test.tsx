/**
 * The right-click path to a highlight, end to end in jsdom.
 *
 * floatingAnnotationFlow.test.tsx covers drag-select -> floating toolbar. This
 * covers the other way in:
 *
 *   drag-select two words
 *     -> right-click a verse row (useVerseInteractionHandlers)
 *     -> VerseContextMenu opens
 *     -> click "Highlight/Underline..." (BiblePaneOverlays.onOpenHighlightMenu)
 *     -> HighlightMenu opens -> click a colour swatch
 *     -> useHighlightStore.createHighlight -> repository.create
 *
 * The bug it pins down: re-reading window.getSelection() at the moment the
 * menu item is clicked would break this. A mousedown on the way there can
 * collapse the selection, and a collapsed selection would be silently
 * treated as "nothing selected" - so choosing Highlight after selecting
 * three words would highlight the WHOLE VERSE. The selection is snapshotted
 * when the context menu opens, so the collapse is harmless.
 */
import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UserTextMarkup } from '@bible/core';

/** What the renderer handed to the repository. */
const sent: UserTextMarkup[] = [];

vi.mock('../../services/highlightsAPI', () => ({
  IPCHighlightRepository: class {
    async getForVerseRange(): Promise<UserTextMarkup[]> { return []; }
    async getForModule(): Promise<UserTextMarkup[]> { return []; }
    async create(markup: UserTextMarkup): Promise<UserTextMarkup> {
      sent.push(markup);
      return new UserTextMarkup({ ...markup, markupId: sent.length });
    }
    async delete(): Promise<void> {}
  },
}));

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

// Panes/dialogs BiblePaneOverlays pulls in that have nothing to do with highlighting.
vi.mock('../BibleHeader', () => ({ default: () => <div data-testid="bible-header" /> }));
vi.mock('../study/StudyModeView', () => ({ default: () => <div data-testid="study-mode-view" /> }));
vi.mock('../ParallelBibleView', () => ({ default: () => <div data-testid="parallel-view" /> }));
vi.mock('../SearchResultsPane', () => ({ default: () => <div data-testid="search-results" /> }));
vi.mock('../CopyOptionsDialog', () => ({ default: () => <div data-testid="copy-options" /> }));
vi.mock('../ModuleSelector', () => ({ default: () => <div data-testid="module-selector" /> }));
vi.mock('../BookChapterPicker', () => ({ default: () => <div data-testid="book-chapter-picker" /> }));
vi.mock('../NotePreviewTooltip', () => ({ default: () => <div data-testid="note-preview" /> }));

import BibleVerseList from '../BibleVerseList';
import BiblePaneOverlays from '../BiblePaneOverlays';
import { BiblePaneProvider, BiblePaneContextValue, ContextMenuState } from '../BiblePaneContext';
import { useBibleHighlights } from '../../hooks/useBibleHighlights';
import { useHighlightStore } from '../../stores/useHighlightStore';
import { captureWordSelection, takeCapturedWordSelection } from './capturedSelection';
import { enString, enT } from '../../testing/enCatalog';

const MODULE_ID = 1;
const PSALM_3_1 = 19003001;

const ACTIVE_TAB = {
  tabId: 'tab-1',
  abbreviation: 'KJV',
  name: 'King James Version',
  book: 19,
  bookName: 'Psalms',
  chapter: 3,
  moduleId: MODULE_ID,
  displayMode: 'standard' as const,
};

const VERSE_TEXT = 'Lord how are they increased that trouble me';
const VERSES = [
  {
    verse_id: PSALM_3_1,
    book_number: 19,
    chapter: 3,
    verse: 1,
    text: VERSE_TEXT,
    text_html: VERSE_TEXT,
    is_paragraph_start: true,
  },
];
const WORD_COUNT = VERSE_TEXT.split(' ').length;

function inertContext(): BiblePaneContextValue {
  return {
    panelId: 'panel-1',
    isDetached: false,
    availableBibles: [{ abbreviation: 'KJV', name: 'King James Version' }],
    loadingBibles: false,
    initialLoadComplete: true,
    openTabs: [ACTIVE_TAB],
    activeTab: ACTIVE_TAB,
    activeTabIndex: 0,
    isParallelViewMode: false,
    currentBook: 19,
    currentChapter: 3,
    currentBookName: 'Psalms',
    selectedVerseId: null,
    currentVerses: VERSES,
    isLoading: false,
    error: null,
    displayMode: 'standard',
    scrollTrigger: 0,
    scrollMode: 'nearest',
    versesWithNotes: new Set<number>(),
    copyOptionsDialog: null,
    setCopyOptionsDialog: vi.fn(),
    noteTooltip: { visible: false, verseId: 0, position: { x: 0, y: 0 } },
    setNoteTooltip: vi.fn(),
    handleNoteTooltipClose: vi.fn(),
    handleNoteTooltipEnter: vi.fn(),
    handleVerseClick: vi.fn(),
    handleStrongsClick: vi.fn(),
    handleNoteIndicatorClick: vi.fn(),
    handleNoteIndicatorHover: vi.fn(),
    handleNoteIndicatorLeave: vi.fn(),
    handleMouseUpWithToolbar: vi.fn(),
    showSelector: false,
    setShowSelector: vi.fn(),
    showBookPicker: false,
    setShowBookPicker: vi.fn(),
    versionSelectorTabId: null,
    setVersionSelectorTabId: vi.fn(),
    showParallelPicker: false,
    setShowParallelPicker: vi.fn(),
    parallelSelections: [],
    setParallelSelections: vi.fn(),
    openBible: vi.fn(),
    changeTabVersion: vi.fn(),
    toggleParallelView: vi.fn(),
    syncAllNotesPanelsWithVerse: vi.fn(),
    setSelectedVerse: vi.fn(),
    setStudyPaneActiveTab: vi.fn(),
  } as unknown as BiblePaneContextValue;
}

/**
 * Wires the real verse list, the real highlight hook and the real overlays
 * together the way BiblePane does.
 *
 * `handleVerseContextMenu` mirrors useVerseInteractionHandlers: snapshot the
 * selection, then open the menu. (The real hook is not used directly here only
 * because it drags in five unrelated cross-pane sync stores.)
 */
const Harness: React.FC = () => {
  const bibleTextRef = useRef<HTMLDivElement | null>(null);
  const selectedVerseRef = useRef<HTMLDivElement | null>(null);
  const highlights = useBibleHighlights(ACTIVE_TAB, 19, 3, VERSES, bibleTextRef);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleVerseContextMenu = (event: React.MouseEvent, verse: unknown) => {
    event.preventDefault();
    event.stopPropagation();
    highlights.dismissFloatingToolbar();

    const target = event.target as HTMLElement;
    captureWordSelection(target.closest('.pane-content-bible') ?? document);

    setContextMenu({
      visible: true,
      verses: [verse],
      position: { x: 10, y: 10 },
      isMultiple: false,
    } as ContextMenuState);
  };

  const ctx = {
    ...inertContext(),
    bibleTextRef,
    selectedVerseRef,
    contextMenu,
    setContextMenu,
    handleVerseContextMenu,
    highlightRepository: highlights.highlightRepository,
    highlightMenu: highlights.highlightMenu,
    setHighlightMenu: highlights.setHighlightMenu,
    handleSelectHighlight: highlights.handleSelectHighlight,
    handleCancelHighlightMenu: highlights.handleCancelHighlightMenu,
    handleRemoveHighlight: highlights.handleRemoveHighlight,
    handleShowHighlightMenu: highlights.handleShowHighlightMenu,
    floatingToolbar: highlights.floatingToolbar,
    handleFloatingHighlight: highlights.handleFloatingHighlight,
    handleFloatingUnderline: highlights.handleFloatingUnderline,
    handleFloatingRemoveFormatting: highlights.handleFloatingRemoveFormatting,
    dismissFloatingToolbar: highlights.dismissFloatingToolbar,
  } as unknown as BiblePaneContextValue;

  return (
    <BiblePaneProvider value={ctx}>
      <BibleVerseList />
      <BiblePaneOverlays
        showBookPicker={false}
        setShowBookPicker={vi.fn()}
        currentBook={19}
        currentChapter={3}
        currentBookName="Psalms"
        panelId="panel-1"
        showSelector={false}
        setShowSelector={vi.fn()}
        versionSelectorTabId={null}
        setVersionSelectorTabId={vi.fn()}
        availableBibles={[{ abbreviation: 'KJV', name: 'King James Version' }]}
        loadingBibles={false}
        openTabs={[ACTIVE_TAB]}
        openBible={vi.fn()}
        changeTabVersion={vi.fn()}
        showParallelPicker={false}
        setShowParallelPicker={vi.fn()}
        parallelSelections={[]}
        setParallelSelections={vi.fn()}
        isParallelViewMode={false}
        toggleParallelView={vi.fn()}
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        activeTab={ACTIVE_TAB}
        handleRemoveHighlight={highlights.handleRemoveHighlight}
        syncAllNotesPanelsWithVerse={vi.fn()}
        setSelectedVerse={vi.fn()}
        setStudyPaneActiveTab={vi.fn()}
        copyOptionsDialog={null}
        setCopyOptionsDialog={vi.fn()}
        highlightMenu={highlights.highlightMenu}
        setHighlightMenu={highlights.setHighlightMenu}
        handleSelectHighlight={highlights.handleSelectHighlight}
        handleCancelHighlightMenu={highlights.handleCancelHighlightMenu}
        floatingToolbar={highlights.floatingToolbar}
        handleFloatingHighlight={highlights.handleFloatingHighlight}
        handleFloatingUnderline={highlights.handleFloatingUnderline}
        handleFloatingRemoveFormatting={highlights.handleFloatingRemoveFormatting}
        dismissFloatingToolbar={highlights.dismissFloatingToolbar}
        noteTooltip={{ visible: false, verseId: 0, position: { x: 0, y: 0 } }}
        setNoteTooltip={vi.fn()}
        handleNoteTooltipClose={vi.fn()}
        handleNoteTooltipEnter={vi.fn()}
      />
    </BiblePaneProvider>
  );
};

/** Select words [0..n-1] of the rendered verse. */
function selectWords(count: number): void {
  const words = document.querySelectorAll<HTMLElement>('.word');
  expect(words.length).toBeGreaterThanOrEqual(count);

  const range = document.createRange();
  range.setStart(words[0].firstChild!, 0);
  range.setEnd(words[count - 1].firstChild!, words[count - 1].textContent!.length);

  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

const ZERO_RECT = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect;
if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  Range.prototype.getClientRects = () => ([] as unknown as DOMRectList);
}

describe('right-click -> Highlight/Underline', () => {
  beforeEach(() => {
    sent.length = 0;
    useHighlightStore.setState({ highlightsByModule: new Map(), lastUsedColor: 'yellow' });
    takeCapturedWordSelection(); // clear any leftover snapshot
    (global as unknown as { ResizeObserver: unknown }).ResizeObserver =
      (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
  });

  /**
   * The regression. Selecting two words and highlighting via the context menu
   * must produce a two-word markup even though the selection is collapsed by
   * the time the menu item is clicked.
   */
  it('highlights only the selected words, not the whole verse, when the selection collapses', async () => {
    render(<Harness />);

    selectWords(2);

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('verse-1'));
    });

    // Exactly what a mousedown on the menu item does in the browser.
    await act(async () => {
      window.getSelection()!.removeAllRanges();
    });
    expect(window.getSelection()!.isCollapsed).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText(enString('ui.verseContextMenu.highlightUnderline')));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Highlight in Yellow'));
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].verseIdStart).toBe(PSALM_3_1);
    expect(sent[0].textStart).toBe(0);
    // The whole point: word index 1, not "to the end of the verse".
    expect(sent[0].textEnd).toBe(1);
    expect(sent[0].textEnd).not.toBe(WORD_COUNT - 1);
    expect(sent[0].textEnd).not.toBeUndefined();
  });

  /** The markup must actually paint the selected words and only those. */
  it('renders the highlight on exactly the selected words', async () => {
    render(<Harness />);

    selectWords(3);

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('verse-1'));
    });
    await act(async () => {
      window.getSelection()!.removeAllRanges();
    });
    await act(async () => {
      fireEvent.click(screen.getByText(enString('ui.verseContextMenu.highlightUnderline')));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Highlight in Yellow'));
    });

    const words = document.querySelectorAll<HTMLElement>('.word');
    expect(words[0].className).toContain('highlight-yellow');
    expect(words[1].className).toContain('highlight-yellow');
    expect(words[2].className).toContain('highlight-yellow');
    expect(words[3].className).not.toContain('highlight-');
    expect(words[WORD_COUNT - 1].className).not.toContain('highlight-');
  });

  /**
   * With nothing selected, right-click -> Highlight still means "highlight this
   * verse". That fallback must survive the fix.
   */
  it('still highlights the whole verse when nothing is selected', async () => {
    render(<Harness />);

    window.getSelection()!.removeAllRanges();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId('verse-1'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText(enString('ui.verseContextMenu.highlightUnderline')));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Highlight in Yellow'));
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].verseIdStart).toBe(PSALM_3_1);
    expect(sent[0].textStart).toBe(0);
    // Open-ended: to the end of the verse.
    expect(sent[0].textEnd).toBeUndefined();
  });
});
