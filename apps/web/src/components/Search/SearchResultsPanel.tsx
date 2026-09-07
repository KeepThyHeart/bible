import { useState, useRef, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { searchStore, searchResultId } from '../../stores/searchStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { bibleStore } from '../../stores/bibleStore';
import { offlineStore } from '../../stores/offlineStore';
import { useStore } from '../../hooks/useStore';
import { SearchResultItem } from './SearchResultItem';
import { SearchDistributionChart, type SearchDistributionMode } from './SearchDistributionChart';
import { parseVerseId } from '../../utils/verseId';
import { sanitizeHtml } from '../../utils/sanitize';
import { truncateAtWordBoundary } from '@bible/core/browser';
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

export function SearchResultsPanel({ onNavigate, onOpenStrongsEntry }: SearchResultsPanelProps) {
  const { t } = useTranslation();
  const results = useStore(searchStore, () => searchStore.results);
  const loading = useStore(searchStore, () => searchStore.loading);
  const query = useStore(searchStore, () => searchStore.query);
  const totalResults = useStore(searchStore, () => searchStore.totalResults);
  const searchType = useStore(searchStore, () => searchStore.searchType);
  const searchedModule = useStore(searchStore, () => searchStore.searchedModule);
  const keywordMatchCount = useStore(searchStore, () => searchStore.keywordMatchCount);
  const canLoadMore = useStore(searchStore, () => searchStore.canLoadMore);
  const loadingMore = useStore(searchStore, () => searchStore.loadingMore);
  const tabs = useStore(bibleStore, () => bibleStore.tabs);
  const activeTabId = useStore(bibleStore, () => bibleStore.activeTabId);
  const strongsMode = useStore(searchStore, () => searchStore.strongsMode);
  const strongsEntry = useStore(searchStore, () => searchStore.strongsEntry);
  const wordFamily = useStore(searchStore, () => searchStore.wordFamily);
  const includeRelated = useStore(searchStore, () => searchStore.includeRelated);
  const groupedCounts = useStore(searchStore, () => searchStore.groupedCounts);
  const strongsRemaining = useStore(searchStore, () => searchStore.strongsRemaining);
  const lastClickedId = useStore(searchStore, () => searchStore.lastClickedId);
  const resultsTruncated = useStore(searchStore, () => searchStore.resultsTruncated);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);
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
   * A bar click moves the selection in the list and scrolls that row into view.
   * It deliberately does *not* navigate the Bible pane: at ~5px per bar on a
   * phone a mis-click has to be cheap, and the selection is undone by clicking
   * elsewhere.
   */
  const selectResult = (result: SearchResultData) => {
    const id = searchResultId(result);
    searchStore.setLastClickedId(id);
    // The row may not exist yet on the very first paint; querying after the
    // store notify is enough in practice because the list is already rendered.
    // Quoted attribute selector, so only a quote or backslash in the id would
    // need escaping. `CSS.escape` is deliberately not used — it is absent from
    // some of the DOM shims the tests run under.
    const selector = `[data-result-id="${id.replace(/["\\]/g, '\\$&')}"]`;
    const row = resultsRef.current?.querySelector<HTMLElement>(selector);
    row?.scrollIntoView({ block: 'nearest' });
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
    bibleStore.addTabWithPassage(result.module || bibleStore.getActiveTab()?.moduleAbbr || 'KJV', bookNumber, chapter, verse);
    onNavigate?.();
  };

  const handleClose = () => {
    searchStore.close();
    commentaryStore.setRightPaneMode('commentary');
  };

  const handleMobileSearch = (e: Event) => {
    e.preventDefault();
    const trimmed = mobileQuery.trim();
    if (!trimmed) return;
    // Both modes want the reader's translation: keyword searches its text,
    // semantic renders its matches in it. Left undefined when no translation is
    // open, which is what makes the server fall back to KJV.
    const activeModule = bibleStore.getActiveTab()?.moduleAbbr;
    const modules = activeModule ? [activeModule] : undefined;
    searchStore.performSearch(trimmed, undefined, modules);
    mobileInputRef.current?.blur();
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

  return (
    <div class="search-panel-inline">
      {/* Mobile search bar — hidden on desktop via CSS */}
      <div class="search-panel-inline__mobile-bar">
        <form class="search-panel-inline__mobile-form" onSubmit={handleMobileSearch} action="javascript:void(0)">
          <input
            ref={mobileInputRef}
            type="text"
            class="search-panel-inline__mobile-input"
            placeholder={t('search.placeholder')}
            value={mobileQuery}
            onInput={(e) => setMobileQuery((e.target as HTMLInputElement).value)}
          />
          <button type="submit" class="search-panel-inline__mobile-submit">
            <i class="fa-solid fa-magnifying-glass" />
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
          <span class="search-panel-inline__title">
            {strongsMode ? (
              <>
                <i class="fa-solid fa-language" style={{ opacity: 0.5, marginRight: '6px', fontSize: '0.85em' }} />
                {query} ({t('search.results', { count: totalResults })})
              </>
            ) : (
              <>
                <i class={`fa-solid ${searchType === 'semantic' ? 'fa-lightbulb' : 'fa-magnifying-glass'}`} style={{ opacity: 0.5, marginRight: '6px', fontSize: '0.85em' }} />
                "{query}" ({t('search.results', { count: totalResults })})
              </>
            )}
          </span>
          <button class="search-panel-inline__close" onClick={handleClose} title={t('search.closeSearch')}>
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
            <i class="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px' }} />
            {t('search.searching')}
          </div>
        )}
        {!loading && searchType === 'semantic' && keywordMatchCount > 0 && results.length > 0 && (
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
        {!loading && query && results.length === 0 && !isOnline && (
          <div class="search-panel-inline__empty">
            <span>{t('search.offlineNotice')}</span>
          </div>
        )}
        {!loading && query && results.length === 0 && isOnline && (
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
            mode={distributionMode}
            truncated={resultsTruncated}
            onSelectBook={selectResult}
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
        {!loading && (searchType === 'semantic' || strongsMode) && canLoadMore && (
          <div class="search-panel-inline__load-more">
            <button
              type="button"
              class="search-panel-inline__load-more-btn"
              disabled={loadingMore}
              onClick={() => (strongsMode ? searchStore.loadMoreStrongs() : searchStore.loadMoreSemantic())}
            >
              {loadingMore ? (
                <><i class="fa-solid fa-spinner fa-spin" style={{ marginRight: '6px' }} />{t('search.loadingMore')}</>
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
                style={{ marginLeft: '8px' }}
                disabled={loadingMore}
                onClick={() => searchStore.loadAllStrongs()}
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
