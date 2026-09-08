import React, { createContext, useContext } from 'react';
import { DisplayMode } from '../stores/useBibleStore';
import { BibleVerse as BibleVerseCopy } from '../services/verseCopyService';
import { HighlightColor, MarkupType, UnderlineStyle } from '@bible/core';
import { IPCHighlightRepository } from '../services/highlightsAPI';
import { StudyPaneTab } from '../stores/useDictionaryStore';

// -- Shared types used across BiblePane sub-components ------------------

export interface BibleTabInfo {
  tabId: string;
  abbreviation: string;
  name: string;
  book: number;
  bookName: string;
  chapter: number;
  moduleId?: number;
  selectedVerseId?: number | null;
  displayMode: string;
}

export interface AvailableBible {
  abbreviation: string;
  name: string;
  language_code?: string;
  version?: string;
}

export interface WordSelection {
  startVerseId: number;
  startWordIndex: number;
  endVerseId?: number;
  endWordIndex?: number;
}

export interface FloatingToolbarState {
  visible: boolean;
  selection: WordSelection | null;
  hasExistingMarkup: boolean;
}

export interface HighlightMenuState {
  visible: boolean;
  position: { x: number; y: number };
  selection: WordSelection | null;
}

export interface ContextMenuState {
  visible: boolean;
  verses: BibleVerseCopy[];
  position: { x: number; y: number };
  isMultiple: boolean;
  markupId?: number;
}

export interface CopyOptionsDialogState {
  visible: boolean;
  verses: BibleVerseCopy[];
}

export interface NoteTooltipState {
  visible: boolean;
  verseId: number;
  position: { x: number; y: number };
}

// -- Context value -----------------------------------------------------

export interface BiblePaneContextValue {
  // Identity
  panelId: string;
  isDetached: boolean;
  contentKey?: string;
  dockviewPanelApi?: any;

  // Panel state (from useBiblePanel)
  availableBibles: AvailableBible[];
  loadingBibles: boolean;
  initialLoadComplete: boolean;
  openTabs: BibleTabInfo[];
  activeTabIndex: number;
  activeTab: BibleTabInfo | undefined;
  isParallelViewMode: boolean;
  currentBook: number;
  currentChapter: number;
  currentBookName: string;
  selectedVerseId: number | null;
  /**
   * Far end of a shift-click passage selection, or null. `selectedVerseId`
   * remains the anchor; see `stores/bible/internals/verseRange.ts`.
   */
  selectionEndVerseId: number | null;
  /**
   * A verse being looked at rather than chosen - see
   * `stores/bible/slices/previewSlice.ts`. Marked differently from a real
   * selection, and no pane follows it.
   */
  previewVerseId: number | null;
  /** Far end of a previewed passage, e.g. a cross-reference to Rom 8:28-30. */
  previewVerseEndId: number | null;
  currentVerses: any[];
  isLoading: boolean;
  error: string | null;
  displayMode: DisplayMode;
  scrollTrigger: number;
  scrollMode: 'center' | 'nearest';

  // Panel actions
  loadInitialData: () => void;
  openBible: (abbreviation: string, name: string) => void;
  closeBible: (tabId: string) => void;
  setDisplayMode: (tabId: string, mode: DisplayMode) => void;
  toggleParallelView: () => void;
  changeTabVersion: (tabId: string, abbreviation: string, name: string) => void;
  /** Open a different passage as its own top-level panel. */
  openPassageInNewPanel: (book: number, chapter: number, verse?: number) => Promise<string | null>;
  loadChapter: (book: number, chapter: number) => void;
  setSelectedVerse: (verseId: number) => void;
  canGoBack: () => boolean;
  goBack: () => void;
  getHistory: () => any[];
  navigateToHistoryEntry: (index: number) => void;
  saveScrollPosition: (scrollTop: number) => void;

  // Refs
  bibleTextRef: React.RefObject<HTMLDivElement | null>;
  selectedVerseRef: React.RefObject<HTMLDivElement | null>;

