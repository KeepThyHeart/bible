import React, { useEffect, useRef } from 'react';
import { useBibleStore, DEFAULT_DISPLAY_MODE, DisplayMode } from '../stores/useBibleStore';
import { useBiblePanel } from '../stores/hooks/useBiblePanel';
import { DEFAULT_PANEL_ID } from '../stores/helpers/panelStateHelpers';
import BiblePaneOverlays from './BiblePaneOverlays';
import { BiblePaneProvider } from './BiblePaneContext';

// Sub-components
import BibleToolbar from './BibleToolbar';
import PreviewBackBar from './bible/PreviewBackBar';
import BibleVerseList from './BibleVerseList';

// Cross-cutting hooks (live in src/ui/hooks)
import { useBibleScrolling } from '../hooks/useBibleScrolling';
import { useBibleHighlights } from '../hooks/useBibleHighlights';
import { useBibleSelection } from '../hooks/useBibleSelection';
import { useBibleKeyboard, useBibleFind } from '../hooks/useBibleKeyboard';

// BiblePane-specific hooks (one concern each)
import { useBookPickerOverlay } from './bible/hooks/useBookPickerOverlay';
import { useModulePickerOverlay } from './bible/hooks/useModulePickerOverlay';
import { useParallelPickerOverlay } from './bible/hooks/useParallelPickerOverlay';
import { useHistoryDropdown } from './bible/hooks/useHistoryDropdown';
import { useVerseContextMenu } from './bible/hooks/useVerseContextMenu';
import { useCopyDialog } from './bible/hooks/useCopyDialog';
import { useNoteTooltip } from './bible/hooks/useNoteTooltip';
import { useVersesWithNotes } from './bible/hooks/useVersesWithNotes';
import { useContentKeyInit } from './bible/hooks/useContentKeyInit';
import { useSessionPanelRestore } from './bible/hooks/useSessionPanelRestore';
import { useDetachedInit } from './bible/hooks/useDetachedInit';
import { useDockviewTitleSync } from './bible/hooks/useDockviewTitleSync';
import { useInitialDataLoader } from './bible/hooks/useInitialDataLoader';
import { useBibleNavigation } from './bible/hooks/useBibleNavigation';
import { useBibleTabActions } from './bible/hooks/useBibleTabActions';
import { useVerseInteractionHandlers } from './bible/hooks/useVerseInteractionHandlers';
import { useBiblePaneContextValue } from './bible/hooks/useBiblePaneContextValue';

interface BiblePaneProps {
  panelId?: string;
  /** Encoded passage to auto-open: "abbreviation|bookNumber|chapter|verseId|displayMode" */
  contentKey?: string;
  dockviewPanelApi?: any;
  isDetached?: boolean;
  windowId?: string;

  // -- Detached-window handover ----------------------------------------
  // `detached.tsx` spreads `WindowManager`'s `initialState` straight onto this
  // component. The payload is shaped like a v1 session blob so it can restore
  // through the same migration; see `useDetachedInit`.
  openTabs?: unknown;
  activeTabIndex?: number;
  currentBook?: number;
  currentChapter?: number;
  currentBookName?: string;
  selectedVerseId?: number | null;
}

/**
 * One Bible panel shows one passage.
 *
 * The passage is the dockview tab - there is no sub-tab strip inside the pane,
 * and opening another passage adds a panel rather than a tab (see
 * `openPassageInNewPanel`). That leaves exactly one band of pane chrome, the
 * toolbar. The large chapter heading below it is *not* chrome: it renders
 * inside the scroll container and scrolls away with the text, like a chapter
 * heading in a printed Bible.
 */
