import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useOverlayDismissal } from '../hooks/useOverlayDismissal';
import { useCommentaryStore } from '../stores/useCommentaryStore';
import { useCommentaryPanel } from '../stores/hooks/useCommentaryPanel';
import { DEFAULT_PANEL_ID } from '../stores/helpers/panelStateHelpers';
import { useBibleStore } from '../stores/useBibleStore';
import { useTextSettingsStore, getFontFamilyCSS } from '../stores/useTextSettingsStore';
import { bibleAPI, commentaryAPI } from '../services/electronAPI';
import { loadBookNamesCache, formatVerseReference } from '../utils/verseReference';
import { cleanModuleName } from '../utils/verseFormatting';
import { DIGEST_DISPLAY_NAME, isDigestModule } from '../moduleDescriptions';
import CommentaryTreeView from './CommentaryTreeView';
import CommentaryHome from './CommentaryHome';
import CommentaryPassageHeader from './commentary/CommentaryPassageHeader';
import CommentaryVersePreview from './commentary/CommentaryVersePreview';
import CommentaryPinnedBanner from './commentary/CommentaryPinnedBanner';
import CommentaryContentArea from './commentary/CommentaryContentArea';
import ModuleSelector, { ModuleItem } from './ModuleSelector';
import DraggableTabBar, { TabItem } from './DraggableTabBar';
import SuggestionBanner from './shared/SuggestionBanner';
import PaneEmptyState from './onboarding/PaneEmptyState';
import PaneLoadingSkeleton from './onboarding/PaneLoadingSkeleton';
import { useSessionStore } from '../stores/useSessionStore';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useI18n } from '../contexts/useI18n';
import { openModuleManager } from '../utils/openModuleManager';
import { anchorAtPointerX } from '../utils/overlayPosition';
import { popOutModuleToWindow } from '../utils/popOutModule';

interface CommentaryPaneProps {
  panelId?: string;
  isDetached?: boolean;
  windowId?: string;
  // Initial state for detached mode (passed from main window)
  openTabs?: Array<{ abbreviation: string; name: string }>;
  activeTabIndex?: number;
  currentVerseId?: number | null;
  entriesByTab?: Array<[string, any[]]>;
  browseModeByTab?: Array<[string, boolean]>;
  overviewActive?: boolean;
}

