import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchStore, SemanticResult, StrongsSearchMeta, searchResultId, semanticResultId } from '../stores/useSearchStore';
import { useBibleStore, DEFAULT_PANEL_ID } from '../stores/useBibleStore';
import { syncPanesWithVerse } from '../stores/syncPanesWithVerse';
import { SearchResult, truncateAtWordBoundary, VerseIdHelper } from '@bible/core';
import { useI18n } from '../contexts/useI18n';
import { sanitizeHtml } from '../utils/sanitize';
import { openStrongsInDictionary } from './bible/openStrongsInDictionary';
import SearchDistributionGraph from './SearchDistributionGraph';

/**
 * How much of a Strong's gloss the search header shows before it is cut.
 *
 * The gloss is the KJV usage list parsed out of the lexicon entry. It is
 * normally a few words - the median across Strong's Greek is 11 characters -
 * but it is not bounded: `G1722` (ἐν) runs to 564 and the longest entry to 765.
 * A header is a one-line summary, so a long one is truncated and the reader is
 * pointed at the full entry in the Dictionary pane instead.
 */
const GLOSS_PREVIEW_LENGTH = 120;

/**
 * Moves focus to the previous/next result row.
 *
 * Each row is a `<button>` inside its own `role="listitem"` wrapper (so the
 * surrounding `role="list"` keeps valid children), which is why this walks up
 * one level before stepping sideways.
 */
function moveResultFocus(from: HTMLElement, direction: 1 | -1): void {
  const item = from.closest('[role="listitem"]');
  const sibling =
    direction === 1 ? item?.nextElementSibling : item?.previousElementSibling;
  sibling?.querySelector<HTMLElement>('button')?.focus();
}

/**
 * The subset of dockview's panel API this pane needs. Structural rather than
 * dockview's own type so the pane stays renderable (and testable) outside a
 * dockview host - it is still mounted directly in the detached-window and test
 * paths, where no panel API exists.
 */
interface SearchPanelApi {
  close: () => void;
}

interface SearchResultsPaneProps {
  /** Supplied by `PanelContentRenderer` when this is a dockview panel. */
  dockviewPanelApi?: SearchPanelApi;
}

/**
 * SearchResultsPane Component
 *
 * Displays search results in their own dockview panel (opened below the active
 * Bible pane by default; draggable anywhere from there).
 * Features:
 * - Title bar with query and close button
 * - Scrollable results list
 * - Single-verse results: full verse with highlighted matches
 * - Multi-verse results: verse range + snippet with ellipses
 * - Click to navigate to verse
 * - Fuzzy match indicators
 * - Semantic search toggle link
 * - Empty/loading/error states
 */
