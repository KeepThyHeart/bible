import React from 'react';
import { DisplayMode } from '../../../stores/useBibleStore';
import {
  BiblePaneContextValue,
} from '../../BiblePaneContext';

/**
 * Assembles the BiblePaneContextValue from all of the smaller hook outputs
 * and panel state. Wrapped in a single useMemo so the consumed sub-components
 * (BibleToolbar / BibleVerseList / BiblePaneOverlays) only re-render when
 * their actual inputs change.
 *
 * This is purely a packaging hook - no behavior, no extra state.
 */
export function useBiblePaneContextValue(args: {
  // Identity
  panelId: string;
  isDetached: boolean;
  contentKey: string | undefined;
  dockviewPanelApi: any;

  // Panel state from useBiblePanel
  panel: any;
  activeTab: any;
  currentVerses: any[];
  isLoading: boolean;
  error: string | null;
  displayMode: string;

  // Refs
  bibleTextRef: React.RefObject<HTMLDivElement | null>;
  selectedVerseRef: React.RefObject<HTMLDivElement | null>;

  // Hook outputs
  highlights: any;
  bookPicker: any;
  modulePicker: any;
  parallelPicker: any;
  historyDropdown: any;
  verseContextMenu: any;
  copyDialog: any;
  noteTooltipHook: any;

  // Verse interaction
  handleVerseClick: (verseId: number, extend?: boolean) => void;
  handleStrongsClick: (s: string) => Promise<void>;
  handleVerseContextMenu: (e: React.MouseEvent, v: any) => void;
  handleNoteIndicatorClick: (e: React.MouseEvent, verseId: number) => Promise<void>;
  syncAllNotesPanelsWithVerse: (verseId: number) => void;
  setStudyPaneActiveTab: any;

  // Pane actions
  handleDetachPane: () => Promise<void>;

  // Navigation
  handlePreviousChapter: () => void;
  handleNextChapter: () => void;
  goBackWithScroll: () => void;
  navigateToHistoryEntryWithScroll: (i: number) => void;

  // Mouse / display
  handleMouseUpWithToolbar: () => void;
  handleSetDisplayMode: (m: DisplayMode) => void;

  // Notes
  versesWithNotes: Set<number>;
}): BiblePaneContextValue {
  const {
    panelId, isDetached, contentKey, dockviewPanelApi,
    panel, activeTab, currentVerses, isLoading, error, displayMode,
    bibleTextRef, selectedVerseRef,
    highlights, bookPicker, modulePicker, parallelPicker, historyDropdown,
    verseContextMenu, copyDialog, noteTooltipHook,
    handleVerseClick, handleStrongsClick, handleVerseContextMenu,
    handleNoteIndicatorClick, syncAllNotesPanelsWithVerse, setStudyPaneActiveTab,
    handleDetachPane,
    handlePreviousChapter, handleNextChapter,
    goBackWithScroll, navigateToHistoryEntryWithScroll,
    handleMouseUpWithToolbar, handleSetDisplayMode,
    versesWithNotes,
  } = args;

  return React.useMemo(() => ({
    panelId, isDetached, contentKey, dockviewPanelApi,

    availableBibles: panel.availableBibles,
    loadingBibles: panel.loadingBibles,
    initialLoadComplete: panel.initialLoadComplete,
    openTabs: panel.openTabs,
    activeTabIndex: panel.activeTabIndex,
    activeTab,
    isParallelViewMode: panel.isParallelViewMode,
    currentBook: panel.currentBook,
    currentChapter: panel.currentChapter,
    currentBookName: panel.currentBookName,
    selectedVerseId: panel.selectedVerseId,
    selectionEndVerseId: panel.selectionEndVerseId,
    previewVerseId: panel.previewVerseId,
    previewVerseEndId: panel.previewVerseEndId,
    currentVerses, isLoading, error,
    displayMode: displayMode as DisplayMode,
    scrollTrigger: panel.scrollTrigger,
    scrollMode: panel.scrollMode,

    loadInitialData: panel.loadInitialData,
    openBible: panel.openBible,
    closeBible: panel.closeBible,
    setDisplayMode: panel.setDisplayMode,
    toggleParallelView: panel.toggleParallelView,
    changeTabVersion: panel.changeTabVersion,
    openPassageInNewPanel: panel.openPassageInNewPanel,
    loadChapter: panel.loadChapter,
    setSelectedVerse: panel.setSelectedVerse,
    // The Back control is the visit stack, not the history cursor: it undoes
    // the last view change (paged chapters and history-menu jumps included),
    // while the dropdown stays the curated jump list. See internals/visitStack.ts.
    canGoBack: panel.canGoBackVisit,
    goBack: panel.goBackVisit,
    getHistory: panel.getHistory,
    navigateToHistoryEntry: panel.navigateToHistoryEntry,
    saveScrollPosition: panel.saveScrollPosition,

    bibleTextRef, selectedVerseRef,

    // Highlights
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

    // Verse context menu
    contextMenu: verseContextMenu.contextMenu,
    setContextMenu: verseContextMenu.setContextMenu,

    // Copy dialog
    copyOptionsDialog: copyDialog.copyOptionsDialog,
    setCopyOptionsDialog: copyDialog.setCopyOptionsDialog,

    // Note tooltip
    noteTooltip: noteTooltipHook.noteTooltip,
    setNoteTooltip: noteTooltipHook.setNoteTooltip,
    handleNoteTooltipClose: noteTooltipHook.handleNoteTooltipClose,
    handleNoteTooltipEnter: noteTooltipHook.handleNoteTooltipEnter,

    // Navigation
    handlePreviousChapter, handleNextChapter,
    goBackWithScroll, navigateToHistoryEntryWithScroll,

    // Verse interaction
    handleVerseClick, handleStrongsClick, handleVerseContextMenu,
    handleNoteIndicatorClick,
    handleNoteIndicatorHover: noteTooltipHook.handleNoteIndicatorHover,
    handleNoteIndicatorLeave: noteTooltipHook.handleNoteIndicatorLeave,

    // Notes
    versesWithNotes,

    // Overlay toggles
    showSelector: modulePicker.showSelector,
    setShowSelector: modulePicker.setShowSelector,
    showHistoryDropdown: historyDropdown.showHistoryDropdown,
    setShowHistoryDropdown: historyDropdown.setShowHistoryDropdown,
    showBookPicker: bookPicker.showBookPicker,
    setShowBookPicker: bookPicker.setShowBookPicker,
    versionSelectorTabId: modulePicker.versionSelectorTabId,
    setVersionSelectorTabId: modulePicker.setVersionSelectorTabId,
    showParallelPicker: parallelPicker.showParallelPicker,
    setShowParallelPicker: parallelPicker.setShowParallelPicker,
    parallelSelections: parallelPicker.parallelSelections,
    setParallelSelections: parallelPicker.setParallelSelections,

    // Cross-pane sync
    syncAllNotesPanelsWithVerse,
    setStudyPaneActiveTab,

    // Mouse handlers
    handleMouseUpWithToolbar,
    handleSetDisplayMode,

    // Pane detach
    handleDetachPane,
  }), [
    panelId, isDetached, contentKey, dockviewPanelApi,
    panel, activeTab, currentVerses, isLoading, error, displayMode,
    bibleTextRef, selectedVerseRef,
    highlights,
    bookPicker.showBookPicker,
    modulePicker.showSelector, modulePicker.versionSelectorTabId,
    parallelPicker.showParallelPicker, parallelPicker.parallelSelections,
    historyDropdown.showHistoryDropdown,
    verseContextMenu.contextMenu, copyDialog.copyOptionsDialog,
    noteTooltipHook.noteTooltip,
    noteTooltipHook.handleNoteTooltipClose, noteTooltipHook.handleNoteTooltipEnter,
    noteTooltipHook.handleNoteIndicatorHover, noteTooltipHook.handleNoteIndicatorLeave,
    handleVerseClick, handleStrongsClick, handleVerseContextMenu,
    handleNoteIndicatorClick,
    handleDetachPane,
    handlePreviousChapter, handleNextChapter,
    goBackWithScroll, navigateToHistoryEntryWithScroll,
    handleMouseUpWithToolbar, handleSetDisplayMode,
    syncAllNotesPanelsWithVerse, setStudyPaneActiveTab,
    versesWithNotes,
  ]);
}
