import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useOverlayDismissal } from '../hooks/useOverlayDismissal';
import { useDeferredLoading } from '../hooks/useDeferredLoading';
import { useBookStore } from '../stores/useBookStore';
import { useBookPanel } from '../stores/hooks/useBookPanel';
import { useDictionaryPanel } from '../stores/hooks/useDictionaryPanel';
import { useTextSettingsStore, getFontFamilyCSS } from '../stores/useTextSettingsStore';
import DictionaryPane from './DictionaryPane';
import DraggableTabBar, { TabItem } from './DraggableTabBar';
import type { PaneMenuOption } from './PaneOptionsMenu';
import { BOOK_PANE_TAB_ICONS } from './paneIcons';
import LibraryHome from './LibraryHome';
import { cleanModuleName } from '../utils/verseFormatting';
import { DEFAULT_PANEL_ID } from '../stores/helpers/panelStateHelpers';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useI18n } from '../contexts/useI18n';
import { BookSection, BookSectionSummary, BookTab } from '../stores/useBookStore';
import { DictionaryTab, DictionaryEntry } from '../stores/useDictionaryStore';

import { BookTabMenuItem } from './BookPane/BookTabMenuItem';
import { BookNavigationToolbar } from './BookPane/BookNavigationToolbar';
import { BookSectionContent } from './BookPane/BookSectionContent';
import { BookModuleSelectorModal } from './BookPane/BookModuleSelectorModal';
import BookHome from './BookPane/BookHome';
import { mergeTabOrder, moveTab, sameTabOrder, indexWithinType } from './BookPane/tabOrder';
import { useNavSectionInfo } from './BookPane/hooks/useNavSectionInfo';
import { useDetachedInit } from './BookPane/hooks/useDetachedInit';
import { useDictionaryDetachedInit } from './BookPane/hooks/useDictionaryDetachedInit';
import { anchorAtPointerX } from '../utils/overlayPosition';
import {
  SHOW_DICTIONARY_PANE_EVENT,
  type ShowDictionaryPaneDetail,
} from './BookPane/showDictionaryPane';
import PaneEmptyState from './onboarding/PaneEmptyState';
import PaneLoadingSkeleton from './onboarding/PaneLoadingSkeleton';
import { openModuleManager } from '../utils/openModuleManager';
import { popOutModuleToWindow } from '../utils/popOutModule';

interface BookPaneProps {
  panelId?: string;
  isDetached?: boolean;
  windowId?: string;
  /**
   * Which kind of module this pane holds. `PanelContentRenderer` routes both the
   * "Books" and "Dictionary" panel types to this component, and this is what
   * separates them: a Dictionary pane shows dictionary tabs only, a Books pane
   * book tabs only.
   *
   * The two kinds are segregated rather than sharing a pane with a *starting*
   * half the user could switch away from, which would let a reader who opened
   * "Dictionary" end up looking at books (and vice versa). Dictionaries are the
   * common case with lookup-shaped controls, books the rarer, more generic one.
   */
  paneKind?: 'book' | 'dictionary';
  openTabs?: BookTab[];
  activeTabIndex?: number;
  currentSectionByTab?: [string, number | null][];
  sectionsByTab?: [string, BookSection | null][];
  childSectionsByTab?: [string, BookSectionSummary[]][];
  sectionSummariesByTab?: [string, BookSectionSummary[]][];
  dictOpenTabs?: DictionaryTab[];
  dictActiveTabIndex?: number;
  dictEntriesByTab?: [string, DictionaryEntry | null][];
}

/**
 * Stable "nothing loaded for this tab yet" value. A fresh `[]` per render would
 * change the auto-load effect's dependencies every render, which turned a
 * failing summaries query into an unbounded IPC retry loop.
 */
const NO_SUMMARIES: BookSectionSummary[] = [];

