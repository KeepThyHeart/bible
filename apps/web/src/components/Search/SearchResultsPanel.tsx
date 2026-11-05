import { useState, useRef, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { searchStore, searchResultId } from '../../stores/searchStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { bibleStore } from '../../stores/bibleStore';
import { offlineStore } from '../../stores/offlineStore';
import { announce } from '../../utils/announcer';
import { useStore } from '../../hooks/useStore';
import { SemanticNote } from './SemanticNote';
import { SearchResultItem } from './SearchResultItem';
import { SearchDistributionChart, type SearchDistributionMode } from './SearchDistributionChart';
import { parseVerseId } from '../../utils/verseId';
import { sanitizeHtml } from '../../utils/sanitize';
import { stripBidiControls, truncateAtWordBoundary } from '@bible/core/browser';
import type { SearchResultData } from '../../types';

/**
 * How much of a Strong's gloss the search header shows before it is cut.
 *
 * The gloss is the KJV usage list parsed out of the lexicon entry. It is
 * normally a few words — the median across Strong's Greek is 11 characters —
 * but nothing bounds it: `G1722` (ἐν) runs to 564 characters and the longest
 * entry to 765. There is no separate short-definition column to prefer, so the
 * header truncates and points at the full entry instead.
 */
const GLOSS_PREVIEW_LENGTH = 120;

interface SearchResultsPanelProps {
  onNavigate?: () => void;
  /**
   * Open a Strong's number's full lexicon entry. Each layout supplies its own
   * route — the desktop app's Dictionary tab, the mobile app's Strong's popup —
   * which is the same split `onStrongsClick` already makes for an interlinear
   * chip. Omitted means there is nowhere to send the reader, and the header's
   * "full entry" affordance is not offered.
   */
  onOpenStrongsEntry?: (strongsNumber: string) => void;
}

/** A query typed like a slash command ('/note', '/plan'): those exist only in the desktop app. */
export function isSlashCommandQuery(query: string): boolean {
  return /^\/[a-z][\w-]*(\s|$)/i.test(query.trim());
}

export function SearchResultsPanel({ onNavigate, onOpenStrongsEntry }: SearchResultsPanelProps) {
  const { t } = useTranslation();
  const results = useStore(searchStore, () => searchStore.results);
  const loading = useStore(searchStore, () => searchStore.loading);
  const query = useStore(searchStore, () => searchStore.query);
  const totalResults = useStore(searchStore, () => searchStore.totalResults);
  const searchType = useStore(searchStore, () => searchStore.searchType);
  const searchedModule = useStore(searchStore, () => searchStore.searchedModule);
  const searchedModules = useStore(searchStore, () => searchStore.searchedModules);
  const semanticMeta = useStore(searchStore, () => searchStore.semanticMeta);
  const keywordMatchCount = useStore(searchStore, () => searchStore.keywordMatchCount);
  const canLoadMore = useStore(searchStore, () => searchStore.canLoadMore);
  const loadingMore = useStore(searchStore, () => searchStore.loadingMore);
  const tabs = useStore(bibleStore, () => bibleStore.tabs);
  const activeTabId = useStore(bibleStore, () => bibleStore.activeTabId);
  // While the "Ideas search unavailable" popup is up it already explains the empty
  // result; "No results found" under it would be a second, contradictory message.
  const ideasUnavailableShown = useStore(
    searchStore,
    () => searchStore.semanticInit.status === 'error' && !searchStore.semanticInitDismissed,
  );
  const strongsMode = useStore(searchStore, () => searchStore.strongsMode);
  const strongsEntry = useStore(searchStore, () => searchStore.strongsEntry);
  const wordFamily = useStore(searchStore, () => searchStore.wordFamily);
  const includeRelated = useStore(searchStore, () => searchStore.includeRelated);
  const groupedCounts = useStore(searchStore, () => searchStore.groupedCounts);
  const strongsRemaining = useStore(searchStore, () => searchStore.strongsRemaining);
  const bookCounts = useStore(searchStore, () => searchStore.bookCounts);
  const searchError = useStore(searchStore, () => searchStore.searchError);
  const strongsTotalAvailable = useStore(searchStore, () => searchStore.strongsTotalAvailable);
  const keywordRemaining = useStore(searchStore, () => searchStore.keywordRemaining);
  const lastClickedId = useStore(searchStore, () => searchStore.lastClickedId);
  const resultsTruncated = useStore(searchStore, () => searchStore.resultsTruncated);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);

  const queryRejected = !!searchError && results.length === 0;
  // Ideas could not run at all: that is not "0 results", so no count and no "No results found".
  const ideasFailed = searchType === 'semantic' && ideasUnavailableShown && results.length === 0;

  // Announce the outcome of each search to screen readers.
  useEffect(() => {
    if (loading || !query) return;
    // W-063: a rejected query is announced by its own role="alert"; "No results found." would be wrong.
    if (queryRejected || ideasFailed) return;
    announce(results.length === 0 ? t('search.noResults') : t('search.results', { count: totalResults || results.length }));
  }, [loading, query, results.length === 0, totalResults, queryRejected, ideasFailed]);
  // Offline with nothing found means the search could not run, not that it found 0.
  // While a search runs, the previous count (or an empty "0") is not an answer yet (B-184).
  const showCount = !loading && (isOnline || totalResults > 0);
  // A search that could not run offline is run again when the connection returns, rather
  // than leaving "No results found" under a query nobody has actually answered.
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    if (query && !loading && results.length === 0) void searchStore.retryLast();
  }, [isOnline]);
  // Keyword mode headlines the exact matches only: approximate rows sit under
  // their own divider and are not in the chart, so counting them made a phrase
  // with one real hit read "(31 results)" (B-168, as B-017 on desktop).
  const approximateCount = !strongsMode && searchType === 'keyword'
    ? results.filter(r => r.type === 'fuzzy').length
    : 0;
  const headlineCount = approximateCount > 0
    ? t('search.resultsWithApproximate', { count: Math.max(0, totalResults - approximateCount), approximate: approximateCount })
    : t('search.results', { count: totalResults });
  // W-052: in Strong's mode `totalResults` is the page size. Use the true occurrence count when the
  // server gave one; otherwise, while more can be loaded, show no count rather than a wrong one.
  const strongsCount = strongsTotalAvailable > 0 ? strongsTotalAvailable : totalResults;
  const strongsHeadline = t('search.results', { count: strongsCount });
  const showStrongsCount = showCount && (strongsTotalAvailable > 0 || !canLoadMore);
  // W-053: a phrase search is typed with its own quotes; do not wrap them in a second pair.
  const quotedByUser = query.length > 1 && query.startsWith('"') && query.endsWith('"');
  const [mobileQuery, setMobileQuery] = useState('');
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Auto-focus mobile search input when panel mounts — but only on desktop
  // (on mobile, auto-focus opens the keyboard which is jarring)
  useEffect(() => {
    if (window.innerWidth > 768) {
      const timer = setTimeout(() => mobileInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  /**
   * Scroll a result row into view, reporting whether the row was there to scroll
   * to. Quoted attribute selector, so only a quote or backslash in the id would
   * need escaping. `CSS.escape` is deliberately not used — it is absent from
   * some of the DOM shims the tests run under.
   */
  const scrollToResultId = (id: string): boolean => {
    const selector = `[data-result-id="${id.replace(/["\\]/g, '\\$&')}"]`;
    const row = resultsRef.current?.querySelector<HTMLElement>(selector);
    if (!row) return false;
    // Centred rather than merely brought inside the viewport: a row scrolled to
    // the bottom edge reads as the end of the list, with the verses either side
    // of it — the reason to jump to a book in the first place — out of sight.
    row.scrollIntoView({ block: 'center' });
    return true;
  };

  // A bar click can land before the row it points at exists, because selecting a
  // book outside the loaded page fetches the rest of the results first. The
  // scroll waits for that render instead of quietly doing nothing.
  const pendingScrollRef = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingScrollRef.current;
    if (id && scrollToResultId(id)) pendingScrollRef.current = null;
  }, [results]);

  /**
   * A bar click moves the selection in the list and scrolls that row into view.
   * It deliberately does *not* navigate the Bible pane: at ~5px per bar on a
   * phone a mis-click has to be cheap, and the selection is undone by clicking
   * elsewhere.
   */
  const selectResult = (result: SearchResultData) => {
    const id = searchResultId(result);
    searchStore.setLastClickedId(id);
    if (!scrollToResultId(id)) pendingScrollRef.current = id;
  };

  /**
   * Select the clicked book's first match.
   *
   * In keyword mode the chart counts every match while the list holds only the
   * first page, so a bar can point at a book with no row behind it — or at a
   * book whose rows are only partly loaded, where the first match in the book
   * may still be missing. Either way the rest of the results are fetched before
   * the selection is made, so the bar always lands on the match it is counting.
   */
  const selectBook = async (bookNumber: number, first?: SearchResultData) => {
    const inBook = (r: SearchResultData) =>
      r.type !== 'fuzzy' && parseVerseId(r.verseId).bookNumber === bookNumber;
    const counted = bookCounts[bookNumber];
    if (counted !== undefined && results.filter(inBook).length < counted) {
      await searchStore.loadAllKeyword();
    }
    // Read back off the store: the fetch above replaced the list wholesale.
    const target = searchStore.results.find(inBook) ?? first;
    if (target) selectResult(target);
  };

  const navigateToResult = (result: SearchResultData) => {
    searchStore.setLastClickedId(searchResultId(result));
    const { bookNumber, chapter, verse } = parseVerseId(result.verseId);
    bibleStore.navigateToPreview(bookNumber, chapter, verse);
    onNavigate?.();
  };

  const openInNewTab = (result: SearchResultData) => {
    searchStore.setLastClickedId(searchResultId(result));
    const { bookNumber, chapter, verse } = parseVerseId(result.verseId);
    bibleStore.addTabWithPassage(result.module || bibleStore.getActiveModule(), bookNumber, chapter, verse);
    onNavigate?.();
  };

  // "Load all" removes its own button once the rest arrives, which would drop focus to <body>:
  // hand it to the first row that was not there before.
  const loadAllThenFocus = async (load: () => Promise<void>) => {
    const before = resultsRef.current?.querySelectorAll('[data-result-id]').length ?? 0;
    await load();
    requestAnimationFrame(() => {
      const rows = resultsRef.current?.querySelectorAll<HTMLElement>('[data-result-id]');
      if (!rows || rows.length === 0) return;
      const active = document.activeElement;
      if (active && active !== document.body && resultsRef.current?.contains(active) && !(active as HTMLElement).matches?.('.search-panel-inline__load-more-btn')) return;
      (rows[before] ?? rows[rows.length - 1]).focus({ preventScroll: false });
    });
  };

  const handleClose = () => {
    // clear(), not close(): the header box must not keep the query of a search that is gone
    // (it also refocuses the header field, since this button unmounts with the panel header).
    searchStore.clear();
    commentaryStore.setRightPaneMode('commentary');
  };

  const handleMobileSearch = (e: Event) => {
    e.preventDefault();
    const trimmed = stripBidiControls(mobileQuery).trim();
    if (!trimmed) return;
    // Both modes want the reader's translation: keyword searches its text,
    // semantic renders its matches in it. Left undefined when no translation is
    // open, which is what makes the server fall back to KJV.
    const activeModule = bibleStore.getActiveTab()?.moduleAbbr;
    const modules = activeModule ? [activeModule] : undefined;
    searchStore.performSearch(trimmed, undefined, modules);
    // W-039: blur only to dismiss a phone's soft keyboard; on desktop it dropped focus to <body>.
    if (window.innerWidth <= 768) mobileInputRef.current?.blur();
  };

  // Fuzzy rows are partitioned out here rather than trusted to arrive last.
  // `BibleSearchService.rankResults` does currently sort every exact match ahead
  // of every fuzzy one, so today the order would happen to work — but that is an
  // incidental property of a comparator whose stated job is relevance ranking,
  // and the `search:results` server hook can reorder the list afterwards. A
  // divider that silently lands in the wrong place is worse than no divider, so
  // the grouping is done explicitly.
  const exactResults = results.filter(r => r.type !== 'fuzzy');
  const fuzzyResults = results.filter(r => r.type === 'fuzzy');

  const distributionMode: SearchDistributionMode = strongsMode
    ? 'strongs'
    : searchType === 'semantic' ? 'semantic' : 'keyword';

  const renderResult = (result: SearchResultData, key: string) => {
    const rid = searchResultId(result);
    return (
      <SearchResultItem
        key={key}
        result={result}
        resultId={rid}
        onClick={navigateToResult}
        onCtrlClick={openInNewTab}
        lastClicked={rid === lastClickedId}
      />
    );
  };

  // The results stay when the reader switches translation (B-005): name the one they were run in.
  const activeModuleAbbr = tabs.find((tab) => tab.id === activeTabId)?.moduleAbbr;
  const translationNote = !strongsMode && searchedModules.length > 0 && activeModuleAbbr && !searchedModules.includes(activeModuleAbbr)
    ? t('search.resultsFrom', { modules: searchedModules.join(', ') })
    : null;

  return (
    <div class="search-panel-inline">
      {/* Mobile search bar — hidden on desktop via CSS */}
      <div class="search-panel-inline__mobile-bar">
        <form class="search-panel-inline__mobile-form" onSubmit={handleMobileSearch} action="javascript:void(0)">
          <input
            ref={mobileInputRef}
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            class="search-panel-inline__mobile-input"
            placeholder={t('search.placeholder')}
            value={mobileQuery}
            onInput={(e) => setMobileQuery((e.target as HTMLInputElement).value)}
          />
          <button type="submit" class="search-panel-inline__mobile-submit" aria-label={t('header.search')}>
            <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
          </button>
        </form>
        <div class="search-panel-inline__mobile-type">
          <button
            type="button"
            class={`search-panel-inline__type-btn ${searchType === 'keyword' ? 'search-panel-inline__type-btn--active' : ''}`}
            onClick={() => searchStore.setSearchType('keyword')}
          >
            <i class="fa-solid fa-magnifying-glass" /> {t('search.keyword')}
          </button>
          <button
            type="button"
            class={`search-panel-inline__type-btn ${searchType === 'semantic' ? 'search-panel-inline__type-btn--active' : ''}`}
            onClick={() => {
              searchStore.setSearchType('semantic');
              searchStore.warmupSemanticSearch().catch(() => {});
            }}
          >
            <i class="fa-solid fa-lightbulb" /> {t('search.ideas')}
          </button>
        </div>
        <div class="search-panel-inline__mobile-type-hint">
          {searchType === 'keyword'
            ? t('search.keywordHint')
            : t('search.ideasHint')}
        </div>
      </div>

      {query && (
        <div class="search-panel-inline__header">
          {/* W-045: a long unbroken query wraps instead of pushing the close button off-screen. */}
          <span class="search-panel-inline__title" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {strongsMode ? (
              <>
                <i class="fa-solid fa-language" style={{ opacity: 0.5, marginInlineEnd: '6px', fontSize: '0.85em' }} />
                {query}{showStrongsCount && <> ({strongsHeadline})</>}
              </>
            ) : (
              <>
                <i class={`fa-solid ${searchType === 'semantic' ? 'fa-lightbulb' : 'fa-magnifying-glass'}`} style={{ opacity: 0.5, marginInlineEnd: '6px', fontSize: '0.85em' }} />
                {/* W-063: a rejected query is shown once, as typed, with no count. */}
                {queryRejected ? query : quotedByUser ? query : `"${query}"`}{showCount && !queryRejected && !ideasFailed && <> ({headlineCount})</>}
              </>
            )}
          </span>
          {translationNote && (
            <span class="search-panel-inline__translation-note" data-testid="search-results-translation-note">{translationNote}</span>
          )}
          <button class="search-panel-inline__close" style={{ flexShrink: 0 }} onClick={handleClose} title={t('search.closeSearch')}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
      )}

      {/* Strong's word info header */}
      {strongsMode && strongsEntry && (
        <div class="strongs-search-header">
          <div class="strongs-search-header__entry">
            <span class="strongs-search-header__number">{strongsEntry.strongsNumber}</span>
            {strongsEntry.word && <span class="strongs-search-header__word">{strongsEntry.word}</span>}
            {strongsEntry.transliteration && (
              <span class="strongs-search-header__translit">({strongsEntry.transliteration})</span>
            )}
            {strongsEntry.gloss && (() => {
              const gloss = truncateAtWordBoundary(strongsEntry.gloss, GLOSS_PREVIEW_LENGTH);
              return (
                <>
                  <span
                    class="strongs-search-header__gloss"
                    title={gloss.truncated ? strongsEntry.gloss : undefined}
                  >
                    "{gloss.text}"
                  </span>
                  {/* Only advertised when there is more of the entry to see
                      than the header is showing. */}
                  {gloss.truncated && onOpenStrongsEntry && (
                    <button
                      type="button"
                      class="strongs-search-header__full-entry"
                      data-testid="strongs-full-entry"
                      title={t('search.strongsFullEntryTitle', { number: strongsEntry.strongsNumber })}
                      onClick={() => onOpenStrongsEntry(strongsEntry.strongsNumber)}
                    >
                      {t('search.strongsFullEntry')}
                    </button>
                  )}
                </>
              );
            })()}
          </div>
          {wordFamily.length > 0 && (
            <div class="strongs-search-header__family">
              <span class="strongs-search-header__family-label">{t('search.wordFamily')}</span>
              <div class="strongs-search-header__pills">
                {wordFamily.map(member => (
                  <button
                    key={member.strongsNumber}
                    type="button"
                    class="strongs-search-header__pill"
                    onClick={() => searchStore.performSearch(member.strongsNumber)}
                    title={`${member.word || ''} - ${member.gloss}`}
                  >
                    {member.strongsNumber}
                    {member.transliteration && ` ${member.transliteration}`}
                    {groupedCounts[member.strongsNumber] !== undefined && (
                      <span class="strongs-search-header__pill-count">({groupedCounts[member.strongsNumber]})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          {wordFamily.length > 0 && (
            <label class="strongs-search-header__toggle">
              <input
                type="checkbox"
                checked={includeRelated}
                onChange={() => searchStore.toggleIncludeRelated()}
              />
              {t('search.includeRelated')}
            </label>
          )}
        </div>
      )}
      <div class="search-panel-inline__results" ref={resultsRef}>
        {loading && (
          <div class="search-panel-inline__loading">
            <i class="fa-solid fa-spinner fa-spin" style={{ marginInlineEnd: '8px' }} />
            {t('search.searching')}
          </div>
        )}
        {!loading && searchType === 'semantic' && <SemanticNote meta={semanticMeta} />}
        {!loading && searchType === 'semantic' && keywordMatchCount > 0 && results.length > 0 && semanticMeta?.source !== 'keyword' && (
          <div class="search-panel-inline__keyword-banner">
            {t('search.keywordBanner', { count: keywordMatchCount })}{' '}
            <button
              type="button"
              class="search-panel-inline__suggestion-link"
              onClick={() => searchStore.switchToKeywordResults()}
            >
              {t('search.viewInstead')}
            </button>
          </div>
        )}
        {!loading && !query && (
          <div class="search-panel-inline__empty">
            {t('search.enterSearchTerm')}
          </div>
        )}
        {!loading && query && ideasFailed && (
          <div class="search-panel-inline__empty" role="status" data-testid="ideas-unavailable">
            {t('semanticSearchLoadingOverlay.unavailable')}
          </div>
        )}
        {/* W-035: the server rejected the query (unmatched quote or parenthesis); say so, as text. */}
        {!loading && query && results.length === 0 && searchError && (
          <div class="search-panel-inline__empty" role="alert" data-testid="search-query-error">
            {searchError}
          </div>
        )}
        {!loading && query && results.length === 0 && !isOnline && !searchError && (
          <div class="search-panel-inline__empty">
            <span>{t('search.offlineNotice')}</span>
          </div>
        )}
        {!loading && isSlashCommandQuery(query) && (
          <div class="search-panel-inline__empty" data-testid="slash-hint">
            {t('search.slashDesktopOnly')}
          </div>
        )}
        {!loading && query && results.length === 0 && isOnline && !searchError && !isSlashCommandQuery(query) && !(searchType === 'semantic' && ideasUnavailableShown) && (
          <div class="search-panel-inline__empty">
            {searchType === 'keyword' && searchedModule ? (
              <div class="search-panel-inline__no-results">
                <p dangerouslySetInnerHTML={{ __html: sanitizeHtml(t('search.noKeywordResults', { module: searchedModule })) }} />
                {(() => {
                  const otherModules = tabs
                    .filter(t => t.id !== activeTabId && t.moduleAbbr !== searchedModule)
                    .map(t => t.moduleAbbr)
                    .filter((v, i, a) => a.indexOf(v) === i);
                  if (otherModules.length > 0) {
                    return (
                      <p class="search-panel-inline__suggestions-row">
                        {t('search.tryIn')}{' '}
                        {otherModules.map((mod, i) => (
                          <span key={mod}>
                            {i > 0 && ', '}
                            <button
                              type="button"
                              class="search-panel-inline__suggestion-link"
                              onClick={() => {
                                const tab = tabs.find(t => t.moduleAbbr === mod);
                                if (tab) bibleStore.setActiveTab(tab.id);
                                searchStore.performSearch(query, 'keyword', [mod]);
                              }}
                            >
                              {mod}
                            </button>
                          </span>
                        ))}
                        ?
                      </p>
                    );
                  }
                  return null;
                })()}
                <p class="search-panel-inline__suggestions-row">
                  {t('search.orTryIdeas')}{' '}
                  <button
                    type="button"
                    class="search-panel-inline__suggestion-link"
                    onClick={() => {
                      searchStore.performSearch(query, 'semantic');
                      searchStore.warmupSemanticSearch().catch(() => {});
                    }}
                  >
                    {t('search.ideasSearchLink')}
                  </button>
                  {' '}{t('search.findByMeaning')}
                </p>
              </div>
            ) : (
              <span>{t('search.noResults')}</span>
            )}
          </div>
        )}
        {!loading && results.length > 0 && (
          <SearchDistributionChart
            results={results}
            // Empty for the modes that have no server-side counts, and the chart
            // is told nothing rather than told zero — it counts its own rows then.
            bookCounts={Object.keys(bookCounts).length > 0 ? bookCounts : undefined}
            mode={distributionMode}
            truncated={resultsTruncated}
            onSelectBook={selectBook}
          />
        )}
        {exactResults.map((result, i) => renderResult(result, `exact-${i}`))}
        {/* One divider, always exactly one, because the split is done here
            rather than trusted to the order the server happened to send. */}
        {fuzzyResults.length > 0 && (
          <div class="search-fuzzy-divider" data-testid="search-fuzzy-divider">
            <span class="search-fuzzy-divider__label">{t('search.approximateHeading')}</span>
            <span class="search-fuzzy-divider__hint">{t('search.approximateHint')}</span>
          </div>
        )}
        {fuzzyResults.map((result, i) => renderResult(result, `fuzzy-${i}`))}
        {/* Keyword search has no incremental paging — the endpoint has no offset
            and the chart already knows the size of the match set — so the one
            offer is the whole remainder. */}
        {!loading && !strongsMode && searchType === 'keyword' && keywordRemaining > 0 && (
          <div class="search-panel-inline__load-more">
            <button
              type="button"
              class="search-panel-inline__load-more-btn"
              data-testid="keyword-load-all"
              disabled={loadingMore}
              onClick={() => void loadAllThenFocus(() => searchStore.loadAllKeyword())}
            >
              {loadingMore ? (
                <><i class="fa-solid fa-spinner fa-spin" style={{ marginInlineEnd: '6px' }} />{t('search.loadingMore')}</>
              ) : (
                t('search.loadAll', { count: keywordRemaining })
              )}
            </button>
          </div>
        )}
        {!loading && (searchType === 'semantic' || strongsMode) && canLoadMore && (
          <div class="search-panel-inline__load-more">
            <button
              type="button"
              class="search-panel-inline__load-more-btn"
              disabled={loadingMore}
              onClick={() => (strongsMode ? searchStore.loadMoreStrongs() : searchStore.loadMoreSemantic())}
            >
              {loadingMore ? (
                <><i class="fa-solid fa-spinner fa-spin" style={{ marginInlineEnd: '6px' }} />{t('search.loadingMore')}</>
              ) : (
                t('search.showMore')
              )}
            </button>
            {/* A Strong's number has a known, finite occurrence count, so the user
                can jump straight to the end instead of paging through hundreds. */}
            {strongsMode && strongsRemaining > 0 && (
              <button
                type="button"
                class="search-panel-inline__load-more-btn"
                style={{ marginInlineStart: '8px' }}
                disabled={loadingMore}
                onClick={() => void loadAllThenFocus(() => searchStore.loadAllStrongs())}
              >
                {t('search.loadAll', { count: strongsRemaining })}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
