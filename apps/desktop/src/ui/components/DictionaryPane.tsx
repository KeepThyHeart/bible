import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StrongsNumberHelper, dictionaryDefinitionToHtml } from '@bible/core';
import { useI18n } from '../contexts/useI18n';
import {
  useDictionaryStore,
  type DictionaryEntrySummary,
  type RecentLookup,
} from '../stores/useDictionaryStore';
import { useDictionaryPanel } from '../stores/hooks/useDictionaryPanel';
import { DEFAULT_PANEL_ID } from '../stores/helpers/panelStateHelpers';
import { useTextSettingsStore, getFontFamilyCSS } from '../stores/useTextSettingsStore';
import { formatVerseReference } from '../utils/verseReference';
import { cleanModuleName } from '../utils/verseFormatting';
import ModuleSelector, { ModuleItem } from './ModuleSelector';
import DictionaryLiveSearch from './dictionary/DictionaryLiveSearch';
import { sanitizeHtml } from '../utils/sanitize';
import ToolbarPopover from './bible/ToolbarPopover';
import { PaneOverlay } from './shared/PaneOverlay';
import PassageSettingsMenu from './bible/PassageSettingsMenu';
import {
  PaneToolbar,
  PaneToolbarButton,
  BackIcon,
  ForwardIcon,
  HistoryIcon,
} from './shared/PaneToolbar';
import PaneEmptyState from './onboarding/PaneEmptyState';
import PaneLoadingSkeleton from './onboarding/PaneLoadingSkeleton';
import { openModuleManager } from '../utils/openModuleManager';
import { useTabKeyboardNav } from '../hooks/useTabKeyboardNav';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useOverlayDismissal } from '../hooks/useOverlayDismissal';
import { useSessionStore } from '../stores/useSessionStore';
import { useSearchStore } from '../stores/useSearchStore';
import { useDeferredLoading } from '../hooks/useDeferredLoading';

interface DictionaryPaneProps {
  /** When true, hides the tab bar (for embedding inside BookPane) */
  hideTabs?: boolean;
  /** Panel instance ID for per-panel state */
  panelId?: string;
}

/**
 * How many entries one page of the Browse dialog holds. There is no
 * entry-count API for dictionaries, so the dialog pages with "Load more" and
 * stops when a page comes back short, rather than reporting "N of M".
 */
const BROWSE_PAGE_SIZE = 100;

/**
 * How many matches the as-you-type list offers. Deep enough that a misspelled
 * name is still in it, short enough that the panel stays a glance rather than a
 * scroll.
 */
const LIVE_SEARCH_LIMIT = 25;

/**
 * Stable empty array for tabs that have no results yet. A fresh `[]` per render
 * would change identity every time and re-fire the effects downstream of it.
 */
/**
 * The Strong's number an entry represents, or null for an ordinary dictionary.
 *
 * Strong's entry keys are 5-digit zero-padded and carry no prefix ("00025"),
 * so the G/H comes from which of the two lexicons the tab is showing. Mirrors
 * `strongsNumberFor` in the web app's DictionaryContent, deliberately - the two
 * panes have to agree about what a key means.
 */
function strongsNumberFor(moduleAbbr: string, entryKey: string): string | null {
  if (!/^strongs/i.test(moduleAbbr)) return null;
  const digits = entryKey.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return null;
  return `${/hebrew/i.test(moduleAbbr) ? 'H' : 'G'}${digits}`;
}

const NO_RESULTS: DictionaryEntrySummary[] = [];

/**
 * What a "Recent" row should call the entry.
 *
 * History stores the dictionary's own key, which for a Strong's lexicon is the
 * zero-padded storage form ("00025") rather than the "G25" the user typed or
 * clicked - unreadable as a study trail. The G/H prefix is not in the key, so
 * it has to come from the module; only the Strong's lexicons imply one, and
 * anything else keeps its raw key rather than risking a wrong letter.
 */
function formatRecentKey(abbreviation: string, entryKey: string): string {
  const abbr = abbreviation.toLowerCase();
  const prefix = abbr.includes('strongsgreek') ? 'G' : abbr.includes('strongshebrew') ? 'H' : null;
  if (!prefix) return entryKey;
  return StrongsNumberHelper.toDisplayFormat(`${prefix}${entryKey}`) ?? entryKey;
}

