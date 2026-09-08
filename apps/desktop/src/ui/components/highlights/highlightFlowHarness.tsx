/**
 * Shared jsdom harness for the highlight flow tests.
 *
 * Wires the real `useBibleHighlights` / `useBibleSelection` hooks to the real
 * `BibleVerseList` and `FloatingAnnotationToolbar`, the way BiblePane and
 * BiblePaneOverlays do in the app. Only the repository is fake, standing in for
 * the IPC round trip to the main process - each test file supplies its own via
 * `vi.mock('../../services/highlightsAPI')`, which applies to this module too.
 *
 * Not a test file: the name deliberately avoids `*.test.tsx` so vitest does not
 * collect it.
 */
import React, { useRef } from 'react';
import { expect, vi } from 'vitest';
import { fireEvent, screen, act } from '@testing-library/react';

import BibleVerseList from '../BibleVerseList';
import { BiblePaneProvider, BiblePaneContextValue } from '../BiblePaneContext';
import { FloatingAnnotationToolbar } from './FloatingAnnotationToolbar';
import { HighlightMenu } from './HighlightMenu';
import { useBibleHighlights } from '../../hooks/useBibleHighlights';
import { useBibleSelection } from '../../hooks/useBibleSelection';

export const MODULE_ID = 1;
export const PSALM_3_1 = 19003001;

export const ACTIVE_TAB = {
  tabId: 'tab-1',
  abbreviation: 'KJV',
  name: 'King James Version',
  book: 19,
  bookName: 'Psalms',
  chapter: 3,
  moduleId: MODULE_ID,
  displayMode: 'standard' as const,
};

export const VERSES = [
  {
    verse_id: PSALM_3_1,
    book_number: 19,
    chapter: 3,
    verse: 1,
    text: 'Lord how are they increased that trouble me',
    text_html: 'Lord how are they increased that trouble me',
    is_paragraph_start: true,
  },
];

/**
 * Everything BibleVerseList needs that is not part of the highlight chain.
 * The highlight/selection members are overwritten by the live hook output.
 */
export function inertContext(): BiblePaneContextValue {
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
    handleVerseClick: vi.fn(),
    handleStrongsClick: vi.fn(),
    handleVerseContextMenu: vi.fn(),
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
    handleSetDisplayMode: vi.fn(),
    handleDetachPane: vi.fn(),
  } as unknown as BiblePaneContextValue;
}

interface HarnessProps {
  /** Overrides the tab, e.g. to drop moduleId and exercise the guards. */
  activeTab?: typeof ACTIVE_TAB | (Omit<typeof ACTIVE_TAB, 'moduleId'> & { moduleId?: number });
}

/**
 * Wires the real highlight/selection hooks to the real verse list and floating
 * toolbar, the way BiblePane + BiblePaneOverlays do in the app.
 */
export const Harness: React.FC<HarnessProps> = ({ activeTab = ACTIVE_TAB }) => {
  const bibleTextRef = useRef<HTMLDivElement | null>(null);
  const selectedVerseRef = useRef<HTMLDivElement | null>(null);
  const highlights = useBibleHighlights(activeTab as typeof ACTIVE_TAB, 19, 3, VERSES, bibleTextRef);
  const { handleMouseUpWithToolbar } = useBibleSelection(highlights.showFloatingToolbar);

  const ctx = {
    ...inertContext(),
    activeTab,
    openTabs: [activeTab],
    bibleTextRef,
    selectedVerseRef,
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
    showFloatingToolbar: highlights.showFloatingToolbar,
    buildSelectionFromDOM: highlights.buildSelectionFromDOM,
    handleMouseUpWithToolbar,
  } as unknown as BiblePaneContextValue;

  return (
    <BiblePaneProvider value={ctx}>
      <BibleVerseList />
      {highlights.floatingToolbar.visible && highlights.floatingToolbar.selection && (
        <FloatingAnnotationToolbar
          selection={highlights.floatingToolbar.selection}
          hasExistingMarkup={highlights.floatingToolbar.hasExistingMarkup}
          onHighlight={highlights.handleFloatingHighlight}
          onUnderline={highlights.handleFloatingUnderline}
          onRemoveFormatting={highlights.handleFloatingRemoveFormatting}
          onDismiss={highlights.dismissFloatingToolbar}
          onMore={(position) => {
            // Same handoff BiblePaneOverlays performs: close the toolbar, open
            // the full menu on the selection the toolbar was offering.
            const selection = highlights.floatingToolbar.selection;
            highlights.dismissFloatingToolbar();
            if (selection) highlights.setHighlightMenu({ visible: true, position, selection });
          }}
          onApplyStyle={(style) => {
            void highlights.handleSelectHighlight(
              style.color,
              style.markupType,
              style.underlineStyle,
              style.underlineColor,
            );
          }}
        />
      )}
      {/* The escalation target for the toolbar's "More..." button. */}
      {highlights.highlightMenu.visible && (
        <HighlightMenu
          position={highlights.highlightMenu.position}
          onSelectHighlight={highlights.handleSelectHighlight}
          onCancel={highlights.handleCancelHighlightMenu}
        />
      )}
    </BiblePaneProvider>
  );
};

/**
 * Perform the gesture: drag-select words `[from, to]` and end the drag with a
 * mouseup on the Bible text container. `clickRow` replays the extra `click` the
 * browser fires at the drag's common ancestor when a drag starts and ends
 * inside the same verse row - the event Standard mode's click handler treats
 * as verse selection.
 *
 * Requires fake timers: the toolbar appears 50ms after mouseup.
 */
export async function selectWords(from: number, to: number, clickRow: boolean): Promise<void> {
  const words = document.querySelectorAll<HTMLElement>('.word');
  expect(words.length).toBeGreaterThan(to);

  const range = document.createRange();
  range.setStart(words[from].firstChild!, 0);
  range.setEnd(words[to].firstChild!, words[to].textContent!.length);

  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);

  const container = document.querySelector('.pane-content-bible')!;
  await act(async () => {
    fireEvent.mouseUp(container);
    if (clickRow) fireEvent.click(screen.getByTestId('verse-1'));
    // 0ms: expandSelectionToWordBoundaries. 50ms: showFloatingToolbar.
    vi.advanceTimersByTime(100);
  });
}

/** The original gesture, kept for the tests written against it. */
export const selectFirstTwoWords = (clickRow: boolean): Promise<void> => selectWords(0, 1, clickRow);

/**
 * jsdom implements Range but not its layout methods, so the toolbar's
 * positioning code (Chromium-only in production) would throw. This is a jsdom
 * gap, not product behaviour - stub it rather than weaken the component.
 */
export function installRangeLayoutStubs(): void {
  const ZERO_RECT = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect;
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = () => ZERO_RECT;
    Range.prototype.getClientRects = () => ([] as unknown as DOMRectList);
  }
}

/** jsdom has no ResizeObserver; BibleVerseList's children expect one. */
export function installResizeObserverStub(): void {
  const g = global as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver = g.ResizeObserver ?? class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