const BiblePane: React.FC<BiblePaneProps> = (props) => {
  const { panelId: propPanelId, contentKey, dockviewPanelApi, isDetached = false } = props;
  const panelId = propPanelId ?? DEFAULT_PANEL_ID;

  // The passage a pop-out was launched with. Only assembled when detached so an
  // in-workbench panel never has a competing seed.
  const detachedSeed = React.useMemo(() => (isDetached ? {
    openTabs: props.openTabs,
    activeTabIndex: props.activeTabIndex,
    currentBook: props.currentBook,
    currentChapter: props.currentChapter,
    selectedVerseId: props.selectedVerseId,
  } : undefined), [
    isDetached, props.openTabs, props.activeTabIndex,
    props.currentBook, props.currentChapter, props.selectedVerseId,
  ]);

  // Initialize/destroy panel state on mount/unmount
  useEffect(() => {
    useBibleStore.getState().initPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    return () => {
      useBibleStore.getState().destroyPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    };
  }, [panelId]);

  const panel = useBiblePanel(panelId);
  const {
    availableBibles, openTabs, isParallelViewMode,
    currentBook, currentChapter, currentBookName, selectedVerseId,
    selectionEndVerseId,
    versesByTab, loadingByTab, errorByTab,
    setDisplayMode, loadChapter,
    setSelectedVerse, extendSelectionTo,
  } = panel;

  // Refs
  const bibleTextRef = useRef<HTMLDivElement>(null);
  const selectedVerseRef = useRef<HTMLDivElement>(null);

  // Derived state - one passage per panel, so the first tab is the passage.
  const activeTab = openTabs[0];
  const emptyVerses = React.useMemo(() => [], []);
  const currentVerses = activeTab ? versesByTab.get(activeTab.tabId) || emptyVerses : emptyVerses;
  const isLoading = activeTab ? loadingByTab.get(activeTab.tabId) || false : false;
  const error = activeTab ? errorByTab.get(activeTab.tabId) || null : null;
  const displayMode = activeTab?.displayMode || DEFAULT_DISPLAY_MODE;

  // -- Overlay state hooks --------------------------------------------
  const bookPicker = useBookPickerOverlay();
  const modulePicker = useModulePickerOverlay();
  const parallelPicker = useParallelPickerOverlay();
  const historyDropdown = useHistoryDropdown();
  const verseContextMenu = useVerseContextMenu();
  const copyDialog = useCopyDialog();
  const noteTooltipHook = useNoteTooltip();

  // -- Cross-cutting hooks --------------------------------------------
  const highlights = useBibleHighlights(activeTab, currentBook, currentChapter, currentVerses, bibleTextRef);

  const {
    goBackWithScroll, navigateToHistoryEntryWithScroll,
  } = useBibleScrolling(
    panelId, bibleTextRef, selectedVerseRef, selectedVerseId,
    panel.previewVerseId,
    panel.scrollTrigger, panel.scrollMode, currentVerses, isLoading,
    panel.saveScrollPosition, panel.goBackVisit, panel.navigateToHistoryEntry,
  );

  const { handleMouseUpWithToolbar } = useBibleSelection(highlights.showFloatingToolbar);

  useBibleFind(bibleTextRef, currentVerses);

  // -- Navigation, verse interaction, pane actions -------------------
  // Chapter paging is a sequential step, so it replaces the current history
  // entry instead of adding one per chapter read through. `panel.loadChapter`
  // is bound with a fixed (book, chapter) signature and drops options, so the
  // paging path calls the store action directly.
  const pageToChapter = React.useCallback((book: number, chapter: number) => {
    // allow-getstate: navigation command, not render-time state
    void useBibleStore.getState().loadChapter(panelId, book, chapter, { replaceHistory: true });
  }, [panelId]);

  const { handlePreviousChapter, handleNextChapter } = useBibleNavigation({
    currentBook, currentChapter, loadChapter: pageToChapter,
  });

  const verseHandlers = useVerseInteractionHandlers({
    currentVerses, setSelectedVerse, extendSelectionTo,
    selectedVerseId, selectionEndVerseId,
    setContextMenu: verseContextMenu.setContextMenu,
    setNoteTooltipHidden: noteTooltipHook.hide,
    dismissFloatingToolbar: highlights.dismissFloatingToolbar,
  });

  const { handleDetachPane } = useBibleTabActions({
    panelId,
    activeTab,
    currentBook, currentChapter, currentBookName, selectedVerseId,
    versesByTab,
  });

  // -- Effect hooks (mount-time + reactive) --------------------------
  useBibleKeyboard({
    panelId, currentBook, currentChapter, currentVerses, selectedVerseId,
    selectionEndVerseId,
    activeTab, canGoBack: panel.canGoBackVisit,
    goBackWithScroll,
    handlePreviousChapter, handleNextChapter,
    setCopyOptionsDialog: copyDialog.setCopyOptionsDialog,
    buildSelectionFromDOM: highlights.buildSelectionFromDOM,
    dismissFloatingToolbar: highlights.dismissFloatingToolbar,
    highlightRepository: highlights.highlightRepository,
    loadChapter,
  });

  // Restore first, then contentKey, then defaults - each step stands down when
  // an earlier one owns the panel, so the passage can never be raced away.
  // A pop-out is seeded from its handover payload; nothing else runs there,
  // because the detached renderer has no session and no startup path.
  useDetachedInit({ panelId, isDetached, seed: detachedSeed });
  const hasStagedSession = useSessionPanelRestore(panelId);
  useContentKeyInit({ contentKey, panelId, openTabsLength: openTabs.length, availableBibles, hasStagedSession, dockviewPanelApi });
  useInitialDataLoader({
    panelId,
    initialLoadComplete: panel.initialLoadComplete,
    openTabsLength: openTabs.length,
    hasStagedSession,
    hasContentKey: !!contentKey,
    loadInitialData: panel.loadInitialData,
  });
  useDockviewTitleSync({
    dockviewPanelApi, panelId,
    hasPassage: !!activeTab,
    abbreviation: activeTab?.abbreviation,
    currentBookName, currentChapter,
  });
  const versesWithNotes = useVersesWithNotes(currentVerses, currentBook, currentChapter);

  // Preview navigation: following a scripture link shows the verse without
  // moving the selection every study pane follows. See
  // `stores/bible/slices/previewSlice.ts`.
  const handleReturnFromPreview = React.useCallback(() => {
    // allow-getstate: event handler - imperative navigation, no subscription needed
    void useBibleStore.getState().returnFromPreview(panelId);
  }, [panelId]);

  const handleDismissBackBar = React.useCallback(() => {
    // allow-getstate: event handler - imperative state change outside render
    useBibleStore.getState().dismissBackBar(panelId);
  }, [panelId]);

  // Display mode helper depends on activeTab so it lives here
  const handleSetDisplayMode = React.useCallback((mode: DisplayMode) => {
    if (activeTab) setDisplayMode(activeTab.tabId, mode);
  }, [activeTab, setDisplayMode]);

  // -- Build context value for sub-components -------------------------
  const contextValue = useBiblePaneContextValue({
    panelId, isDetached, contentKey, dockviewPanelApi,
    panel, activeTab, currentVerses, isLoading, error, displayMode,
    bibleTextRef, selectedVerseRef,
    highlights, bookPicker, modulePicker, parallelPicker, historyDropdown,
    verseContextMenu, copyDialog, noteTooltipHook,
    handleVerseClick: verseHandlers.handleVerseClick,
    handleStrongsClick: verseHandlers.handleStrongsClick,
    handleVerseContextMenu: verseHandlers.handleVerseContextMenu,
    handleNoteIndicatorClick: verseHandlers.handleNoteIndicatorClick,
    syncAllNotesPanelsWithVerse: verseHandlers.syncAllNotesPanelsWithVerse,
    setStudyPaneActiveTab: verseHandlers.setStudyPaneActiveTab,
    handleDetachPane,
    handlePreviousChapter, handleNextChapter,
    goBackWithScroll, navigateToHistoryEntryWithScroll,
    handleMouseUpWithToolbar, handleSetDisplayMode,
    versesWithNotes,
  });

  return (
    <BiblePaneProvider value={contextValue}>
      <div className="h-full flex flex-col min-w-0" data-testid="bible-pane" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
        {/* Above the toolbar, outside the scroll region: a way back from a
            cross-chapter preview is only useful if it stays put. */}
        <PreviewBackBar
          verseId={panel.backBarVerseId}
          onBack={handleReturnFromPreview}
          onDismiss={handleDismissBackBar}
        />
        <BibleToolbar />
        <BibleVerseList />

        <BiblePaneOverlays
          showBookPicker={bookPicker.showBookPicker}
          setShowBookPicker={bookPicker.setShowBookPicker}
          currentBook={currentBook}
          currentChapter={currentChapter}
          currentBookName={currentBookName}
          panelId={panelId}
          showSelector={modulePicker.showSelector}
          setShowSelector={modulePicker.setShowSelector}
          versionSelectorTabId={modulePicker.versionSelectorTabId}
          setVersionSelectorTabId={modulePicker.setVersionSelectorTabId}
          availableBibles={availableBibles}
          loadingBibles={panel.loadingBibles}
          openTabs={openTabs}
          openBible={panel.openBible}
          changeTabVersion={panel.changeTabVersion}
          showParallelPicker={parallelPicker.showParallelPicker}
          setShowParallelPicker={parallelPicker.setShowParallelPicker}
          parallelSelections={parallelPicker.parallelSelections}
          setParallelSelections={parallelPicker.setParallelSelections}
          isParallelViewMode={isParallelViewMode}
          toggleParallelView={panel.toggleParallelView}
          contextMenu={verseContextMenu.contextMenu}
          setContextMenu={verseContextMenu.setContextMenu}
          activeTab={activeTab}
          handleRemoveHighlight={highlights.handleRemoveHighlight}
          syncAllNotesPanelsWithVerse={verseHandlers.syncAllNotesPanelsWithVerse}
          setSelectedVerse={panel.setSelectedVerse}
          setStudyPaneActiveTab={verseHandlers.setStudyPaneActiveTab}
          copyOptionsDialog={copyDialog.copyOptionsDialog}
          setCopyOptionsDialog={copyDialog.setCopyOptionsDialog}
          highlightMenu={highlights.highlightMenu}
          setHighlightMenu={highlights.setHighlightMenu}
          handleSelectHighlight={highlights.handleSelectHighlight}
          handleCancelHighlightMenu={highlights.handleCancelHighlightMenu}
          floatingToolbar={highlights.floatingToolbar}
          handleFloatingHighlight={highlights.handleFloatingHighlight}
          handleFloatingUnderline={highlights.handleFloatingUnderline}
          handleFloatingRemoveFormatting={highlights.handleFloatingRemoveFormatting}
          dismissFloatingToolbar={highlights.dismissFloatingToolbar}
          noteTooltip={noteTooltipHook.noteTooltip}
          setNoteTooltip={noteTooltipHook.setNoteTooltip}
          handleNoteTooltipClose={noteTooltipHook.handleNoteTooltipClose}
          handleNoteTooltipEnter={noteTooltipHook.handleNoteTooltipEnter}
        />
      </div>
    </BiblePaneProvider>
  );
};

export default BiblePane;