const SearchResultsPane: React.FC<SearchResultsPaneProps> = ({ dockviewPanelApi }) => {
  const { t } = useI18n();
  const {
    resultsForQuery,
    searchResults,
    isSearching,
    error,
    clearResults,
    // Result paging ("Show All Matches" / "Show N More")
    keywordResultLimit,
    isShowingAllKeywordResults,
    showAllKeywordResults,
    semanticVisibleCount,
    showMoreSemanticResults,
    // Semantic search
    isSemanticMode,
    semanticResults,
    isSemanticSearching,
    semanticAvailable,
    toggleSemanticMode,
    autoSwitchedToSemantic,
    // Strong's word family
    strongsMeta,
    includeRelatedWords,
    toggleIncludeRelatedWords,
    searchStrongsNumber,
    // Result interaction (retry-in-translation, last-clicked marker)
    retriedModules,
    retrySearchInModule,
    lastClickedId,
    setLastClickedId,
  } = useSearchStore();

  const navigateToVerse = useBibleStore(s => s.navigateToVerseInPrimary);
  const biblePanels = useBibleStore(s => s.panels);

  // Bible translations currently open across all Bible panels, minus whichever
  // one the user is actively viewing (the de facto "just searched" module -
  // desktop's keyword search always runs against it) and minus any module the
  // user has already retried for this query. Feeds the zero-results retry
  // affordance below; read-only against useBibleStore, which this component
  // does not own.
  const otherOpenTranslations = useMemo(() => {
    const seen = new Set<string>();
    const allOpen: string[] = [];
    biblePanels.forEach(panelState => {
      panelState.openTabs.forEach(tab => {
        if (!seen.has(tab.abbreviation)) {
          seen.add(tab.abbreviation);
          allOpen.push(tab.abbreviation);
        }
      });
    });
    const primaryPanel = biblePanels.get(DEFAULT_PANEL_ID) ?? biblePanels.values().next().value;
    const primaryAbbr = primaryPanel?.openTabs[primaryPanel.activeTabIndex]?.abbreviation;
    return allOpen.filter(abbr => abbr !== primaryAbbr && !retriedModules.includes(abbr));
  }, [biblePanels, retriedModules]);

  // ---- Truncation / paging -------------------------------------------------
  //
  // Keyword and semantic searches know different things about their own
  // completeness, so the two affordances are deliberately not symmetrical:
  //
  //  - Keyword results come back as a bare capped array with no total, so all
  //    that can be said honestly is "there may be more" - hence a generic
  //    "Show All Matches" and no number. A full page is the only evidence of
  //    truncation there is.
  //  - Semantic results arrive as one ranked page held in the store, so the
  //    remaining count is exact and the label can state it.
  const hasMoreKeywordResults =
    !isShowingAllKeywordResults &&
    searchResults.length > 0 &&
    searchResults.length >= keywordResultLimit;

  /**
   * Whether the keyword result set is a page of the matches rather than all of
   * them - the same evidence "Show All Matches" runs on, minus the
   * already-expanded guard.
   *
   * `search:performSearch` returns a bare array capped at
   * `SearchOptions.maxResults`; there is no server-side total. A full page is
   * therefore the only honest signal, and it stays a truthful signal after the
   * "Show All Matches" re-fetch: 5000 results out of a 5000 cap is still a
   * page. The distribution chart caption says so rather than implying it
   * counted the whole Bible. It can only over-warn (a query with exactly 200
   * matches reads as capped), never under-warn.
   */
  const isKeywordResultSetCapped =
    searchResults.length > 0 && searchResults.length >= keywordResultLimit;

  /**
   * Keyword results split into occurrences and approximations.
   *
   * `BibleSearchService.rankResults` does sort exact before everything else,
   * but its tiers are `exact` vs *not* exact - `stem` and `fuzzy` share the
   * second tier and interleave there by verse ID. So "exact before fuzzy" is
   * not the boundary the UI needs, and trusting the sort would scatter fuzzy
   * rows through the stem ones under a single divider. This partitions
   * explicitly instead; each group keeps the order the ranker gave it.
   */
  const [exactAndStemResults, fuzzyResults] = useMemo(() => {
    const primary: SearchResult[] = [];
    const approximate: SearchResult[] = [];
    for (const result of searchResults) {
      (result.type === 'fuzzy' ? approximate : primary).push(result);
    }
    return [primary, approximate] as const;
  }, [searchResults]);

  const visibleSemanticResults = useMemo(
    () => semanticResults.slice(0, semanticVisibleCount),
    [semanticResults, semanticVisibleCount],
  );
  const remainingSemanticResults = Math.max(0, semanticResults.length - semanticVisibleCount);

  // How many result rows are actually on screen right now.
  const renderedRowCount = isSemanticMode ? visibleSemanticResults.length : searchResults.length;

  // The header's own live region unmounts while `isSearching` is true (the
  // "Show All Matches" re-fetch does exactly that), and an aria-live region
  // that is not in the DOM at the moment its text changes announces nothing.
  // This one is always mounted, so expanding the list is always spoken - the
  // list growing under the user must not be silent.
  const [expandAnnouncement, setExpandAnnouncement] = useState('');
  const awaitingExpandRef = useRef(false);

  // Where the button was: focus follows the first newly-revealed result,
  // because the control the user just activated is gone from the DOM and focus
  // would otherwise fall back to <body>.
  const listRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (!awaitingExpandRef.current || isSearching) return;
    awaitingExpandRef.current = false;
    setExpandAnnouncement(
      isSemanticMode
        ? t('searchResultsPane.semanticMatchCount', { count: renderedRowCount })
        : t('searchResultsPane.resultCount', { count: renderedRowCount }),
    );
    const index = pendingFocusIndexRef.current;
    pendingFocusIndexRef.current = null;
    if (index !== null) {
      const rows = listRef.current?.querySelectorAll<HTMLElement>('[role="listitem"] button');
      rows?.[index]?.focus();
    }
  }, [renderedRowCount, isSearching, isSemanticMode, t]);

  const handleShowAllKeywordResults = () => {
    awaitingExpandRef.current = true;
    pendingFocusIndexRef.current = searchResults.length;
    void showAllKeywordResults();
  };

  const handleShowMoreSemanticResults = () => {
    awaitingExpandRef.current = true;
    pendingFocusIndexRef.current = semanticVisibleCount;
    showMoreSemanticResults();
  };

  // Handle result click - navigate to verse.
  // `syncPanesWithVerse` because picking a search result is the reader choosing
  // a verse, so the study panes should follow it just as they follow a click in
  // the Bible text.
  const handleResultClick = async (result: SearchResult) => {
    setLastClickedId(searchResultId(result));
    try {
      await navigateToVerse(result.verseId);
      syncPanesWithVerse(result.verseId);
    } catch (error) {
      console.error('Error navigating to verse:', error, result);
    }
  };

  /**
   * A bar in the distribution chart was clicked: select that book's first
   * match in the list and bring it into view.
   *
   * Deliberately *not* a navigation. The bars are a few pixels wide, and a
   * mis-click that moved the Bible pane out from under the reader would make
   * the chart something to be careful around. Selecting reuses the pane's own
   * last-clicked marker, so the gesture costs nothing to undo - click a
   * different bar, or ignore it.
   */
  const handleSelectBook = (bookNumber: number) => {
    const bookOf = (verseId: number) => VerseIdHelper.parse(verseId).bookNumber;

    let id: string | null = null;
    if (isSemanticMode) {
      const hit = visibleSemanticResults.find(r => bookOf(r.startVerseId) === bookNumber);
      id = hit ? semanticResultId(hit) : null;
    } else {
      // Fuzzy rows are excluded from the chart, so they must not be what a bar
      // scrolls to either.
      const hit = exactAndStemResults.find(r => bookOf(r.verseId) === bookNumber);
      id = hit ? searchResultId(hit) : null;
    }
    if (!id) return;

    setLastClickedId(id);
    // Matched against `dataset` rather than interpolated into a selector: the
    // ID contains the module abbreviation, which is module-supplied text.
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-result-id]');
    Array.from(rows ?? [])
      .find(row => row.dataset.resultId === id)
      ?.scrollIntoView({ block: 'nearest' });
  };

  // Handle semantic result click - navigate to start verse
  const handleSemanticResultClick = async (result: SemanticResult) => {
    setLastClickedId(semanticResultId(result));
    try {
      await navigateToVerse(result.startVerseId);
      syncPanesWithVerse(result.startVerseId);
    } catch (error) {
      console.error('Error navigating to verse:', error, result);
    }
  };

  // Handle close button. Closing the dockview panel too (when there is one) is
  // what makes the X mean "close the results", not "empty the tab and leave it
  // sitting there". Harmless either way: the next search re-creates the panel
  // at its default position.
  //
  // `clearResults` rather than `setResultsVisible(false)`: hiding the pane used
  // to leave `searchResults` populated, and the search bar's count badge is
  // derived from that array - so closing the results left a badge advertising
  // results nothing on screen could show.
  const handleClose = () => {
    clearResults();
    dockviewPanelApi?.close();
  };

  const isLoading = isSearching || isSemanticSearching;

  // One whole message per announcement - never a count spliced onto a noun at
  // render time. Both keys are real ICU `{count, plural, ...}` messages in every
  // catalog, so `t()` owns the plural rules; `tf()` must not be used here
  // because its fallback path cannot render a plural at all.
  // Counts what is on screen, not what is held in the store: with a page of
  // semantic results fetched but only some shown, a header claiming 150 above
  // a list of 30 would be a lie the "Show 120 More" button then contradicts.
  const countSummary = isSemanticMode
    ? t('searchResultsPane.semanticMatchCount', { count: renderedRowCount })
    : t('searchResultsPane.resultCount', { count: renderedRowCount });

  // A search panel outlives the search that opened it: it is part of the saved
  // layout, so it comes back on the next launch with no query behind it.
  // Heading and body both have to read sensibly in that state rather than
  // announcing results for `""`.
  const hasQuery = resultsForQuery.trim().length > 0;

  const headingText = !hasQuery
    ? t('paneName.search')
    : isSemanticMode
      ? t('searchResultsPane.semanticHeading', { query: resultsForQuery, })
      : t('searchResultsPane.heading', { query: resultsForQuery, });

  return (
    <section
      data-testid="search-results-pane"
      className="h-full flex flex-col"
      style={{ backgroundColor: 'var(--theme-bg-primary)' }}
      aria-labelledby="search-results-heading"
    >
      {/* Title Bar */}
      <div className="pane-header justify-between px-md py-sm">
        <div className="flex items-center gap-md flex-1 min-w-0">
          {/* Search Icon */}
          <svg className="pane-header-icon" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>

          {/* Query Display */}
          <div className="flex-1 min-w-0">
            <h2 id="search-results-heading" className="pane-header-title truncate">
              {headingText}
            </h2>
            {!isLoading && !error && hasQuery && (
              <div className="pane-header-subtitle flex items-center gap-2">
                {/*
                  Results arriving is the one search event worth speaking, and
                  the visible count is the thing to speak - no sr-only copy, so
                  there is exactly one source of truth. Polite, never assertive:
                  it must not interrupt the verse being read.
                */}
                <span role="status" aria-live="polite" aria-atomic="true">
                  {countSummary}
                </span>
                {/* Semantic Search Toggle Link */}
                {semanticAvailable && (
                  <button
                    type="button"
                    onClick={toggleSemanticMode}
                    className="text-xs text-accent-strong hover:text-accent-strong hover:underline cursor-pointer ms-2"
                  >
                    {isSemanticMode
                      ? t('searchResultsPane.backToKeyword')
                      : t('searchResultsPane.trySemantic')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Close Button */}
          <button
            type="button"
            onClick={handleClose}
            className="pane-header-btn p-1.5"
            title={t('searchResultsPane.closeTitle')}
            aria-label={t('searchResultsPane.closeTitle')}
          >
            <svg className="w-4 h-4" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Word Family Bar (Strong's search only) */}
      {!error && strongsMeta && strongsMeta.family.length > 0 && (
        <WordFamilyBar
          meta={strongsMeta}
          includeRelated={includeRelatedWords}
          onToggleIncludeRelated={toggleIncludeRelatedWords}
          onSelectMember={(strongsNumber) => searchStrongsNumber(strongsNumber)}
        />
      )}

      {/* Results Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary">
            <div aria-hidden="true" className="animate-spin h-8 w-8 border-4 border-accent border-t-transparent rounded-full mb-md"></div>
            <div className="text-sm" role="status" aria-live="polite">
              {isSemanticSearching
                ? t('searchResultsPane.searchingSemantically')
                : t('searchResultsPane.searching')}
            </div>
          </div>
        )}

        {/* Error State */}
        {/* A failed search is a genuine error, so this one is assertive. */}
        {error && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full p-lg" role="alert">
            <svg className="w-12 h-12 text-danger mb-md" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-danger font-semibold mb-sm">{error}</div>
            <div className="text-sm text-text-secondary text-center max-w-md">
              {t('searchResultsPane.errorHint')}
            </div>
          </div>
        )}

        {/* Idle state - panel restored from the saved layout, no search yet */}
        {!isLoading && !error && !hasQuery && (
          <div
            className="flex flex-col items-center justify-center h-full p-lg text-text-secondary"
            data-testid="search-results-idle"
          >
            <svg className="w-16 h-16 mb-md text-text-muted" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <div className="text-sm text-center max-w-md">
              {t('searchResultsPane.idleHint')}
            </div>
          </div>
        )}

        {/* Auto-switch notice */}
        {!isLoading && !error && isSemanticMode && autoSwitchedToSemantic && semanticResults.length > 0 && (
          <div className="px-md py-sm bg-accent-light border-b border-accent-soft text-sm text-accent-strong">
            {t('searchResultsPane.autoSwitchNotice')}
            <button
              type="button"
              onClick={toggleSemanticMode}
              className="ms-2 text-accent-strong hover:text-accent-strong underline cursor-pointer"
            >
              {t('searchResultsPane.backToKeyword')}
            </button>
          </div>
        )}

        {/* Semantic Results */}
        {!isLoading && !error && isSemanticMode && (
          <>
            {semanticResults.length === 0 && resultsForQuery && (
              <div className="flex flex-col items-center justify-center h-full p-lg text-text-secondary">
                <svg className="w-16 h-16 mb-md text-text-muted" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-lg font-semibold mb-sm">{t('searchResultsPane.noSemanticMatches')}</div>
                <div className="text-sm text-center max-w-md">
                  {t('searchResultsPane.noSemanticMatchesHint')}
                </div>
              </div>
            )}

            {semanticResults.length > 0 && (
              <>
                <div ref={isSemanticMode ? listRef : undefined}>
                  {/*
                    Over the rows actually on screen, not the whole fetched
                    page: every bar has to correspond to a row the click can
                    scroll to, and this is the same set the header counts.
                  */}
                  <SearchDistributionGraph
                    mode="semantic"
                    results={visibleSemanticResults}
                    onSelectBook={handleSelectBook}
                  />
                  <div
                    className="divide-y divide-border"
                    data-testid="semantic-search-results"
                    role="list"
                    aria-label={countSummary}
                  >
                    {visibleSemanticResults.map((result, index) => (
                      <SemanticResultItem
                        key={`${result.id}-${index}`}
                        result={result}
                        onClick={() => handleSemanticResultClick(result)}
                        lastClicked={lastClickedId === semanticResultId(result)}
                      />
                    ))}
                  </div>
                </div>

                {remainingSemanticResults > 0 && (
                  <ShowMoreBar
                    label={t('searchResultsPane.showMoreMatches', {
                      count: remainingSemanticResults,
                    })}
                    testId="show-more-semantic-results"
                    onClick={handleShowMoreSemanticResults}
                  />
                )}
              </>
            )}
          </>
        )}

        {/* Keyword Results (non-semantic mode) */}
        {!isLoading && !error && !isSemanticMode && (
          <>
            {/* Empty State */}
            {searchResults.length === 0 && resultsForQuery && (
              <div className="flex flex-col items-center justify-center h-full p-lg text-text-secondary">
                <svg className="w-16 h-16 mb-md text-text-muted" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-lg font-semibold mb-sm">{t('searchResultsPane.noResults')}</div>
                <div className="text-sm text-center max-w-md">
                  {t('searchResultsPane.noResultsHint')}
                </div>
                {otherOpenTranslations.length > 0 && (
                  <div className="mt-md flex flex-col items-center gap-xs" data-testid="retry-other-translations">
                    <div className="text-sm text-text-secondary">
                      {t('searchResultsPane.tryOtherTranslations')}
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      {otherOpenTranslations.map(mod => (
                        <button
                          key={mod}
                          type="button"
                          onClick={() => retrySearchInModule(mod)}
                          className="text-xs px-2 py-1 rounded border border-border text-accent-strong hover:bg-accent-light hover:border-accent cursor-pointer transition-colors"
                          data-testid="retry-in-module-btn"
                        >
                          {t('searchResultsPane.tryInModule', { module: mod })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {semanticAvailable && (
                  <button
                    type="button"
                    onClick={toggleSemanticMode}
                    className="mt-md text-sm text-accent-strong hover:text-accent-strong hover:underline cursor-pointer"
                  >
                    {t('searchResultsPane.trySemantic')}
                  </button>
                )}
              </div>
            )}

            {/* Results List */}
            {searchResults.length > 0 && (
              <>
                <div ref={isSemanticMode ? undefined : listRef}>
                  <SearchDistributionGraph
                    mode="keyword"
                    results={searchResults}
                    isCapped={isKeywordResultSetCapped}
                    onSelectBook={handleSelectBook}
                  />
                  <div
                    className="divide-y divide-border"
                    data-testid="search-results"
                    role="list"
                    aria-label={countSummary}
                  >
                    {exactAndStemResults.map((result, index) => (
                      <SearchResultItem
                        key={`${result.verseId}-${index}`}
                        result={result}
                        onClick={() => handleResultClick(result)}
                        lastClicked={lastClickedId === searchResultId(result)}
                      />
                    ))}
                  </div>

                  {/*
                    One labelled boundary instead of an amber "~" on each row.
                    The badge stays - it names which word matched - but the
                    thing a reader needs first is "everything below here is a
                    different word that looks like yours", and a per-row badge
                    never says that.
                  */}
                  {fuzzyResults.length > 0 && (
                    <>
                      <div
                        className="px-md py-sm bg-background-tertiary border-y border-border"
                        data-testid="fuzzy-divider"
                      >
                        <div className="text-sm font-semibold text-text-secondary">
                          {t('searchResultsPane.approximateHeading')}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">
                          {t('searchResultsPane.approximateHint')}
                        </div>
                      </div>
                      <div
                        className="divide-y divide-border bg-background-tertiary"
                        data-testid="search-results-approximate"
                        role="list"
                        aria-label={t('searchResultsPane.approximateHeading')}
                      >
                        {fuzzyResults.map((result, index) => (
                          <SearchResultItem
                            key={`fuzzy-${result.verseId}-${index}`}
                            result={result}
                            onClick={() => handleResultClick(result)}
                            lastClicked={lastClickedId === searchResultId(result)}
                            approximate
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {hasMoreKeywordResults && (
                  <ShowMoreBar
                    label={t('searchResultsPane.showAllMatches')}
                    testId="show-all-matches"
                    onClick={handleShowAllKeywordResults}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>

      {/*
        Always mounted, so it is in the DOM at the moment its text changes -
        an aria-live region added and populated in the same commit is not
        reliably announced. Empty until the user expands the list.
      */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {expandAnnouncement}
      </div>
    </section>
  );
};

// ============================================================================
// ShowMoreBar Component (truncated-result-set affordance)
// ============================================================================

interface ShowMoreBarProps {
  label: string;
  testId: string;
  onClick: () => void;
}

/**
 * The footer control shown only when the visible list is not the whole set.
 *
 * A plain `<button>`, so it is reachable by Tab and activated by Enter/Space
 * with no extra key handling - the result rows' own Arrow-key navigation stops
 * at the last row and does not swallow it.
 */
const ShowMoreBar: React.FC<ShowMoreBarProps> = ({ label, testId, onClick }) => (
  <div className="p-md flex justify-center border-t border-border">
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="text-sm px-3 py-1.5 rounded border border-border text-accent-strong hover:bg-accent-light hover:border-accent cursor-pointer transition-colors"
    >
      {label}
    </button>
  </div>
);

// ============================================================================
// SearchResultItem Component (keyword search)
// ============================================================================

interface SearchResultItemProps {
  result: SearchResult;
  onClick: () => void;
  /** Marks this as the result the user most recently clicked, so they can see
   * where they were when they return to the list. Purely decorative - it does
   * not affect focus, `aria-current`, or the arrow-key navigation below. */
  lastClicked?: boolean;
  /**
   * Renders the row below the "Approximate matches" divider: sunk background
   * and a quieter reference colour, so the two groups read apart at a glance
   * without re-reading the badges.
   */
  approximate?: boolean;
}

const SearchResultItem: React.FC<SearchResultItemProps> = ({ result, onClick, lastClicked, approximate }) => {
  const { t } = useI18n();
  const isMultiVerse = result.verseIds && result.verseIds.length > 1;

  // Safety check for result data
  if (!result || !result.verseId || !result.text) {
    console.error('Invalid search result:', result);
    return null;
  }

  // Prefer snippet (which is centered on matched text) over full text
  let displayText = result.snippet || result.text;
  try {
    if (typeof displayText !== 'string') {
      console.error('Result text is not a string:', displayText, result);
      displayText = String(displayText);
    }
  } catch (error) {
    console.error('Error processing result text:', error, result);
    displayText = '[Error displaying text]';
  }

  return (
    <div role="listitem" data-result-id={searchResultId(result)}>
    <button
      type="button"
      className={`w-full text-start px-md py-sm hover:bg-accent-light cursor-pointer transition-colors group${
        lastClicked ? ' bg-background-warm border-s-3 border-s-accent ps-3' : ''
      }`}
      onClick={onClick}
      data-testid="search-result"
      data-approximate={approximate ? 'true' : undefined}
      data-last-clicked={lastClicked ? 'true' : undefined}
      /*
       * Deliberately unlabelled: the button's own content is the reference plus
       * the verse text, which is exactly what a reader wants read aloud. An
       * aria-label here would replace Scripture with "Go to John 3:16". The
       * last-clicked marker below is plain content (not an aria-label), so it
       * layers onto that reading rather than replacing it.
       */
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          moveResultFocus(e.currentTarget, 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          moveResultFocus(e.currentTarget, -1);
        }
      }}
    >
      <div className="flex items-start justify-between gap-md">
        {/* Left Side: Reference and Text */}
        <div className="flex-1 min-w-0">
          {/* Reference */}
          <div className="flex items-center gap-2 mb-xs">
            {lastClicked && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0"
                aria-hidden="true"
                data-testid="last-clicked-marker"
              />
            )}
            {lastClicked && <span className="sr-only">{t('searchResultsPane.lastClickedSrLabel')}</span>}
            <span
              className={`text-sm font-bold group-hover:text-accent-strong ${
                approximate ? 'text-text-secondary' : 'text-accent-strong'
              }`}
            >
              {result.reference}
            </span>

            {/* Module Badge (if not current module) */}
            {result.module && result.module !== 'KJV' && (
              <span className="text-xs bg-background-tertiary text-text-secondary px-1.5 py-0.5 rounded" data-testid="search-result-module">
                {result.module}
              </span>
            )}

            {/* Fuzzy Match Badge */}
            {result.type === 'fuzzy' && (
              <span className="text-xs bg-warning-soft text-warning-text px-1.5 py-0.5 rounded flex items-center gap-1">
                <span aria-hidden="true">~</span>
                <span>{t('searchResultsPane.fuzzyBadge')}</span>
              </span>
            )}

            {/* Stem Match Badge */}
            {result.type === 'stem' && (
              <span className="text-xs bg-success-soft text-success-text px-1.5 py-0.5 rounded">
                {t('searchResultsPane.stemBadge')}
              </span>
            )}
          </div>

          {/* Verse Text */}
          <div
            className={`text-sm leading-relaxed ${
              isMultiVerse ? 'text-text-secondary' : 'text-text-body'
            }`}
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(displayText)
            }}
          />
        </div>

        {/* Right Side: Navigate Icon */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="w-5 h-5 text-accent-strong rtl-mirror" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </button>
    </div>
  );
};

// ============================================================================
// SemanticResultItem Component
// ============================================================================

interface SemanticResultItemProps {
  result: SemanticResult;
  onClick: () => void;
  /** Marks this as the result the user most recently clicked, so they can see
   * where they were when they return to the list. Purely decorative - it does
   * not affect focus, `aria-current`, or the arrow-key navigation below. */
  lastClicked?: boolean;
}

const SemanticResultItem: React.FC<SemanticResultItemProps> = ({ result, onClick, lastClicked }) => {
  const { t } = useI18n();
  // Format similarity as percentage
  const similarityPercent = Math.round(result.similarity * 100);

  return (
    <div role="listitem" data-result-id={semanticResultId(result)}>
    <button
      type="button"
      className={`w-full text-start px-md py-sm hover:bg-accent-light cursor-pointer transition-colors group${
        lastClicked ? ' bg-background-warm border-s-3 border-s-accent ps-3' : ''
      }`}
      onClick={onClick}
      data-testid="semantic-result"
      data-last-clicked={lastClicked ? 'true' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          moveResultFocus(e.currentTarget, 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          moveResultFocus(e.currentTarget, -1);
        }
      }}
    >
      <div className="flex items-start justify-between gap-md">
        {/* Left Side: Reference and Text */}
        <div className="flex-1 min-w-0">
          {/* Reference */}
          <div className="flex items-center gap-2 mb-xs">
            {lastClicked && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0"
                aria-hidden="true"
                data-testid="last-clicked-marker"
              />
            )}
            {lastClicked && <span className="sr-only">{t('searchResultsPane.lastClickedSrLabel')}</span>}
            <span className="text-sm font-bold text-accent-strong group-hover:text-accent-strong">
              {result.reference}
            </span>

            {/* Level Badge */}
            {result.level !== 'verse' && (
              <span className="text-xs bg-accent-soft text-accent-strong px-1.5 py-0.5 rounded capitalize">
                {result.level}
              </span>
            )}

            {/* Similarity Score */}
            <span className="text-xs bg-accent-light text-accent-strong px-1.5 py-0.5 rounded">
              {t('searchResultsPane.similarityBadge', { percent: similarityPercent, })}
            </span>
          </div>

          {/* Text (no highlighting for semantic results) */}
          <div
            className="text-sm leading-relaxed text-text-body"
            dangerouslySetInnerHTML={{
              __html: sanitizeHtml(result.text || result.textPreview)
            }}
          />
        </div>

        {/* Right Side: Navigate Icon */}
        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="w-5 h-5 text-accent-strong rtl-mirror" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </button>
    </div>
  );
};

// ============================================================================
// WordFamilyBar Component (Strong's search word-family pills + toggle)
// ============================================================================

interface WordFamilyBarProps {
  meta: StrongsSearchMeta;
  includeRelated: boolean;
  onToggleIncludeRelated: () => void;
  onSelectMember: (strongsNumber: string) => void;
}

const WordFamilyBar: React.FC<WordFamilyBarProps> = ({
  meta,
  includeRelated,
  onToggleIncludeRelated,
  onSelectMember,
}) => {
  const { t } = useI18n();
  const { entry, family } = meta;
  const gloss = truncateAtWordBoundary(entry?.gloss ?? '', GLOSS_PREVIEW_LENGTH);

  return (
    <div
      className="border-b border-border bg-accent-light px-md py-sm"
      data-testid="word-family-bar"
    >
      {/* Primary entry summary */}
      <div className="flex items-center gap-2 flex-wrap text-sm mb-xs">
        <span className="font-bold text-accent-strong">{meta.strongsNumber}</span>
        {entry?.word && <span className="text-lg" lang="grc">{entry.word}</span>}
        {entry?.transliteration && (
          <span className="italic text-text-secondary">({entry.transliteration})</span>
        )}
        {gloss.text && (
          <span className="text-text-body" data-testid="strongs-gloss" title={gloss.truncated ? entry?.gloss : undefined}>
            &ldquo;{gloss.text}&rdquo;
          </span>
        )}
        {/* The full entry is always one click away, but only advertised when
            there is more of it to see than the header is showing. */}
        {gloss.truncated && (
          <button
            type="button"
            onClick={() => { void openStrongsInDictionary(meta.strongsNumber); }}
            className="text-xs underline text-accent-strong hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded"
            data-testid="strongs-full-entry"
            title={t('searchResultsPane.strongsFullEntryTitle', { number: meta.strongsNumber })}
          >
            {t('searchResultsPane.strongsFullEntry')}
          </button>
        )}
      </div>

      {/* Word family pills */}
      {family.length > 1 && (
        <div className="flex items-start gap-2 flex-wrap mb-xs">
          <span id="word-family-label" className="text-xs font-semibold text-text-secondary mt-1">
            {t('searchResultsPane.wordFamilyLabel')}
          </span>
          <div className="flex flex-wrap gap-1" data-testid="word-family-pills" role="group" aria-labelledby="word-family-label">
            {family.map(m => (
              <button
                key={m.strongsNumber}
                type="button"
                onClick={() => onSelectMember(m.strongsNumber)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  m.relationship === 'self'
                    ? 'bg-accent text-text-on-accent border-accent'
                    : 'bg-surface text-accent-strong border-accent-soft hover:bg-accent-soft'
                }`}
                title={m.gloss ? `${m.word ?? ''} - ${m.gloss}` : m.strongsNumber}
                aria-current={m.relationship === 'self' ? 'true' : undefined}
                data-testid="word-family-pill"
              >
                <span className="font-semibold">{m.strongsNumber}</span>
                {m.transliteration && (
                  <span className="ms-1 italic opacity-80">{m.transliteration}</span>
                )}
                {typeof m.occurrenceCount === 'number' && (
                  <span className="ms-1 opacity-70">({m.occurrenceCount})</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Include-related toggle */}
      {family.length > 1 && (
        <label className="inline-flex items-center gap-2 text-xs text-text-body cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeRelated}
            onChange={onToggleIncludeRelated}
            data-testid="include-related-toggle"
            className="h-3.5 w-3.5"
          />
          {t('searchResultsPane.includeRelatedWords')}
        </label>
      )}
    </div>
  );
};

export default SearchResultsPane;