const DictionaryPane: React.FC<DictionaryPaneProps> = ({ hideTabs = false, panelId = DEFAULT_PANEL_ID }) => {
  const { t } = useI18n();
  const {
    availableDictionaries,
    loadingDictionaries,
    openTabs,
    activeTabIndex,
    entriesByTab,
    loadingByTab,
    errorByTab,
    allEntriesByTab,
    loadingAllEntriesByTab,
    allEntriesCompleteByTab,
    searchResultsByTab,
    searchingByTab,
    loadAvailableDictionaries,
    openDictionary,
    closeDictionary,
    setActiveTab,
    lookupEntry,
    searchDictionary,
    loadAllEntries,
    clearError,
    navHistory,
    navIndex,
    goBack,
    goForward,
  } = useDictionaryPanel(panelId);

  const recentLookups = useDictionaryStore(s => s.recentLookups);

  const textSettings = useTextSettingsStore(state => state.getSettings('dictionary'));

  const [showSelector, setShowSelector] = useState(false);
  const [lookupInput, setLookupInput] = useState('');
  const [showRecentDropdown, setShowRecentDropdown] = useState(false);
  const [showBrowseModal, setShowBrowseModal] = useState(false);
  // Browse-dialog search. `browseSearchActive` is tracked separately from
  // `searchResults.length` so a search that matches nothing shows "no matches"
  // instead of silently falling back to the full entry list, which looked like
  // the search had been ignored.
  const [browseQuery, setBrowseQuery] = useState('');
  const [browseSearchActive, setBrowseSearchActive] = useState(false);

  // Panel lifecycle
  useEffect(() => {
    useDictionaryStore.getState().initPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    return () => {
      // detach, NOT destroy: this component unmounts on an ordinary tab
      // switch (and twice per mount under StrictMode). Only dockview's
      // onDidRemovePanel means the pane is really gone - see
      // `destroyPanelState` in stores/helpers/panelDisposal.ts.
      useDictionaryStore.getState().detachPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    };
  }, [panelId]);

  // Load available dictionaries on mount
  useEffect(() => {
    if (availableDictionaries.length === 0) {
      loadAvailableDictionaries();
    }
  }, []);

  const activeTab = openTabs[activeTabIndex];
  const currentEntry = activeTab ? entriesByTab.get(activeTab.abbreviation) || null : null;
  const rawIsLoading = activeTab ? loadingByTab.get(activeTab.abbreviation) || false : false;
  // Brief lookups (cache hit, fast query) shouldn't flicker a loading UI in
  // at all - only fetches still running past 80ms show it.
  const isLoading = useDeferredLoading(rawIsLoading);
  const error = activeTab ? errorByTab.get(activeTab.abbreviation) || null : null;
  // Whether startup session restore has resolved yet. Gates the "no
  // dictionary open" onboarding empty state below: without this, that empty
  // state (with its install/choose-a-dictionary buttons) flashes on every
  // app startup before the session restore populates openTabs.
  const isSessionLoaded = useSessionStore(state => state.isSessionLoaded);
  const allEntries = activeTab ? allEntriesByTab.get(activeTab.abbreviation) || [] : [];
  const loadingAllEntries = activeTab ? loadingAllEntriesByTab.get(activeTab.abbreviation) || false : false;
  /** False until a page comes back short - see BROWSE_PAGE_SIZE. */
  const allEntriesComplete = activeTab ? allEntriesCompleteByTab.get(activeTab.abbreviation) || false : false;
  const searchResults = (activeTab ? searchResultsByTab.get(activeTab.abbreviation) : undefined) ?? NO_RESULTS;
  const searchStrongsNumber = useSearchStore((state) => state.searchStrongsNumber);
  // Null for an ordinary dictionary, which has no Bible-wide occurrences to look up.
  const strongsSearchNumber = activeTab && currentEntry
    ? strongsNumberFor(activeTab.abbreviation, currentEntry.entry_key)
    : null;
  const isSearching = activeTab ? searchingByTab.get(activeTab.abbreviation) || false : false;
  /** What the Browse dialog lists: search hits while a search is active, else the full list. */
  const browseEntries = browseSearchActive ? searchResults : allEntries;

  /** Strong's numbers are stored zero-padded: "G3588"/"H0430" -> "03588"/"00430". */
  const normalizeLookupKey = (raw: string): string => {
    const strongsMatch = raw.match(/^[GgHh](\d+)$/);
    return strongsMatch ? strongsMatch[1].padStart(5, '0') : raw;
  };

  /**
   * The as-you-type search behind the box, debounced by `DictionaryLiveSearch`.
   *
   * The query is normalised the same way an exact lookup is, so typing "G25"
   * searches for the stored key "00025" - without that, a Strong's number
   * matches nothing by title and the list looks broken for the one input the
   * pane most obviously invites.
   *
   * Results land in the store's `searchResultsByTab`, the same slot the Browse
   * dialog reads. Only one of the two can be typed into at a time, so they
   * cannot fight; the dialog simply opens showing whatever was last searched
   * for, which is the useful thing anyway.
   */
  const activeAbbreviation = activeTab?.abbreviation;
  const runLiveSearch = useCallback(
    (query: string) => {
      if (!activeAbbreviation) return;
      searchDictionary(activeAbbreviation, normalizeLookupKey(query), LIVE_SEARCH_LIMIT);
    },
    [activeAbbreviation, searchDictionary],
  );

  const openEntry = useCallback(
    (entryKey: string) => {
      if (!activeAbbreviation) return;
      lookupEntry(activeAbbreviation, entryKey);
    },
    [activeAbbreviation, lookupEntry],
  );

  /**
   * What Enter does when the live list has nothing to open - a term submitted
   * before the debounce fired, or one the search genuinely misses.
   *
   * It cascades: exact key -> text search -> open a single unambiguous hit, or
   * show the matches to choose from. Only when both find nothing does the
   * not-found state appear. The typed term is deliberately left in the box
   * throughout; clearing it meant a failed lookup left the user with neither a
   * result nor the word they typed.
   */
  const handleLookup = async (term: string) => {
    if (!activeTab) return;
    const trimmed = term.trim();
    if (!trimmed) return;

    const abbr = activeTab.abbreviation;
    const key = normalizeLookupKey(trimmed);

    await lookupEntry(abbr, key);
    // allow-getstate: async continuation - needs the value written by the await above, not a render-time snapshot
    if (useDictionaryStore.getState().getPanelState(panelId).entriesByTab.get(abbr)) {
      return; // exact hit
    }

    await searchDictionary(abbr, key, 50);
    // allow-getstate: async continuation - see above
    const results = useDictionaryStore.getState().getPanelState(panelId).searchResultsByTab.get(abbr) || [];

    if (results.length === 1) {
      await lookupEntry(abbr, results[0].entry_key);
      return;
    }

    if (results.length > 1) {
      // Drop the "no entry for X" error from the exact-key miss: we did find
      // matches, so leaving it behind the dialog would contradict the list.
      clearError(abbr);
      setBrowseQuery(trimmed);
      setBrowseSearchActive(true);
      setShowBrowseModal(true);
    }

    // Zero results: the not-found state from the exact lookup is still showing,
    // which is now accurate, and it offers Search/Browse as the next steps.
  };

  const runBrowseSearch = (rawQuery: string) => {
    if (!activeTab) return;
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      // Empty query means "show everything again".
      setBrowseSearchActive(false);
      if (allEntries.length === 0) {
        loadAllEntries(activeTab.abbreviation, BROWSE_PAGE_SIZE);
      }
      return;
    }
    setBrowseSearchActive(true);
    searchDictionary(activeTab.abbreviation, normalizeLookupKey(trimmed), 50);
  };

  /** Fetch the next page and append it, keeping the reader's scroll position. */
  const loadMoreEntries = () => {
    if (!activeTab) return;
    loadAllEntries(activeTab.abbreviation, BROWSE_PAGE_SIZE, allEntries.length, true);
  };

  /**
   * "Recent" is a cross-module study trail, not a per-dictionary history.
   *
   * Looking a row up in whichever tab happens to be active would break this: a
   * Strong's key clicked while Easton's is focused would silently find nothing
   * and wipe the entry being read. Activate the module the entry came from
   * first - `openDictionary` both switches to an open tab and adds a missing one.
   */
  const handleSelectFromRecent = (item: RecentLookup) => {
    setShowRecentDropdown(false);
    const name = availableDictionaries.find(d => d.abbreviation === item.abbreviation)?.name
      ?? openTabs.find(tab => tab.abbreviation === item.abbreviation)?.name
      ?? cleanModuleName(item.abbreviation);
    openDictionary(item.abbreviation, name);
    lookupEntry(item.abbreviation, item.entry_key);
  };

  const handleSelectFromBrowse = (entryKey: string) => {
    if (activeTab) {
      lookupEntry(activeTab.abbreviation, entryKey);
      setShowBrowseModal(false);
    }
  };

  const handleRelatedWordClick = (relatedKey: string) => {
    if (activeTab) {
      lookupEntry(activeTab.abbreviation, relatedKey);
    }
  };

  const browseDialogRef = useFocusTrap<HTMLDivElement>(showBrowseModal);

  /** What the portalled Recent menu measures its position from. */
  const recentAnchorRef = useRef<HTMLDivElement>(null);

  // The Recent menu must close on a click away or an Escape press, not only by
  // re-clicking its toggle - otherwise it floats over the entry text.
  const dismissRecentDropdown = useCallback(() => setShowRecentDropdown(false), []);
  useOverlayDismissal(showRecentDropdown, dismissRecentDropdown);

  /*
   * Ids are per-panel. Two Books/Dictionary panes can be on screen at once, and
   * a duplicated `dictionary-tabpanel` made `aria-controls` resolve to whichever
   * copy the browser found first - potentially the pane in the other dock group.
   */
  const tabpanelId = `dictionary-tabpanel-${panelId}`;
  const tabIdFor = (abbreviation: string): string => `dictionary-tab-${panelId}-${abbreviation}`;

  const { tablistRef, onKeyDown: onTablistKeyDown } = useTabKeyboardNav({
    tabCount: openTabs.length,
    activeIndex: activeTabIndex,
    onActivate: setActiveTab,
  });

  return (
    <div className="h-full flex flex-col" data-testid="dictionary-pane" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
      {/* Tab Bar (hidden when embedded in BookPane) */}
      {!hideTabs && (
        <div className="flex items-start border-b border-border bg-background-warm px-sm py-xs">
          <div
            className="flex-1 flex flex-wrap items-center gap-1"
            role="tablist"
            aria-label={t('dictionaryPane.openDictionariesLabel')}
            ref={tablistRef}
            onKeyDown={onTablistKeyDown}
          >
            {openTabs.map((tab, index) => {
              const isActive = index === activeTabIndex;
              const name = cleanModuleName(tab.abbreviation);
              // With several dictionaries open, shading the ones that actually
              // returned an entry saves clicking through each to find out.
              // Same `bg-warning-soft` cue DraggableTabBar uses for commentary.
              const hasContent = !!entriesByTab.get(tab.abbreviation);
              return (
                <div
                  key={tab.abbreviation}
                  className={`
                    flex items-center gap-1 px-2 py-1
                    border-b-2 transition-colors text-sm
                    ${hasContent ? 'bg-warning-soft' : ''}
                    ${
                      isActive
                        ? 'border-accent text-accent font-semibold'
                        : 'border-transparent text-text-secondary hover:text-text-primary'
                    }
                  `}
                  data-has-content={hasContent ? 'true' : undefined}
                >
                  {/*
                    Tab and close are siblings, never nested - a button inside a
                    button is invalid and hides the inner control from AT.
                  */}
                  <button
                    type="button"
                    role="tab"
                    id={tabIdFor(tab.abbreviation)}
                    aria-selected={isActive}
                    aria-controls={tabpanelId}
                    tabIndex={isActive ? 0 : -1}
                    className="whitespace-nowrap cursor-pointer"
                    onClick={() => setActiveTab(index)}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    className="text-xs hover:text-danger"
                    aria-label={t('dictionaryPane.closeDictionary', { name })}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeDictionary(tab.abbreviation);
                    }}
                  >
                    <span aria-hidden="true">✕</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Add Dictionary Button */}
          <button
            type="button"
            className="px-2 py-1 text-accent hover:bg-accent hover:text-text-on-accent rounded transition-colors flex-shrink-0"
            onClick={() => setShowSelector(true)}
            aria-label={t('dictionaryPane.addDictionary')}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
      )}

      {/* Toolbar */}
      {openTabs.length > 0 && activeTab && (
        <PaneToolbar
          ariaLabel={t('dictionaryPane.toolbarLabel')}
          testId="dictionary-toolbar"
          trailing={<PassageSettingsMenu paneKey="dictionary" />}
        >
          {/*
            Back / forward / history, in the Bible pane's own shape and order.

            A dictionary is a place you wander: one entry names three more, and
            following them is the point. Until now the only way back was to
            retype what you had just left. `Recent` was the nearest thing, and
            it was a text button with a caret rather than the clock the Bible
            pane uses for the same list - the same gesture wearing two faces.
          */}
          <PaneToolbarButton
            onClick={() => { void goBack(); }}
            disabled={navIndex <= 0}
            label={t('dictionaryPane.goBackTitle')}
            testId="dictionary-back"
          >
            <BackIcon />
          </PaneToolbarButton>
          <PaneToolbarButton
            onClick={() => { void goForward(); }}
            disabled={navIndex < 0 || navIndex >= navHistory.length - 1}
            label={t('dictionaryPane.goForwardTitle')}
            testId="dictionary-forward"
          >
            <ForwardIcon />
          </PaneToolbarButton>
          <div className="relative flex items-stretch" ref={recentAnchorRef}>
            <PaneToolbarButton
              onClick={() => setShowRecentDropdown(!showRecentDropdown)}
              // Keep the document-level dismissal from closing the menu a beat
              // before this button's own click would toggle it back open.
              onMouseDown={(e) => e.stopPropagation()}
              disabled={recentLookups.length === 0}
              strongDivider
              label={t('dictionaryPane.recentLookups')}
              testId="dictionary-recent-toggle"
              aria-expanded={showRecentDropdown}
              aria-haspopup="menu"
            >
              <HistoryIcon />
            </PaneToolbarButton>
            {showRecentDropdown && recentLookups.length > 0 && (
              // Portalled, like the Bible pane's history menu: the toolbar clips
              // its own overflow, and dockview's `contain: layout` on the pane
              // outranks an absolutely-positioned menu inside it.
              <ToolbarPopover
                anchorRef={recentAnchorRef}
                align="start"
                aria-label={t('dictionaryPane.recentLookups')}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-1.5 text-xs font-semibold text-text-secondary border-b border-border bg-surface-secondary">
                  {t('dictionaryPane.recentHeading')}
                </div>
                <div className="max-h-[300px] overflow-y-auto" data-testid="dictionary-recent-menu">
                  {recentLookups.slice(0, 10).map((item, index) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={index}
                      className="w-full text-start px-md py-sm hover:bg-background-hover cursor-pointer"
                      onClick={() => handleSelectFromRecent(item)}
                      data-testid="dictionary-recent-item"
                    >
                      <span className="block text-sm font-semibold">
                        {formatRecentKey(item.abbreviation, item.entry_key)}
                      </span>
                      {item.word && (
                        <span className="block text-xs text-text-secondary">{item.word}</span>
                      )}
                      {/* The trail spans every dictionary, so each row has to say
                          which one it came from. */}
                      <span className="block text-xs text-text-muted">
                        {cleanModuleName(item.abbreviation)}
                      </span>
                    </button>
                  ))}
                </div>
              </ToolbarPopover>
            )}
          </div>

          {/*
            One large search box whose matches appear underneath it as the user
            types - see `DictionaryLiveSearch`. A separate "Look up" field plus
            a "Search text" field plus a "Browse" dialog would force the user to
            pick, up front, which kind of miss they were about to have.

            No Browse button sits beside it. One would open the whole
            dictionary as a list, which for a Strong's lexicon is 5,700 entries
            with no order a reader can navigate by - the search box is the way
            in, and a second button would only compete with it. The dialog
            itself is still here: `handleLookup` opens it to disambiguate when a
            term matches several entries, which is the case it is actually
            good at.
          */}
          <div className="flex-1 min-w-0 flex items-center px-md">
            <DictionaryLiveSearch
              value={lookupInput}
              onChange={setLookupInput}
              onSearch={runLiveSearch}
              results={searchResults}
              isSearching={isSearching}
              onSelectEntry={openEntry}
              onSubmitFallback={handleLookup}
            />
          </div>
        </PaneToolbar>
      )}

      {/* Content Area */}
      <div
        className="flex-1 overflow-auto pane-content-dictionary"
        id={tabpanelId}
        role={hideTabs ? undefined : 'tabpanel'}
        aria-labelledby={!hideTabs && activeTab ? tabIdFor(activeTab.abbreviation) : undefined}
        style={{
          '--pane-font-family-dictionary': getFontFamilyCSS(textSettings.fontFamily),
          '--pane-font-size-dictionary': `${textSettings.fontSize}px`,
          '--pane-line-height-dictionary': textSettings.lineHeight
        } as React.CSSProperties}
      >
        {openTabs.length === 0 ? (
          !isSessionLoaded ? (
            // Session restore hasn't resolved yet: we don't yet know whether
            // this panel will end up with a tab. Showing the "no dictionary
            // open" onboarding below at this point would flash it on every
            // startup, between first paint and session restore.
            <PaneLoadingSkeleton testId="dictionary-loading-skeleton" />
          ) : (
            // No dictionary chosen yet. Explain what a dictionary module buys
            // you before asking the user to pick one - "No dictionary open" told
            // a first-time user nothing about why they would want one.
            //
            // D2: with nothing installed, the selector would be empty - route to
            // the Module Manager (filtered to dictionaries) instead; only offer
            // the installed-module selector once at least one is installed.
            <PaneEmptyState
              icon="📖"
              testId="dictionary-empty-state"
              title={t('onboarding.empty.dictionary.title')}
              description={t('onboarding.empty.dictionary.description')}
              hint={t('onboarding.empty.dictionary.hint')}
              actions={[
                availableDictionaries.length === 0
                  ? {
                      label: t('onboarding.empty.dictionary.install'),
                      onClick: () => openModuleManager('dictionary'),
                      primary: true,
                      testId: 'dictionary-empty-install',
                    }
                  : {
                      label: t('onboarding.empty.dictionary.action'),
                      onClick: () => setShowSelector(true),
                      primary: true,
                      testId: 'dictionary-empty-choose',
                    },
              ]}
            />
          )
        ) : isLoading ? (
          // Loading
          <div className="flex items-center justify-center h-full">
            <div className="text-text-secondary">{t('dictionaryPane.loadingEntry')}</div>
          </div>
        ) : error ? (
          // Error - including "no such entry", which is the most common one and
          // is recoverable, so offer the two ways forward rather than a dead end.
          <PaneEmptyState
            icon="🚫"
            testId="dictionary-error-state"
            title={t('dictionaryPane.lookupFailedTitle')}
            description={error}
            hint={t('dictionaryPane.lookupFailedHint')}
            actions={[
              {
                label: t('dictionaryPane.searchInsteadAction'),
                onClick: () => {
                  setBrowseQuery(lookupInput.trim());
                  runBrowseSearch(lookupInput.trim());
                  setShowBrowseModal(true);
                },
                primary: true,
                testId: 'dictionary-error-search',
              },
            ]}
          />
        ) : !currentEntry ? (
          /*
            A dictionary is open and waiting for a word.

            "Nothing looked up yet" over a "Browse all entries" button would be
            an accusation followed by the least useful thing on offer. A
            Strong's lexicon has 5,700 entries in an order nobody reads by, so
            "browse all" is a wall, not a way in. The invitation is the search
            box, so the empty state points at it and names the dictionary the
            reader is standing in.
          */
          <PaneEmptyState
            icon="🔎"
            testId="dictionary-no-entry-state"
            title={t(
              'onboarding.empty.dictionaryEntry.title',
              { dictionary: cleanModuleName(activeTab.abbreviation) },
            )}
            description={t('onboarding.empty.dictionaryEntry.description')}
          />
        ) : (
          // Display dictionary entry
          <div className="px-xl py-lg max-w-4xl mx-auto" data-testid="dictionary-entry">
            {/* Entry Header */}
            <div className="mb-lg">
              <h2 className="text-3xl font-bold text-text-heading mb-sm" data-testid="dictionary-entry-key">
                {currentEntry.entry_key}
                {currentEntry.word && (
                  <span className="ms-md text-2xl text-text-secondary">
                    {currentEntry.word}
                  </span>
                )}
              </h2>

              {/* Transliteration and pronunciation */}
              <div className="flex items-center gap-md text-sm text-text-secondary mb-sm">
                {currentEntry.transliteration && (
                  <span className="italic">{currentEntry.transliteration}</span>
                )}
                {currentEntry.pronunciation && (
                  <span>/{currentEntry.pronunciation}/</span>
                )}
                {currentEntry.part_of_speech && (
                  <span className="px-sm py-xs bg-accent/10 text-accent rounded">
                    {currentEntry.part_of_speech}
                  </span>
                )}
              </div>

              {/* A Strong's entry is only half useful without the verses it
                  occurs in. The interlinear tooltip has offered this all along;
                  landing on the same entry from the dictionary side left the
                  user retyping the number into the search box by hand. */}
              {strongsSearchNumber && (
                <button
                  type="button"
                  onClick={() => { void searchStrongsNumber(strongsSearchNumber); }}
                  className="mt-md w-full flex items-center justify-center gap-xs px-sm py-xs rounded border border-border text-sm text-accent-strong hover:bg-accent-light hover:border-accent cursor-pointer transition-colors"
                  data-testid="dictionary-search-occurrences"
                >
                  <svg className="w-4 h-4 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {t('dictionaryPane.searchOccurrences')
                    .replace('{number}', strongsSearchNumber)}
                </button>
              )}
            </div>

            {/* Definition */}
            <div className="mb-xl">
              <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionaryPane.definitionHeading')}</h3>
              <div
                className="prose prose-lg max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(dictionaryDefinitionToHtml(currentEntry.definition, currentEntry.newline_handling)) }}
              />
            </div>

            {/* Etymology */}
            {currentEntry.etymology && (
              <div className="mb-xl">
                <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionaryPane.etymologyHeading')}</h3>
                <div
                  className="prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(dictionaryDefinitionToHtml(currentEntry.etymology, currentEntry.newline_handling)) }}
                />
              </div>
            )}

            {/* Usage Notes */}
            {currentEntry.usage_notes && (
              <div className="mb-xl">
                <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionaryPane.usageNotesHeading')}</h3>
                <div
                  className="prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(dictionaryDefinitionToHtml(currentEntry.usage_notes, currentEntry.newline_handling)) }}
                />
              </div>
            )}

            {/* Semantic Range */}
            {currentEntry.semantic_range && (
              <div className="mb-xl">
                <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionaryPane.semanticRangeHeading')}</h3>
                <div
                  className="prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(dictionaryDefinitionToHtml(currentEntry.semantic_range, currentEntry.newline_handling)) }}
                />
              </div>
            )}

            {/* Related Words */}
            {currentEntry.related_words && currentEntry.related_words.length > 0 && (
              <div className="mb-xl">
                <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionaryPane.relatedWordsHeading')}</h3>
                <div className="flex flex-wrap gap-sm">
                  {currentEntry.related_words.map((relatedKey, index) => (
                    <button
                      key={index}
                      onClick={() => handleRelatedWordClick(relatedKey)}
                      className="px-md py-sm bg-accent/10 text-accent rounded hover:bg-accent hover:text-text-on-accent transition-colors"
                      data-testid="related-word-btn"
                    >
                      {relatedKey}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Example Verses */}
            {currentEntry.example_verses && currentEntry.example_verses.length > 0 && (
              <div className="mb-xl">
                <h3 className="text-lg font-semibold text-text-heading mb-md">{t('dictionaryPane.exampleVersesHeading')}</h3>
                <div className="space-y-sm">
                  {currentEntry.example_verses.map((verse, index) => (
                    <div key={index} className="p-md bg-background rounded">
                      <div className="text-sm font-semibold text-accent mb-xs">
                        {formatVerseReference(verse.verse_id)}
                      </div>
                      {verse.text && (
                        <div className="text-sm text-text-secondary">{verse.text}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dictionary Selector Modal */}
      {showSelector && (
        <ModuleSelector
          title={t('dictionaryPane.selectDictionaryTitle')}
          modules={availableDictionaries.map((dictionary): ModuleItem => ({
            id: dictionary.abbreviation,
            name: dictionary.name,
            abbreviation: dictionary.abbreviation,
            languageCode: dictionary.language_code,
            version: dictionary.version,
            openCount: openTabs.some(tab => tab.abbreviation === dictionary.abbreviation) ? 1 : 0
          }))}
          isLoading={loadingDictionaries}
          emptyMessage={t('dictionaryPane.noDictionariesInstalled')}
          onSelect={(module) => {
            // openDictionary handles both new tabs and selecting existing ones
            openDictionary(module.abbreviation, module.name);
            setShowSelector(false);
          }}
          onClose={() => setShowSelector(false)}
        />
      )}

      {/* Browse Modal */}
      {showBrowseModal && activeTab && (
        <PaneOverlay onDismiss={() => setShowBrowseModal(false)}>
          <div
            ref={browseDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dictionary-browse-title"
            className="rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden"
            style={{ backgroundColor: 'var(--theme-surface-elevated)' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setShowBrowseModal(false);
              }
            }}
          >
            <div className="px-xl py-lg border-b border-border">
              <h2 id="dictionary-browse-title" className="text-2xl font-semibold text-text-heading">
                {t('dictionaryPane.browseTitle', { name: activeTab.name })}
              </h2>

              {/*
                Searching from inside the dialog. Without this the only entry
                point was the toolbar behind the modal, so browsing a dictionary
                of thousands of entries meant scrolling a list capped at 100.
              */}
              <form
                className="mt-md flex items-center gap-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  runBrowseSearch(browseQuery);
                }}
              >
                <input
                  type="search"
                  autoFocus
                  value={browseQuery}
                  onChange={(e) => setBrowseQuery(e.target.value)}
                  placeholder={t('dictionaryPane.browseSearchPlaceholder')}
                  aria-label={t('dictionaryPane.browseSearchPlaceholder')}
                  className="flex-1 px-sm py-xs border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent"
                  data-testid="dictionary-browse-search-input"
                />
                <button
                  type="submit"
                  className="px-md py-xs bg-accent text-text-on-accent rounded hover:bg-accent-hover"
                  data-testid="dictionary-browse-search-btn"
                >
                  {t('dictionaryPane.searchButton')}
                </button>
                {browseSearchActive && (
                  <button
                    type="button"
                    onClick={() => {
                      setBrowseQuery('');
                      runBrowseSearch('');
                    }}
                    className="px-md py-xs bg-control text-text-primary rounded hover:bg-control-hover"
                  >
                    {t('dictionaryPane.browseClearSearch')}
                  </button>
                )}
              </form>
            </div>

            <div className="overflow-y-auto max-h-[60vh] p-xl">
              {/* Only blank the list for the *first* page - a "Load more" fetch
                  must leave what is already read on screen. */}
              {(loadingAllEntries && browseEntries.length === 0) || isSearching ? (
                <div className="text-center text-text-secondary">{t('dictionaryPane.loadingEntries')}</div>
              ) : browseEntries.length === 0 ? (
                <div className="text-center text-text-secondary">
                  {browseSearchActive
                    ? t('dictionaryPane.browseNoMatches', { query: browseQuery })
                    : t('dictionaryPane.browseNoEntries')}
                </div>
              ) : (
                <div className="space-y-sm">
                  {/*
                    How much of the dictionary this list actually represents.
                    Stopping dead at 100 entries with nothing said would make a
                    Strong's lexicon of thousands read as a tiny broken module.
                    There is no entry-count channel to say "N of M" against, so
                    the count is stated plainly and paged with "Load more".
                  */}
                  <p className="text-sm text-text-secondary" data-testid="dictionary-browse-count">
                    {browseSearchActive
                      ? t('dictionaryPane.browseMatchCount', { count: browseEntries.length })
                      : allEntriesComplete
                        ? t('dictionaryPane.browseShowingAll', { count: browseEntries.length })
                        : t('dictionaryPane.browseShowingFirst', { count: browseEntries.length })}
                  </p>
                  {browseEntries.map((entry) => (
                    <button
                      type="button"
                      key={entry.entry_key}
                      className="w-full text-start p-md border rounded cursor-pointer hover:bg-background-warm transition-colors"
                      onClick={() => handleSelectFromBrowse(entry.entry_key)}
                    >
                      <span className="block font-semibold text-text-heading">
                        {entry.entry_key}
                        {entry.word && <span className="ms-md text-text-secondary">{entry.word}</span>}
                      </span>
                      {entry.transliteration && (
                        <span className="block text-sm text-text-secondary italic">{entry.transliteration}</span>
                      )}
                      <span className="block text-sm text-text-secondary line-clamp-2 mt-xs">
                        {entry.definition.replace(/<[^>]*>/g, '')}
                      </span>
                    </button>
                  ))}
                  {!browseSearchActive && !allEntriesComplete && (
                    <button
                      type="button"
                      onClick={loadMoreEntries}
                      disabled={loadingAllEntries}
                      className="w-full px-md py-sm bg-control text-text-primary rounded hover:bg-control-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="dictionary-browse-load-more"
                    >
                      {loadingAllEntries
                        ? t('dictionaryPane.loadingEntries')
                        : t('dictionaryPane.browseLoadMore')}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="px-xl py-md border-t border-border flex justify-end">
              <button
                type="button"
                className="px-lg py-sm bg-control text-text-primary rounded hover:bg-control-hover"
                onClick={() => setShowBrowseModal(false)}
              >
                {t('dictionaryPane.close')}
              </button>
            </div>
          </div>
        </PaneOverlay>
      )}

    </div>
  );
};

export default DictionaryPane;