const CommentaryPane: React.FC<CommentaryPaneProps> = (props) => {
  const { t } = useI18n();
  const {
    panelId: propPanelId,
    isDetached = false,
    openTabs: initialOpenTabs,
    activeTabIndex: initialActiveTabIndex,
    currentVerseId: initialCurrentVerseId,
    entriesByTab: initialEntriesByTab,
    browseModeByTab: initialBrowseModeByTab,
    overviewActive: initialOverviewActive,
  } = props;

  // Use provided panelId, or default for detached/legacy usage
  const panelId = propPanelId ?? DEFAULT_PANEL_ID;

  // Whether startup session restore has resolved yet. Gates the "no
  // commentary open" onboarding empty state below: without this, that empty
  // state (with its install/choose-a-commentary buttons) flashes on every
  // app startup before the session restore populates openTabs.
  const isSessionLoaded = useSessionStore(state => state.isSessionLoaded);

  // Track the last chapter we synced to (used to prevent re-syncing to verse 1 after verse-specific sync)
  const lastChapterSyncRef = useRef<number | null>(null);

  // Initialize/destroy panel state on mount/unmount
  useEffect(() => {
    useCommentaryStore.getState().initPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle

    // Auto-detect currently selected verse from Bible pane
    if (!isDetached) {
      const bibleState = useBibleStore.getState(); // allow-getstate: event handler - imperative store access outside render
      const primaryPanel = bibleState.panels.values().next().value;
      if (primaryPanel) {
        const activeBTab = primaryPanel.openTabs[primaryPanel.activeTabIndex];
        if (activeBTab) {
          const verses = primaryPanel.versesByTab.get(activeBTab.tabId) || [];
          if (verses.length > 0) {
            const verseId = primaryPanel.selectedVerseId || verses[0].verse_id;
            if (verseId) {
              useCommentaryStore.getState().syncWithBibleVerse(panelId, verseId); // allow-getstate: subscription callback - read store imperatively
              lastChapterSyncRef.current = verses[0].verse_id;
            }
          }
        }
      }
    }

    return () => {
      useCommentaryStore.getState().destroyPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    };
  }, [panelId]);

  const {
    availableCommentaries,
    loadingCommentaries,
    openTabs,
    activeTabIndex,
    currentVerseId,
    isRestoringSession,
    pinned,
    pinnedVerseId,
    liveBibleVerseId,
    entriesByTab,
    loadingByTab,
    errorByTab,
    entrySummariesByTab,
    loadingSummariesByTab,
    loadAvailableCommentaries,
    openCommentary,
    closeCommentary,
    setActiveTab,
    syncWithBibleVerse,
    togglePin,
    loadHomeData,
    navigateToNextVerse,
    navigateToPreviousVerse,
    navigateToVerse,
    loadEntrySummaries,
    initializeFromState,
    tabActivationSeq
  } = useCommentaryPanel(panelId);

  // Overview tab is active when overviewActive is true
  // In detached mode, use the passed prop (false when user had tabs open)
  const [overviewActive, setOverviewActive] = useState(
    isDetached ? (initialOverviewActive ?? true) : true
  );

  // Initialize store from props in detached mode
  const [initialized, setInitialized] = React.useState(false);
  useEffect(() => {
    if (isDetached && !initialized) {
      if (initialOpenTabs && initialOpenTabs.length > 0) {
        const entries = initialEntriesByTab ? new Map(initialEntriesByTab) : new Map();
        initializeFromState({
          openTabs: initialOpenTabs,
          activeTabIndex: initialActiveTabIndex ?? 0,
          currentVerseId: initialCurrentVerseId ?? null,
          entriesByTab: entries,
          browseModeByTab: initialBrowseModeByTab ? new Map(initialBrowseModeByTab) : new Map(),
        });
        setInitialized(true);

        // `initializeFromState` seeds state; it does not fetch. When the payload
        // carried a verse but no cached entries - which is exactly what "Pop Out
        // to Window" on a single commentary sends, since a cached copy is worse
        // than a fresh read - the window would otherwise come up on the right
        // module showing nothing. Ask for the verse once here.
        if (initialCurrentVerseId && entries.size === 0) {
          void syncWithBibleVerse(initialCurrentVerseId);
        }
      } else if (initialCurrentVerseId) {
        // No tabs but we have a verse - set it for overview display
        initializeFromState({
          openTabs: [],
          activeTabIndex: 0,
          currentVerseId: initialCurrentVerseId,
          entriesByTab: new Map(),
          browseModeByTab: new Map(),
        });
        setInitialized(true);
      }
    }
  }, [isDetached, initialized, initialOpenTabs, initialActiveTabIndex, initialCurrentVerseId, initialEntriesByTab, initialBrowseModeByTab, initializeFromState, syncWithBibleVerse]);

  // Ref to hold latest syncWithBibleVerse to avoid stale closures in IPC listener
  const syncWithBibleVerseRef = useRef(syncWithBibleVerse);
  useEffect(() => { syncWithBibleVerseRef.current = syncWithBibleVerse; }, [syncWithBibleVerse]);

  // Listen for verse changes from main window when in detached mode
  useEffect(() => {
    if (!isDetached) return;

    const handleVerseChange = (verseId: number) => {
      syncWithBibleVerseRef.current(verseId);
    };

    if (window.electron?.window?.onVerseChanged) {
      window.electron.window.onVerseChanged(handleVerseChange);
    }
  }, [isDetached]);

  // Watch the primary (first) Bible panel directly, not a specific panelId.
  // In the dockview system, the Bible panel ID (e.g. 'bible_default') differs from DEFAULT_PANEL_ID.
  const primaryBiblePanel = useBibleStore(s => {
    const first = s.panels.values().next().value;
    return first ?? null;
  });
  const versesByTab = primaryBiblePanel?.versesByTab ?? new Map();
  const bibleOpenTabs = primaryBiblePanel?.openTabs ?? [];
  const bibleActiveTabIndex = primaryBiblePanel?.activeTabIndex ?? 0;
  /**
   * A verse the reader followed a link to rather than chose.
   *
   * This pane deliberately does not follow it - that is the whole point of a
   * preview (see `stores/bible/slices/previewSlice.ts`) - but it does *offer*
   * it, so adopting the side trip as the new subject stays one click away.
   */
  const biblePreviewVerseId = primaryBiblePanel?.previewVerseId ?? null;
  const textSettings = useTextSettingsStore(state => state.getSettings('commentary'));

  const [showSelector, setShowSelector] = useState(false);
  const [showTreeView, setShowTreeView] = useState(false);
  /**
   * A previewed verse the reader has waved away.
   *
   * Kept as the verse id rather than a boolean so a *different* preview offers
   * itself afresh: dismissing "show me Romans 8:28" is not a standing refusal
   * to be told about the next cross-reference.
   */
  const [previewOfferDismissed, setPreviewOfferDismissed] = useState<number | null>(null);
  // Track which commentaries have content for the current verse (for selector indicator)
  const [commentaryHasContent, setCommentaryHasContent] = useState<Map<string, boolean>>(new Map());
  // True while the batch availability check below is in flight, so the
  // selector can show an honest loading state instead of guessing.
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  // Cache of hasContentForVerse results keyed by "abbreviation:verseId" to
  // avoid redundant IPC calls when toggling the selector open/closed.
  const contentCheckCache = useRef<Map<string, boolean>>(new Map());
  // Guards against a slower, superseded check (e.g. the verse changed again
  // before the first batch resolved) clobbering a newer one's results.
  const availabilityCheckToken = useRef(0);

  // A user may have many commentary modules installed; checking every one of
  // them the instant the selector opens would fire an unbounded burst of
  // synchronous main-process (better-sqlite3) queries and stall the UI.
  // Capping keeps the check bounded regardless of how many are installed -
  // mirrors the server-side cap web's `/commentary/availability` route uses.
  const MAX_AVAILABILITY_CHECKS = 12;

  // Check which commentaries have content for the current verse when selector opens
  useEffect(() => {
    if (!showSelector || !currentVerseId || availableCommentaries.length === 0) return;
    const token = ++availabilityCheckToken.current;
    const toCheck = availableCommentaries.slice(0, MAX_AVAILABILITY_CHECKS);
    setAvailabilityLoading(true);
    const checkAll = async () => {
      const results = new Map<string, boolean>();
      await Promise.all(
        toCheck.map(async (c) => {
          const cacheKey = `${c.abbreviation}:${currentVerseId}`;
          const cached = contentCheckCache.current.get(cacheKey);
          if (cached !== undefined) {
            results.set(c.abbreviation, cached);
            return;
          }
          try {
            const has = await commentaryAPI.hasContentForVerse(c.abbreviation, currentVerseId);
            contentCheckCache.current.set(cacheKey, has);
            results.set(c.abbreviation, has);
          } catch {
            // Degrade gracefully: no badge is shown rather than a misleading one.
            results.set(c.abbreviation, false);
          }
        })
      );
      // A newer check started (verse changed again) - drop this stale result.
      if (token !== availabilityCheckToken.current) return;
      setCommentaryHasContent(results);
      setAvailabilityLoading(false);
    };
    checkAll();
  }, [showSelector, currentVerseId, availableCommentaries]);

  // Context menu for internal commentary tabs (right-click -> "Pop Out to Window")
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; abbreviation: string; tabIndex: number } | null>(null);

  // Close tab context menu on outside click or Escape
  const dismissTabContextMenu = useCallback(() => setTabContextMenu(null), []);
  useOverlayDismissal(!!tabContextMenu, dismissTabContextMenu);

  // Handle "Pop Out to Window".
  //
  // One step, carrying both module and verse. Moving the commentary to
  // another dockview panel *inside* this window instead would leave the
  // reader who actually wants a separate window to find a second pop-out on
  // that panel's tab - and that second step would come up empty besides: a
  // single-commentary panel keeps its state locally and writes nothing to
  // the store, so the payload it gathered would have neither module nor
  // verse.
  const handlePopOutTab = useCallback((abbreviation: string) => {
    setTabContextMenu(null);
    const tab = openTabs.find(t => t.abbreviation === abbreviation);
    if (!tab) return;

    void popOutModuleToWindow({
      type: 'commentary',
      abbreviation,
      name: tab.name || cleanModuleName(abbreviation),
      verseId: currentVerseId,
    }).then(ok => {
      // Only give up the tab here once the window is actually open, or a
      // failed detach would close the commentary and show nothing instead.
      if (ok) closeCommentary(abbreviation);
    });
  }, [openTabs, closeCommentary, currentVerseId]);

  // Handle "Split Right/Down" - creates a new dockview panel in a specific direction
  const handleSplitCommentaryTab = useCallback((abbreviation: string, direction: 'right' | 'below') => {
    setTabContextMenu(null);
    const tab = openTabs.find(t => t.abbreviation === abbreviation);
    if (!tab) return;

    const dockApi = useLayoutStore.getState().dockviewApi; // allow-getstate: event handler - dockview API access outside render
    const currentPanel = dockApi?.getPanel(panelId);
    const position = currentPanel
      ? { referencePanel: currentPanel, direction }
      : undefined;

    useLayoutStore.getState().addPanel('commentary', abbreviation, cleanModuleName(abbreviation), position, 'Commentary'); // allow-getstate: event handler - imperative panel creation
    closeCommentary(abbreviation);
  }, [openTabs, closeCommentary, panelId]);

  /** The previewed verse, unless it is already what this pane is showing. */
  const previewOffer =
    biblePreviewVerseId !== null
      && biblePreviewVerseId !== currentVerseId
      && biblePreviewVerseId !== previewOfferDismissed
      ? biblePreviewVerseId
      : null;

  const handleAdoptPreview = useCallback(() => {
    if (previewOffer === null) return;
    setPreviewOfferDismissed(null);
    // Promote in the Bible pane too: adopting the side trip makes it the
    // reader's actual place, so the preview mark gives way to the selection
    // and the back bar comes down.
    const panelKey = useBibleStore.getState().panels.keys().next().value; // allow-getstate: event handler - imperative store access outside render
    if (panelKey) useBibleStore.getState().adoptPreview(panelKey); // allow-getstate: event handler - imperative store access outside render
    void syncWithBibleVerse(previewOffer);
  }, [previewOffer, syncWithBibleVerse]);

  // Load available commentaries and book names on mount
  useEffect(() => {
    if (availableCommentaries.length === 0) {
      loadAvailableCommentaries();
    }
    loadBookNamesCache(bibleAPI);
  }, []);

  // Auto-sync with Bible chapter changes (only syncs when chapter changes, not when verse is clicked)
  // This prevents overwriting verse-specific syncs from BiblePane's handleVerseClick
  useEffect(() => {
    // Skip auto-sync during session restoration to prevent race conditions
    if (isRestoringSession) {
      return;
    }

    // A preview changed the chapter without changing the reader's subject, so
    // the chapter-follow below must stand down - otherwise glancing at a
    // cross-reference in another book would silently reload this pane onto it,
    // which is precisely what the preview exists to prevent.
    if (biblePreviewVerseId !== null) return;

    const activeBibleTab = bibleOpenTabs[bibleActiveTabIndex];
    // versesByTab is keyed by tabId, not abbreviation
    const currentVerses = activeBibleTab ? versesByTab.get(activeBibleTab.tabId) || [] : [];

    if (currentVerses.length > 0 && currentVerses[0].verse_id) {
      const firstVerseId = currentVerses[0].verse_id;
      // Only sync if the chapter has changed (first verse is different from last sync)
      // This prevents overwriting when user clicks a specific verse
      if (lastChapterSyncRef.current !== firstVerseId) {
        lastChapterSyncRef.current = firstVerseId;
        syncWithBibleVerse(firstVerseId);
      }
    }
  }, [versesByTab, bibleOpenTabs, bibleActiveTabIndex, syncWithBibleVerse, isRestoringSession, biblePreviewVerseId]);

  /**
   * A commentary opened from OUTSIDE this pane - the Study-mode
   * "Commentaries:" row calls `useCommentaryStore.openCommentary` directly -
   * adds a tab and makes it active in the store, but `overviewActive` is local
   * React state, so Overview would stay in front of the tab the user just
   * asked for. Every in-pane path that calls `openCommentary` already pairs it
   * with `setOverviewActive(false)`; this keeps that invariant for the
   * out-of-pane path.
   *
   * Keyed on `tabActivationSeq` - the store's count of tabs brought forward
   * because someone ASKED for one - and seeded from the first render, so a
   * pane that mounts with restored tabs still opens on Overview.
   *
   * Watching the tab *count* instead would conflate "the reader chose a
   * module" with "a module was put here": `AppInitService` opens a default
   * commentary on first launch, after this pane has mounted, which would grow
   * the count, drop Overview, and land a new user on one commentary rather
   * than the list of everything available for the verse. The startup path
   * passes `activate: false` and bumps no sequence, so it populates the pane
   * without deciding what is on screen.
   */
  const previousActivationSeqRef = useRef(tabActivationSeq);
  useEffect(() => {
    const activated = tabActivationSeq > previousActivationSeqRef.current;
    previousActivationSeqRef.current = tabActivationSeq;
    if (activated) setOverviewActive(false);
  }, [tabActivationSeq]);

  // Load home data when Overview tab is active and verse changes
  useEffect(() => {
    if (overviewActive && currentVerseId) {
      loadHomeData(currentVerseId);
    }
  }, [overviewActive, currentVerseId, loadHomeData]);

  const activeTab = openTabs[activeTabIndex];
  const activeEntries = activeTab ? entriesByTab.get(activeTab.abbreviation) || [] : [];
  const isLoading = activeTab ? loadingByTab.get(activeTab.abbreviation) || false : false;
  const error = activeTab ? errorByTab.get(activeTab.abbreviation) || null : null;
  const entrySummaries = activeTab ? entrySummariesByTab.get(activeTab.abbreviation) || [] : [];
  const loadingSummaries = activeTab ? loadingSummariesByTab.get(activeTab.abbreviation) || false : false;

  // Task #10: When a commentary has no entry for the current verse, lazily load
  // its entry summaries so the empty-verse fallback grid can render.
  useEffect(() => {
    if (overviewActive) return;
    if (!activeTab) return;
    if (isLoading) return;
    if (activeEntries.length > 0) return;
    if (entrySummaries.length > 0) return;
    if (loadingSummaries) return;
    loadEntrySummaries(activeTab.abbreviation);
  }, [overviewActive, activeTab, activeEntries.length, entrySummaries.length, isLoading, loadingSummaries, loadEntrySummaries]);

  const handleShowTreeView = () => {
    if (activeTab && entrySummaries.length === 0 && !loadingSummaries) {
      loadEntrySummaries(activeTab.abbreviation);
    }
    setShowTreeView(true);
  };

  const handleNavigateNext = () => {
    if (activeTab) {
      navigateToNextVerse(activeTab.abbreviation);
    }
  };

  const handleNavigatePrevious = () => {
    if (activeTab) {
      navigateToPreviousVerse(activeTab.abbreviation);
    }
  };

  // Handle clicking a commentary tab (deactivates overview)
  const handleTabClick = (index: number) => {
    setOverviewActive(false);
    setActiveTab(index);
  };

  // Handle clicking the Overview tab
  const handleOverviewClick = () => {
    setOverviewActive(true);
  };

  // Handle opening a commentary from the Overview tab
  const handleOpenFromOverview = (abbreviation: string, name: string) => {
    openCommentary(abbreviation, name);
    setOverviewActive(false);
  };

  // Handle syncing when pinned to a different verse
  const handleSyncFromPin = () => {
    const state = useBibleStore.getState(); // allow-getstate: event handler - imperative store access outside render
    const primaryPanel = state.panels.values().next().value;
    if (primaryPanel) {
      const activeBTab = primaryPanel.openTabs[primaryPanel.activeTabIndex];
      if (activeBTab) {
        const verses = primaryPanel.versesByTab.get(activeBTab.tabId) || [];
        if (verses.length > 0) {
          const store = useCommentaryStore.getState(); // allow-getstate: event handler - imperative store access outside render
          store.unpin(panelId);
          store.syncWithBibleVerse(panelId, verses[0].verse_id);
        }
      }
    }
  };

  // Ties each tab to the region it controls (WAI-ARIA tabs pattern). The tab
  // bar derives its ids from `idPrefix` as `${prefix}-tab-${i}` and
  // `${prefix}-panel-${i}` (see DraggableTabBar), so the content region below
  // has to use exactly that scheme or every tab's `aria-controls` points at
  // nothing. The prefix is scoped by panelId because several commentary panes
  // can be open in one document, and ids must stay unique across them.
  const tabIdPrefix = `commentary-${panelId}`;
  // Only a commentary tab owns a tabpanel: the Overview tab is rendered as
  // `prefixContent` rather than a `role="tab"`, and with no tabs open the
  // content region is an onboarding empty state that no tab controls.
  const tabPanelProps: React.HTMLAttributes<HTMLDivElement> =
    !overviewActive && activeTab
      ? {
          id: `${tabIdPrefix}-panel-${activeTabIndex}`,
          role: 'tabpanel',
          'aria-labelledby': `${tabIdPrefix}-tab-${activeTabIndex}`,
        }
      : {};

  return (
    <div className="h-full flex flex-col" data-testid="commentary-pane" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
      {/* Tab Bar: Overview tab (fixed, via prefixContent) + draggable commentary tabs */}
      <DraggableTabBar
        tabs={openTabs.map((tab): TabItem => ({
          id: tab.abbreviation,
          label: isDigestModule(tab.abbreviation) ? DIGEST_DISPLAY_NAME : cleanModuleName(tab.abbreviation),
          hasContent: (entriesByTab.get(tab.abbreviation) || []).length > 0
        }))}
        activeTabIndex={overviewActive ? -1 : activeTabIndex}
        droppableId="commentary-tabs"
        onTabClick={handleTabClick}
        onTabClose={closeCommentary}
        onReorder={(src: number, dest: number) => useCommentaryStore.getState().reorderTabs(panelId, src, dest)} // allow-getstate: callback prop - imperative reorder
        onAddClick={() => setShowSelector(true)}
        addButtonTitle={t('commentaryPane.addCommentary')}
        ariaLabel={t('commentaryPane.tabsLabel')}
        idPrefix={tabIdPrefix}
        renderTab={(tab, index, isActive) => (
          <div
            className="flex items-center gap-1.5"
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setTabContextMenu({ x: e.clientX, y: e.clientY, abbreviation: tab.id, tabIndex: index });
            }}
          >
            <span className={`whitespace-nowrap ${isActive ? 'font-semibold' : ''}`}>
              {tab.label}
            </span>
            {/* The web app puts a x on every commentary tab; this one had only
                a right-click menu, so "how do I get rid of this commentary?"
                had no visible answer. Hidden on the last tab: closing it would
                leave the strip with nothing but Overview. */}
            {openTabs.length > 1 && (
              <button
                type="button"
                data-testid={`commentary-tab-close-${tab.id}`}
                className="text-sm leading-none p-0.5 rounded hover:text-danger hover:bg-danger-soft text-text-muted transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  closeCommentary(tab.id);
                }}
                title={t('commentaryPane.removeCommentary')}
                aria-label={`${t('commentaryPane.closeTab')} ${tab.label}`}
              >
                &times;
              </button>
            )}
          </div>
        )}
        wrap
        prefixContent={
          <div
            data-testid="commentary-overview-tab"
            onClick={handleOverviewClick}
            className={`flex items-center gap-1.5 px-3 cursor-pointer transition-colors text-sm select-none flex-shrink-0 border-e border-border ${
              overviewActive
                ? 'text-text-primary font-semibold'
                : 'text-text-secondary hover:text-text-primary hover:bg-background-hover'
            }`}
            style={{
              borderBottom: overviewActive ? '3px solid var(--theme-accent-primary)' : '3px solid transparent',
              paddingTop: '6px',
              paddingBottom: '3px',
            }}
            title={t('commentaryPane.overviewTitle')}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <span className="whitespace-nowrap">{t('commentaryPane.overviewLabel')}</span>
          </div>
        }
      />

      {/* Pinned banner - shows when pinned and the Bible pane has navigated
          away from the pinned verse. `currentVerseId` freezes while pinned
          (see navigationSlice.syncWithBibleVerse), so this compares against
          `liveBibleVerseId`, which keeps tracking the Bible pane's actual
          position regardless of pin state. */}
      {pinned && pinnedVerseId && liveBibleVerseId !== null && liveBibleVerseId !== pinnedVerseId && (
        <CommentaryPinnedBanner
          pinnedVerseId={pinnedVerseId}
          onSyncToCurrent={handleSyncFromPin}
        />
      )}

      {/* The reader followed a link somewhere this pane deliberately did not
          follow. Offer the trip rather than taking it - one click to adopt the
          previewed verse as the new subject, or ignore it and keep reading. */}
      {previewOffer !== null && (
        <SuggestionBanner
          verseId={previewOffer}
          messagePrefix={t('commentaryPane.previewAvailable')}
          onGo={handleAdoptPreview}
          onDismiss={() => setPreviewOfferDismissed(previewOffer)}
        />
      )}

      {/* Passage header */}
      {!overviewActive && openTabs.length > 0 && activeTab && (
        <CommentaryPassageHeader
          currentVerseId={currentVerseId}
          pinned={pinned}
          onTogglePin={togglePin}
        />
      )}

      {/* Content Area */}
      <div
        className="flex-1 overflow-auto pane-content-commentary"
        {...tabPanelProps}
        style={{
          '--pane-font-family-commentary': getFontFamilyCSS(textSettings.fontFamily),
          '--pane-font-size-commentary': `${textSettings.fontSize}px`,
          '--pane-line-height-commentary': textSettings.lineHeight
        } as React.CSSProperties}
      >
        {/* Verse Preview Bar - inside scrollable area so it scrolls away */}
        {currentVerseId && (
          <CommentaryVersePreview
            verseId={currentVerseId}
            onNavigatePrev={handleNavigatePrevious}
            onNavigateNext={handleNavigateNext}
            isLoading={isLoading}
          />
        )}

        {overviewActive ? (
          <CommentaryHome
            panelId={panelId}
            currentVerseId={currentVerseId}
            onOpenTab={handleOpenFromOverview}
          />
        ) : openTabs.length === 0 ? (
          !isSessionLoaded ? (
            // Session restore hasn't resolved yet: we don't yet know whether
            // this panel will end up with a tab. Showing the "no commentary
            // open" onboarding below at this point would flash it on every
            // startup, between first paint and session restore.
            <PaneLoadingSkeleton testId="commentary-loading-skeleton" />
          ) : (
            // D4: first-run onboarding for an empty commentary tab, using the
            // shared PaneEmptyState pattern. D2: with nothing installed the
            // selector would be empty, so route to the Module Manager (filtered
            // to commentaries) instead; offer the selector only once >=1 exists.
            <PaneEmptyState
              icon="📝"
              testId="commentary-empty-state"
              title={t('onboarding.empty.commentary.title')}
              description={t('onboarding.empty.commentary.description')}
              actions={[
                availableCommentaries.length === 0
                  ? {
                      label: t('onboarding.empty.commentary.install'),
                      onClick: () => openModuleManager('commentary'),
                      primary: true,
                      testId: 'commentary-empty-install',
                    }
                  : {
                      label: t('onboarding.empty.commentary.action'),
                      onClick: () => setShowSelector(true),
                      primary: true,
                      testId: 'commentary-empty-choose',
                    },
              ]}
            />
          )
        ) : (
          <CommentaryContentArea
            entries={activeEntries}
            moduleName={activeTab?.name || ''}
            moduleAbbreviation={activeTab?.abbreviation}
            currentVerseId={currentVerseId}
            isLoading={isLoading}
            error={error}
            onNavigatePrev={handleNavigatePrevious}
            onNavigateNext={handleNavigateNext}
            onBrowseAll={handleShowTreeView}
            entrySummaries={entrySummaries}
            onSelectVerse={(verseId) => {
              if (activeTab) {
                navigateToVerse(activeTab.abbreviation, verseId);
              }
            }}
          />
        )}
      </div>

      {/* Commentary Selector Modal */}
      {showSelector && (
        <ModuleSelector
          title={t('commentaryPane.selectCommentaryTitle')}
          modules={(() => {
            // Modules beyond the availability-check cap were never queued \u2014
            // they get no badge and no loading spinner (degrade gracefully)
            // rather than a spinner that never resolves.
            const checkedAbbrs = new Set(
              availableCommentaries.slice(0, MAX_AVAILABILITY_CHECKS).map(c => c.abbreviation)
            );
            const hasContentLabel = currentVerseId
              ? t(
                'commentaryPane.hasContentFor',
                { reference: formatVerseReference(currentVerseId), },
              )
              : undefined;
            return availableCommentaries
              .map((commentary): ModuleItem & { _hasContent?: boolean } => {
                const hasContent = commentaryHasContent.get(commentary.abbreviation) ?? false;
                // The digest ships as "SYNTHESIS" and is named "Combined
                // Summary" everywhere a reader can see it. Resolved here
                // rather than inside `ModuleSelector`, which is generic and
                // has no business knowing about one particular module.
                const isDigest = isDigestModule(commentary.abbreviation);
                return {
                  id: commentary.abbreviation,
                  name: isDigest ? DIGEST_DISPLAY_NAME : commentary.name,
                  abbreviation: isDigest ? DIGEST_DISPLAY_NAME : commentary.abbreviation,
                  languageCode: commentary.language_code,
                  version: commentary.version,
                  openCount: openTabs.some(tab => tab.abbreviation === commentary.abbreviation) ? 1 : 0,
                  availabilityLabel: hasContent ? hasContentLabel : undefined,
                  availabilityLoading: availabilityLoading && checkedAbbrs.has(commentary.abbreviation),
                  _hasContent: hasContent,
                };
              })
              .sort((a, b) => {
                // Sort commentaries with content for current verse first
                if (a._hasContent && !b._hasContent) return -1;
                if (!a._hasContent && b._hasContent) return 1;
                return 0;
              });
          })()}
          isLoading={loadingCommentaries}
          emptyMessage={t('commentaryPane.noCommentariesInstalled')}
          onSelect={(module) => {
            // `module.id` rather than `module.abbreviation`: `id` is the
            // identity ModuleSelector documents, and `abbreviation` is display
            // text - which for the digest is "Combined Summary", not the
            // "SYNTHESIS" the store needs to open the module.
            // openCommentary handles both new tabs and selecting existing ones
            openCommentary(module.id, module.name);
            setOverviewActive(false);
            setShowSelector(false);
          }}
          onRemove={(module) => closeCommentary(module.id)}
          removeLabel={t('commentaryPane.removeCommentary')}
          onClose={() => setShowSelector(false)}
        />
      )}

      {/* Tree View Modal */}
      {showTreeView && activeTab && entrySummaries.length > 0 && (
        <CommentaryTreeView
          abbreviation={activeTab.abbreviation}
          summaries={entrySummaries}
          currentVerseId={currentVerseId}
          onSelectVerse={(verseId) => {
            navigateToVerse(activeTab.abbreviation, verseId);
          }}
          onClose={() => setShowTreeView(false)}
        />
      )}

      {/* Internal tab context menu */}
      {tabContextMenu && (
        <div
          style={{
            position: 'fixed',
            ...anchorAtPointerX(tabContextMenu.x),
            top: tabContextMenu.y,
            zIndex: 10000,
            minWidth: '180px',
            backgroundColor: 'var(--theme-bg-primary)',
            border: '1px solid var(--theme-border-primary)',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '4px 0',
          }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') dismissTabContextMenu(); }}
        >
          <CommentaryTabMenuItem label={t('ui.dockviewTab.popOutToWindow')} onClick={() => handlePopOutTab(tabContextMenu.abbreviation)} />
          <CommentaryTabMenuItem label={t('commentaryPane.splitRight')} onClick={() => handleSplitCommentaryTab(tabContextMenu.abbreviation, 'right')} />
          <CommentaryTabMenuItem label={t('commentaryPane.splitDown')} onClick={() => handleSplitCommentaryTab(tabContextMenu.abbreviation, 'below')} />
          {openTabs.length > 1 && (
            <>
              <div style={{ height: '1px', backgroundColor: 'var(--theme-border-primary)', margin: '4px 0' }} />
              <CommentaryTabMenuItem label={t('commentaryPane.closeTab')} onClick={() => { setTabContextMenu(null); closeCommentary(tabContextMenu.abbreviation); }} />
            </>
          )}
        </div>
      )}

    </div>
  );
};

/** Simple context menu item for internal commentary tab context menu */
const CommentaryTabMenuItem: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    role="menuitem"
    tabIndex={0}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      width: '100%',
      padding: '6px 12px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: '13px',
      color: 'var(--theme-text-primary)',
      textAlign: 'start',
    }}
    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover)'; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
  >
    {label}
  </button>
);

export default CommentaryPane;