const BookPane: React.FC<BookPaneProps> = (props) => {
  const { t } = useI18n();
  const panelId = props.panelId ?? DEFAULT_PANEL_ID;

  // Initialize/destroy panel state on mount/unmount
  useEffect(() => {
    useBookStore.getState().initPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    return () => {
      // detach, NOT destroy: this component unmounts on an ordinary tab
      // switch (and twice per mount under StrictMode). Only dockview's
      // onDidRemovePanel means the pane is really gone - see
      // `destroyPanelState` in stores/helpers/panelDisposal.ts.
      useBookStore.getState().detachPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    };
  }, [panelId]);

  const {
    availableBooks,
    loadingBooks,
    openTabs: bookTabs,
    activeTabIndex: bookActiveIndex,
    tabOrder,
    sectionsByTab,
    loadingByTab,
    errorByTab,
    sectionSummariesByTab,
    loadingSummariesByTab,
    summariesErrorByTab,
    childSectionsByTab,
    loadAvailableBooks,
    openBook,
    closeBook,
    setActiveTab: setBookActiveTab,
    reorderTabs: reorderBookTabs,
    setTabOrder,
    navigateToNextSection,
    navigateToPreviousSection,
    navigateToParentSection,
    navigateToSection,
    navigateToHome,
    loadSectionSummaries
  } = useBookPanel(panelId);

  const {
    availableDictionaries,
    loadingDictionaries,
    openTabs: dictTabs,
    activeTabIndex: dictActiveIndex,
    entriesByTab,
    loadAvailableDictionaries,
    openDictionary,
    closeDictionary,
    setActiveTab: setDictActiveTab,
    reorderTabs: reorderDictTabs,
  } = useDictionaryPanel(panelId);

  const textSettings = useTextSettingsStore(state => state.getSettings('book'));

  /*
    The kind of module this pane holds, fixed for its lifetime. Books and
    dictionaries are segregated rather than sharing one pane and one tab strip
    with a "which half is showing" state the user could flip, so this is a prop
    rather than state and every list below filters by it.
  */
  const paneKind: 'book' | 'dictionary' = props.paneKind ?? 'book';
  const isDictionaryPane = paneKind === 'dictionary';
  const [showSelector, setShowSelector] = useState(false);
  const [selectorSearchQuery, setSelectorSearchQuery] = useState('');
  /*
    The Overview shelf. Not a third kind of tab: it is rendered as
    `prefixContent`, owns no `role="tab"`, and leaves the tab selection
    untouched so dismissing it returns to whatever was showing before - the same
    shape CommentaryPane uses.

    Until the reader says otherwise it follows the pane: open while there is
    nothing to show, closed once there is. That is what "navigating to
    Dictionary should land on Overview" means - the shelf is how you *find* a
    module, so it is the right first thing to see when you have none open and
    the wrong one when you already have the module you came for.

    It has to be an effect rather than a lazy initial value, because a tab
    arriving *after* mount is the normal case: a session restore and a detached
    window both seed the store from an effect, so deciding once at mount left a
    pane full of tabs sitting on the shelf with its content unreachable.
  */
  const [overviewActive, setOverviewActive] = useState(true);
  /** Set once the reader opens or dismisses the shelf themselves. */
  const shelfChosenByUser = useRef(false);
  const ownTabCount = (isDictionaryPane ? dictTabs : bookTabs).length;
  useEffect(() => {
    if (shelfChosenByUser.current) return;
    setOverviewActive(ownTabCount === 0);
  }, [ownTabCount]);

  /*
    Something outside the pane opened a dictionary tab here - a Strong's-number
    click in the Bible pane - and needs it brought forward. The pane has no
    halves to switch between, but the Overview shelf covers the content, so a
    lookup arriving underneath it would be invisible.
  */
  useEffect(() => {
    const onShowDictionary = (event: Event): void => {
      const detail = (event as CustomEvent<ShowDictionaryPaneDetail>).detail;
      if (detail?.panelId !== panelId) return;
      setOverviewActive(false);
    };
    window.addEventListener(SHOW_DICTIONARY_PANE_EVENT, onShowDictionary);
    return () => window.removeEventListener(SHOW_DICTIONARY_PANE_EVENT, onShowDictionary);
  }, [panelId]);

  // Context menu for internal tabs (right-click -> "Pop Out to Window")
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabType: 'book' | 'dictionary'; abbreviation: string } | null>(null);

  const dismissTabContextMenu = useCallback(() => setTabContextMenu(null), []);
  useOverlayDismissal(!!tabContextMenu, dismissTabContextMenu);

  // Move focus into the menu when it opens. Without this the items are rendered
  // at the very end of the pane, so reaching them by keyboard meant tabbing
  // through the whole section body first.
  const tabContextMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tabContextMenu) tabContextMenuRef.current?.querySelector('button')?.focus();
  }, [tabContextMenu]);

  // "Pop Out to Window".
  //
  // One step to a real window, carrying the module and the verse the reader is
  // on. Routing via "open in own panel" - another dockview panel *inside* this
  // window - leaves a reader who wants a separate window hunting for a second
  // pop-out on that panel's tab, and that second step comes up empty: a
  // single-module panel keeps its state locally and writes nothing to the
  // store. See `utils/popOutModule.ts`.
  const handlePopOutTab = useCallback((tabType: 'book' | 'dictionary', abbreviation: string) => {
    setTabContextMenu(null);
    const tabs = tabType === 'book' ? bookTabs : dictTabs;
    const tab = tabs.find(t => t.abbreviation === abbreviation);
    if (!tab) return;

    void popOutModuleToWindow({
      type: tabType,
      abbreviation,
      name: tab.name || cleanModuleName(abbreviation),
    }).then(ok => {
      // Only give up the tab once the window is actually open, or a failed
      // detach would close the module and leave nothing in its place.
      if (!ok) return;
      if (tabType === 'book') {
        closeBook(abbreviation);
      } else {
        closeDictionary(abbreviation);
      }
    });
  }, [bookTabs, dictTabs, closeBook, closeDictionary]);

  const handleSplitBookTab = useCallback((tabType: 'book' | 'dictionary', abbreviation: string, direction: 'right' | 'below') => {
    setTabContextMenu(null);
    const tabs = tabType === 'book' ? bookTabs : dictTabs;
    const tab = tabs.find(t => t.abbreviation === abbreviation);
    if (!tab) return;

    const dockApi = useLayoutStore.getState().dockviewApi; // allow-getstate: event handler - dockview API access outside render
    const currentPanel = dockApi?.getPanel(panelId);
    const position = currentPanel
      ? { referencePanel: currentPanel, direction }
      : undefined;

    const subtitle = tabType === 'book'
      ? t('bookPane.bookPanelSubtitle')
      : t('bookPane.dictionaryPanelSubtitle');
    useLayoutStore.getState().addPanel(tabType, abbreviation, cleanModuleName(abbreviation), position, subtitle); // allow-getstate: event handler - imperative panel creation
    if (tabType === 'book') {
      closeBook(abbreviation);
    } else {
      closeDictionary(abbreviation);
    }
  }, [bookTabs, dictTabs, closeBook, closeDictionary, panelId, t]);

  /*
    The tab strip, in the order the user opened (or dragged) the tabs into.

    `tabOrder` on the book panel state is the source of truth; this reconciles
    it against what is actually open, so a module opened by any route (the
    selector, a Strong's-number click, a session restore) still shows up.

    Only this pane's own kind is passed in, so a Books pane that happens to
    share panel state with a dictionary tab simply does not list it, and
    `mergeTabOrder`'s "drop refs for modules that are not open" rule prunes the
    other kind on the next write.
  */
  const displayOrder = useMemo(
    () => mergeTabOrder(
      tabOrder,
      isDictionaryPane ? [] : bookTabs.map(tab => tab.abbreviation),
      isDictionaryPane ? dictTabs.map(tab => tab.abbreviation) : [],
    ),
    [tabOrder, bookTabs, dictTabs, isDictionaryPane],
  );

  // Persist the reconciled order so the *next* tab to open is appended after
  // this one rather than sorted in by type. Idempotent - `mergeTabOrder`
  // returns an equal list for input it already produced - so this settles
  // after one write rather than looping.
  useEffect(() => {
    if (!sameTabOrder(tabOrder, displayOrder)) {
      setTabOrder(displayOrder);
    }
  }, [tabOrder, displayOrder, setTabOrder]);

  const allTabs: (TabItem & { type: 'book' | 'dictionary'; abbreviation: string })[] = displayOrder.map(ref => ({
    id: ref.type === 'book' ? `book-${ref.abbreviation}` : `dict-${ref.abbreviation}`,
    label: cleanModuleName(ref.abbreviation),
    // Announced as part of the tab's accessible name ("Matthew Henry Book"),
    // which is where the tab's type lives now that the visible marker is a
    // decorative glyph.
    subtitle: ref.type === 'book'
      ? t('bookPane.bookPanelSubtitle')
      : t('bookPane.dictionaryPanelSubtitle'),
    // Shades tabs whose content has already loaded, the same signal
    // CommentaryPane gives - with several modules open there was otherwise no
    // way to tell a loaded tab from one that has never been opened.
    hasContent: ref.type === 'book'
      ? sectionsByTab.get(ref.abbreviation) != null
      : !!entriesByTab.get(ref.abbreviation),
    type: ref.type,
    abbreviation: ref.abbreviation,
  }));

  const effectivePane: 'book' | 'dictionary' = paneKind;

  /*
    Which strip position is active. Found by identity rather than arithmetic:
    with the two types interleaved there is no offset that maps a per-store
    index onto the strip.
  */
  const activeAbbreviation = effectivePane === 'book'
    ? bookTabs[bookActiveIndex]?.abbreviation
    : dictTabs[dictActiveIndex]?.abbreviation;
  const combinedActiveIndex = Math.max(
    0,
    allTabs.findIndex(tab => tab.type === effectivePane && tab.abbreviation === activeAbbreviation),
  );

  /*
    Opening from the Overview shelf. A module that is already a tab is switched
    to rather than reopened: `openBook`/`openDictionary` are themselves
    idempotent, but they do not move the selection, so without this the shelf
    would appear to do nothing when you picked something already open.
  */
  const handleOpenFromOverview = useCallback((
    kind: 'book' | 'dictionary',
    abbreviation: string,
    name: string,
  ) => {
    if (kind === 'book') {
      const existing = bookTabs.findIndex(tab => tab.abbreviation === abbreviation);
      if (existing >= 0) setBookActiveTab(existing);
      else openBook(abbreviation, name);
    } else {
      const existing = dictTabs.findIndex(tab => tab.abbreviation === abbreviation);
      if (existing >= 0) setDictActiveTab(existing);
      else openDictionary(abbreviation, name);
    }
    setOverviewActive(false);
  }, [bookTabs, dictTabs, setBookActiveTab, setDictActiveTab, openBook, openDictionary]);

  const openBookAbbrs = useMemo(() => new Set(bookTabs.map(tab => tab.abbreviation)), [bookTabs]);
  const openDictAbbrs = useMemo(() => new Set(dictTabs.map(tab => tab.abbreviation)), [dictTabs]);

  // Determine which book/dict tabs are active
  const openTabs = bookTabs;
  const activeTabIndex = bookActiveIndex;

  // Get tab-specific data
  const activeTab = openTabs[activeTabIndex];
  const currentSection = activeTab ? sectionsByTab.get(activeTab.abbreviation) || null : null;
  const rawIsLoading = activeTab ? loadingByTab.get(activeTab.abbreviation) || false : false;
  // Section reads are usually sub-100ms local SQLite queries; flipping the
  // loading UI on immediately made every navigation flash the pane.
  const isLoading = useDeferredLoading(rawIsLoading);
  const error = activeTab ? errorByTab.get(activeTab.abbreviation) || null : null;
  const sectionSummaries = activeTab ? sectionSummariesByTab.get(activeTab.abbreviation) ?? NO_SUMMARIES : NO_SUMMARIES;
  const loadingSummaries = activeTab ? loadingSummariesByTab.get(activeTab.abbreviation) || false : false;
  const summariesError = activeTab ? summariesErrorByTab.get(activeTab.abbreviation) || null : null;
  // "Has an entry" rather than "is non-empty": a book with no sections at all,
  // and a book whose summaries query failed, have both been attempted.
  const summariesLoaded = activeTab ? sectionSummariesByTab.has(activeTab.abbreviation) : false;
  const childSections = activeTab ? childSectionsByTab.get(activeTab.abbreviation) ?? NO_SUMMARIES : NO_SUMMARIES;

  // Detached-window state hydration
  useDetachedInit({
    isDetached: props.isDetached,
    panelId,
    openTabs: props.openTabs,
    activeTabIndex: props.activeTabIndex,
    currentSectionByTab: props.currentSectionByTab,
    sectionsByTab: props.sectionsByTab,
    childSectionsByTab: props.childSectionsByTab,
    sectionSummariesByTab: props.sectionSummariesByTab,
  });
  useDictionaryDetachedInit({
    isDetached: props.isDetached,
    panelId,
    dictOpenTabs: props.dictOpenTabs,
    dictActiveTabIndex: props.dictActiveTabIndex,
    dictEntriesByTab: props.dictEntriesByTab,
  });

  // Load available books and dictionaries on mount
  useEffect(() => {
    if (availableBooks.length === 0) {
      loadAvailableBooks();
    }
    if (availableDictionaries.length === 0) {
      loadAvailableDictionaries();
    }
  }, []);

  // Auto-load section summaries if child sections exist but summaries aren't loaded
  useEffect(() => {
    if (activeTab && childSections.length > 0 && !summariesLoaded && !loadingSummaries) {
      loadSectionSummaries(activeTab.abbreviation);
    }
  }, [activeTab, childSections, summariesLoaded, loadingSummaries]);

  const { nextSectionInfo, prevSectionInfo } = useNavSectionInfo(activeTab, currentSection);

  const loadSummariesForActiveTab = useCallback(() => {
    if (activeTab) loadSectionSummaries(activeTab.abbreviation);
  }, [activeTab, loadSectionSummaries]);

  const handleNavigateNext = () => {
    if (activeTab) navigateToNextSection(activeTab.abbreviation);
  };

  const handleNavigatePrevious = () => {
    if (activeTab) navigateToPreviousSection(activeTab.abbreviation);
  };

  const handleNavigateUp = () => {
    if (!activeTab) return;
    if (currentSection?.parent_section_id) {
      navigateToParentSection(activeTab.abbreviation);
    } else {
      // Up from a top-level section is the book's Home page, not the *first*
      // section: from the first section itself that is a no-op, and from any
      // other top-level section it lands on a title page rather than on
      // anything containing where the reader was.
      navigateToHome(activeTab.abbreviation);
    }
  };

  /*
    Popping a module out is a visible option on the pane menu, not only a tab
    right-click, which is undiscoverable unless you happen to try it. The
    context menu keeps working for anyone who already knows it.
  */
  // Scoped by panelId, same as CommentaryPane's `tabIdPrefix`: several Books
  // panes can be open in one document, and these ids (used for `aria-labelledby`
  // and the tabpanel `id` below) must stay unique across them.
  const tabIdPrefix = `book-dict-${panelId}`;

  const activeUnifiedTab = allTabs[combinedActiveIndex];
  const paneMenuOptions: PaneMenuOption[] = activeUnifiedTab
    ? [{
        id: 'pop-out-to-window',
        icon: BOOK_PANE_TAB_ICONS[activeUnifiedTab.type],
        label: t('bookPane.popOutTabToWindow', { name: activeUnifiedTab.label }),
        onClick: () => handlePopOutTab(activeUnifiedTab.type, activeUnifiedTab.abbreviation),
      }]
    : [];

  return (
    <div className="h-full flex flex-col" data-testid="books-pane" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
      {/* Tab Bar - unified books + dictionaries */}
      <DraggableTabBar
        tabs={allTabs}
        activeTabIndex={overviewActive ? -1 : combinedActiveIndex}
        droppableId="book-dict-tabs"
        onTabClick={(index) => {
          const tab = allTabs[index];
          if (!tab) return;
          setOverviewActive(false);
          if (tab.type === 'book') {
            setBookActiveTab(bookTabs.findIndex(t => t.abbreviation === tab.abbreviation));
          } else {
            setDictActiveTab(dictTabs.findIndex(t => t.abbreviation === tab.abbreviation));
          }
        }}
        onTabClose={(tabId) => {
          // No activePane correction here: `effectivePane` derives the surviving
          // half during render, so there is no frame where the closed half shows.
          const tab = allTabs.find(at => at.id === tabId);
          if (tab?.type === 'book') closeBook(tab.abbreviation);
          else if (tab?.type === 'dictionary') closeDictionary(tab.abbreviation);
        }}
        onReorder={(sourceIndex, destIndex) => {
          /*
            Every tab is draggable to every position. The move is applied to the
            strip order, then mirrored into whichever content store owns the
            dragged tab so both stores' arrays keep matching what is on screen
            (which is what a session or a pop-out serializes).

            Firing only when source *and* destination are books would make a
            dictionary tab lift under the cursor and snap back with no
            explanation.
          */
          const sourceTab = allTabs[sourceIndex];
          if (!sourceTab) return;

          const nextOrder = moveTab(displayOrder, sourceIndex, destIndex);
          setTabOrder(nextOrder);

          const ref = { type: sourceTab.type, abbreviation: sourceTab.abbreviation };
          const ownStoreTabs = sourceTab.type === 'book' ? bookTabs : dictTabs;
          const fromIndex = ownStoreTabs.findIndex(t => t.abbreviation === sourceTab.abbreviation);
          const toIndex = indexWithinType(nextOrder, ref);
          if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
            if (sourceTab.type === 'book') reorderBookTabs(fromIndex, toIndex);
            else reorderDictTabs(fromIndex, toIndex);
          }
        }}
        paneMenuOptions={paneMenuOptions}
        onAddClick={() => setShowSelector(true)}
        addButtonTitle={isDictionaryPane
          ? t('bookPane.addDictionaryTabTitle')
          : t('bookPane.addBookTabTitle')}
        ariaLabel={isDictionaryPane
          ? t('bookPane.dictionaryTabsAriaLabel')
          : t('bookPane.bookTabsAriaLabel')}
        idPrefix={tabIdPrefix}
        renderTab={(tab, _index, isActive) => {
          const unified = tab as TabItem & { type: string; abbreviation: string };
          return (
            <div
              className="flex items-center gap-1.5"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const menuTab = allTabs.find(at => at.id === tab.id);
                if (!menuTab) return;
                // Keyboard-invoked context menus (Shift+F10, Menu key) report
                // 0,0, which would drop the menu in the window corner instead
                // of on the tab it belongs to.
                const isKeyboardInvoked = e.clientX === 0 && e.clientY === 0;
                const rect = e.currentTarget.getBoundingClientRect();
                setTabContextMenu({
                  x: isKeyboardInvoked ? rect.left : e.clientX,
                  y: isKeyboardInvoked ? rect.bottom : e.clientY,
                  tabType: menuTab.type,
                  abbreviation: menuTab.abbreviation,
                });
              }}
            >
              {/*
                Type marker on *both* kinds of tab, using the same glyphs the
                dockview header uses. A 9px "Dict" badge on dictionary tabs
                alone would mark a book tab by the absence of a badge - nothing
                to read if you did not already know the rule.
                Decorative: the type is carried for assistive tech by the tab's
                accessible name (see `subtitle` above).
              */}
              <span
                aria-hidden="true"
                className="text-[11px] leading-none select-none"
                data-testid={`book-tab-icon-${unified.type}`}
              >
                {BOOK_PANE_TAB_ICONS[unified.type === 'dictionary' ? 'dictionary' : 'book']}
              </span>
              <span className={`whitespace-nowrap ${isActive ? 'font-semibold' : ''}`}>
                {tab.label}
              </span>
              <button
                type="button"
                className="text-sm leading-none p-0.5 rounded hover:text-danger hover:bg-danger-soft opacity-60 hover:opacity-100 transition-colors"
                aria-label={t('bookPane.closeTabLabel', { name: tab.label })}
                onClick={(e) => {
                  e.stopPropagation();
                  const ct = allTabs.find(at => at.id === tab.id);
                  if (ct?.type === 'book') closeBook(ct.abbreviation);
                  else if (ct?.type === 'dictionary') closeDictionary(ct.abbreviation);
                }}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </div>
          );
        }}
        prefixContent={
          <button
            type="button"
            data-testid="library-overview-tab"
            aria-pressed={overviewActive}
            onClick={() => {
              shelfChosenByUser.current = true;
              setOverviewActive(prev => !prev);
            }}
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
            title={isDictionaryPane
              ? t('bookPane.dictionaryOverviewTitle')
              : t('bookPane.bookOverviewTitle')}
          >
            {/*
              Books call this "New Tab": with the dictionaries gone the shelf is
              a list of books you have not opened yet, which is what pressing +
              is for. Dictionaries keep "Overview" - it is the pane's home, and
              the one a reader lands on.
            */}
            <span aria-hidden="true">
              {isDictionaryPane ? BOOK_PANE_TAB_ICONS.dictionary : '+'}
            </span>
            <span className="whitespace-nowrap">
              {isDictionaryPane
                ? t('bookPane.overviewLabel')
                : t('bookPane.newTabLabel')}
            </span>
          </button>
        }
      />

      {/* Overview shelf - takes the whole content area. Lists only this pane's
          own kind of module. */}
      {overviewActive && (
        <div className="flex-1 overflow-hidden">
          <LibraryHome
            kind={paneKind}
            books={availableBooks}
            dictionaries={availableDictionaries}
            openBooks={openBookAbbrs}
            openDictionaries={openDictAbbrs}
            loadingBooks={loadingBooks}
            loadingDictionaries={loadingDictionaries}
            onOpen={handleOpenFromOverview}
            onInstall={openModuleManager}
          />
        </div>
      )}

      {/* Dictionary content - when a dictionary tab is active */}
      {!overviewActive && effectivePane === 'dictionary' && dictTabs.length > 0 && (
        <div
          className="flex-1 overflow-hidden"
          id={`${tabIdPrefix}-panel-${combinedActiveIndex}`}
          role="tabpanel"
          aria-labelledby={`${tabIdPrefix}-tab-${combinedActiveIndex}`}
        >
          <DictionaryPane hideTabs panelId={panelId} />
        </div>
      )}

      {/* Book navigation toolbar */}
      {!overviewActive && effectivePane === 'book' && openTabs.length > 0 && activeTab && currentSection && (
        <BookNavigationToolbar
          isLoading={isLoading}
          currentSection={currentSection}
          nextSectionInfo={nextSectionInfo}
          prevSectionInfo={prevSectionInfo}
          onPrevious={handleNavigatePrevious}
          onNext={handleNavigateNext}
          onUp={handleNavigateUp}
        />
      )}

      {/*
        Content Area (books only, dictionaries render above).

        Suppressed entirely when the pane holds nothing at all: the
        pane-wide empty state below covers that case, and rendering
        both stacked two empty states on top of each other.
      */}
      {!overviewActive && effectivePane === 'book' && allTabs.length > 0 && <div
        className="flex-1 overflow-auto pane-content-book"
        id={`${tabIdPrefix}-panel-${combinedActiveIndex}`}
        role="tabpanel"
        aria-labelledby={`${tabIdPrefix}-tab-${combinedActiveIndex}`}
        style={{
          '--pane-font-family-book': getFontFamilyCSS(textSettings.fontFamily),
          '--pane-font-size-book': `${textSettings.fontSize}px`,
          '--pane-line-height-book': textSettings.lineHeight
        } as React.CSSProperties}
      >
        {/*
          There is deliberately no "no books open" branch here: this block only
          renders when `effectivePane === 'book'`, which (given `allTabs` is
          non-empty) can only happen with at least one book tab open. The
          pane-wide empty state below covers the genuinely-empty case.
        */}
        {isLoading ? (
          <PaneLoadingSkeleton testId="book-loading-skeleton" />
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-danger">{error}</div>
          </div>
        ) : !currentSection || !activeTab ? (
          /*
            The book's Home page - its table of contents and a search box over
            its full text. The contents *are* the landing page, rather than an
            empty state apologising that "no chapter is showing yet" above a
            button that opens them in a modal.
          */
          <BookHome
            abbreviation={activeTab?.abbreviation ?? ''}
            name={activeTab?.name ?? ''}
            summaries={sectionSummaries}
            isLoading={loadingSummaries}
            error={summariesError}
            onRetry={loadSummariesForActiveTab}
            onSelectSection={(sectionId) => {
              if (activeTab) navigateToSection(activeTab.abbreviation, sectionId);
            }}
          />
        ) : (
          <BookSectionContent
            activeTab={activeTab}
            currentSection={currentSection}
            childSections={childSections}
            sectionSummaries={sectionSummaries}
            prevSectionInfo={prevSectionInfo}
            nextSectionInfo={nextSectionInfo}
            navigateToSection={navigateToSection}
            navigateToHome={navigateToHome}
          />
        )}
      </div>}

      {/* No tabs open in this pane */}
      {!overviewActive && allTabs.length === 0 && (
        <div className="flex-1 flex flex-col">
          {isDictionaryPane ? (
            <PaneEmptyState
              icon="🔍"
              testId="book-dict-empty-state"
              title={t('onboarding.empty.dictionaryShelf.title')}
              description={t('onboarding.empty.dictionaryShelf.description')}
              actions={[
                availableDictionaries.length === 0
                  ? {
                      label: t('onboarding.empty.library.dictionaryInstall'),
                      onClick: () => openModuleManager('dictionary'),
                      primary: true,
                      testId: 'library-empty-dictionary-install',
                    }
                  : {
                      label: t('onboarding.empty.library.dictionaryAction'),
                      onClick: () => setShowSelector(true),
                      primary: true,
                      testId: 'library-empty-dictionary',
                    },
              ]}
            />
          ) : (
            <PaneEmptyState
              icon="📚"
              testId="book-dict-empty-state"
              title={t('onboarding.empty.bookShelf.title')}
              description={t('onboarding.empty.bookShelf.description')}
              actions={[
                availableBooks.length === 0
                  ? {
                      label: t('onboarding.empty.library.bookInstall'),
                      onClick: () => openModuleManager('book'),
                      primary: true,
                      testId: 'library-empty-book-install',
                    }
                  : {
                      label: t('onboarding.empty.library.bookAction'),
                      onClick: () => setShowSelector(true),
                      primary: true,
                      testId: 'library-empty-book',
                    },
              ]}
            />
          )}
        </div>
      )}

      {/* Module Selector Modal */}
      {showSelector && (
        <BookModuleSelectorModal
          selectorType={paneKind}
          selectorSearchQuery={selectorSearchQuery}
          setSelectorSearchQuery={setSelectorSearchQuery}
          availableBooks={availableBooks}
          availableDictionaries={availableDictionaries}
          bookTabs={bookTabs}
          dictTabs={dictTabs}
          loadingBooks={loadingBooks}
          loadingDictionaries={loadingDictionaries}
          onClose={() => { setShowSelector(false); setSelectorSearchQuery(''); }}
          onSelectBook={(abbreviation, name) => {
            openBook(abbreviation, name);
            setOverviewActive(false);
            setShowSelector(false);
            setSelectorSearchQuery('');
          }}
          onSelectDictionary={(abbreviation, name) => {
            openDictionary(abbreviation, name);
            setOverviewActive(false);
            setShowSelector(false);
            setSelectorSearchQuery('');
          }}
        />
      )}

      {/* Tree View Modal */}
      {/* Internal tab context menu */}
      {tabContextMenu && (
        <div
          ref={tabContextMenuRef}
          role="menu"
          aria-label={t('bookPane.tabMenuLabel')}
          onKeyDown={(e) => { if (e.key === 'Escape') dismissTabContextMenu(); }}
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
          onMouseDown={(e) => e.stopPropagation()}
        >
          <BookTabMenuItem label={t('ui.dockviewTab.popOutToWindow')} onClick={() => handlePopOutTab(tabContextMenu.tabType, tabContextMenu.abbreviation)} />
          <BookTabMenuItem label={t('bookPane.splitRight')} onClick={() => handleSplitBookTab(tabContextMenu.tabType, tabContextMenu.abbreviation, 'right')} />
          <BookTabMenuItem label={t('bookPane.splitDown')} onClick={() => handleSplitBookTab(tabContextMenu.tabType, tabContextMenu.abbreviation, 'below')} />
          {allTabs.length > 1 && (
            <>
              <div style={{ height: '1px', backgroundColor: 'var(--theme-border-primary)', margin: '4px 0' }} />
              <BookTabMenuItem
                label={t('bookPane.closeTab')}
                onClick={() => {
                  setTabContextMenu(null);
                  if (tabContextMenu.tabType === 'book') closeBook(tabContextMenu.abbreviation);
                  else closeDictionary(tabContextMenu.abbreviation);
                }}
              />
            </>
          )}
        </div>
      )}

    </div>
  );
};

export default BookPane;