  // Highlight state & actions
  highlightRepository: IPCHighlightRepository;
  highlightMenu: HighlightMenuState;
  setHighlightMenu: React.Dispatch<React.SetStateAction<HighlightMenuState>>;
  handleSelectHighlight: (
    color: HighlightColor,
    markupType: MarkupType,
    underlineStyle?: UnderlineStyle,
    underlineColor?: HighlightColor
  ) => Promise<void>;
  handleCancelHighlightMenu: () => void;
  handleRemoveHighlight: (markupId: number) => Promise<void>;
  handleShowHighlightMenu: (
    position: { x: number; y: number },
    selection: WordSelection
  ) => void;

  // Floating toolbar
  floatingToolbar: FloatingToolbarState;
  handleFloatingHighlight: (color: HighlightColor) => Promise<void>;
  handleFloatingUnderline: () => Promise<void>;
  handleFloatingRemoveFormatting: () => Promise<void>;
  dismissFloatingToolbar: () => void;
  showFloatingToolbar: () => void;
  buildSelectionFromDOM: () => (WordSelection & { hasExistingMarkup: boolean }) | null;

  // Context menu
  contextMenu: ContextMenuState | null;
  setContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;

  // Copy options dialog
  copyOptionsDialog: CopyOptionsDialogState | null;
  setCopyOptionsDialog: React.Dispatch<React.SetStateAction<CopyOptionsDialogState | null>>;

  // Note tooltip
  noteTooltip: NoteTooltipState;
  setNoteTooltip: React.Dispatch<React.SetStateAction<NoteTooltipState>>;
  handleNoteTooltipClose: () => void;
  handleNoteTooltipEnter: () => void;

  // Navigation
  handlePreviousChapter: () => void;
  handleNextChapter: () => void;
  goBackWithScroll: () => void;
  navigateToHistoryEntryWithScroll: (index: number) => void;

  // Verse interaction
  /** `extend` is the shift key: widen the passage instead of re-anchoring. */
  handleVerseClick: (verseId: number, extend?: boolean) => void;
  handleStrongsClick: (strongsNumber: string) => Promise<void>;
  handleVerseContextMenu: (event: React.MouseEvent, verse: any) => void;
  handleNoteIndicatorClick: (e: React.MouseEvent, verseId: number) => Promise<void>;
  handleNoteIndicatorHover: (e: React.MouseEvent, verseId: number) => void;
  handleNoteIndicatorLeave: () => void;

  // Notes
  versesWithNotes: Set<number>;

  // Overlay toggles
  showSelector: boolean;
  setShowSelector: React.Dispatch<React.SetStateAction<boolean>>;
  showHistoryDropdown: boolean;
  setShowHistoryDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  showBookPicker: boolean;
  setShowBookPicker: React.Dispatch<React.SetStateAction<boolean>>;
  versionSelectorTabId: string | null;
  setVersionSelectorTabId: React.Dispatch<React.SetStateAction<string | null>>;
  showParallelPicker: boolean;
  setShowParallelPicker: React.Dispatch<React.SetStateAction<boolean>>;
  parallelSelections: string[];
  setParallelSelections: React.Dispatch<React.SetStateAction<string[]>>;

  // Cross-pane sync
  syncAllNotesPanelsWithVerse: (verseId: number) => void;
  setStudyPaneActiveTab: (tab: StudyPaneTab) => void;

  // Mouse handlers for content area
  handleMouseUpWithToolbar: () => void;
  handleSetDisplayMode: (mode: DisplayMode) => void;

  // Pane detach
  handleDetachPane: () => Promise<void>;
}

const BiblePaneContext = createContext<BiblePaneContextValue | null>(null);

export const BiblePaneProvider = BiblePaneContext.Provider;

export function useBiblePaneContext(): BiblePaneContextValue {
  const ctx = useContext(BiblePaneContext);
  if (!ctx) {
    throw new Error('useBiblePaneContext must be used within a BiblePaneProvider');
  }
  return ctx;
}

export default BiblePaneContext;
