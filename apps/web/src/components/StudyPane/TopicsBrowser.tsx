import { useState, useCallback, useRef, useEffect, useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { formatPassageRef } from '../../constants';
import { parseVerseId } from '../../utils/verseId';
import type {
  VerseTopicData,
  TagGraphEntityData,
  TopicDetailData,
  TopicVerseData,
  TopicSearchResultData,
  TagGraphSearchResultData,
  TagGraphEntityDetailData,
  TagGraphAssociationData,
  TagGraphVerseData,
  TagGraphTopicLinkData,
} from '../../types';
import type { ITopicalDataProvider, ITagGraphDataProvider, IBibleDataProvider } from '../../providers/interfaces';
import type { PendingTopicNav } from '../../stores/commentaryStore';
import { VerseRefList } from './VerseRefList';

interface TopicsBrowserProps {
  verseId: number | null;
  verseTopics: VerseTopicData[];
  verseEntities: TagGraphEntityData[];
  loading: boolean;
  onNavigateBible?: (verseId: number) => void;
  onOpenInTab?: (topicId: number, module: string) => void;
  topicalProvider?: ITopicalDataProvider;
  tagGraphProvider?: ITagGraphDataProvider;
  bibleProvider?: IBibleDataProvider;
  /**
   * A topic another pane asked us to open. Honoured on mount *and* whenever
   * `token` changes, so a request raised while this browser is already on
   * screen navigates instead of being silently dropped.
   */
  topicRequest?: PendingTopicNav;
  /** Called once `topicRequest` has actually been opened, so the store can clear it. */
  onTopicRequestHandled?: () => void;
  /** Simplified mobile layout: "Back to Verse Topics" link instead of nav bar, collapsible search */
  mobile?: boolean;
}

interface NavEntry {
  type: 'home' | 'topic' | 'entity';
  topicId?: number;
  module?: string;
  topicName?: string;
  sourceName?: string;
  entityId?: string;
  entityCategory?: string;
  entityName?: string;
  /** Preserved search state so Back restores results without re-fetching */
  searchQuery?: string;
  searchResultsCache?: TopicSearchResultData[];
  entitySearchResultsCache?: TagGraphSearchResultData[];
}

/**
 * Where the browser was when it was last unmounted, per layout.
 *
 * The Topics pane is mounted only while its tab is selected, so switching to
 * Commentary and back used to drop the reader back at the verse-topic list and
 * lose however deep they had browsed. The nav stack is the only state worth
 * keeping — the loaded detail is re-fetched on restore, so nothing stale is
 * ever shown.
 */
const savedNav = new Map<string, { history: NavEntry[]; historyIndex: number }>();

/** Drop the remembered nav stacks. Exposed for tests, which mount many browsers in one module. */
export function resetTopicsBrowserNav(): void {
  savedNav.clear();
}

function formatVerseRef(verseId: number): string {
  const { bookNumber, chapter, verse } = parseVerseId(verseId);
  return formatPassageRef(bookNumber, chapter, verse);
}

function entityIcon(category: string): string {
  switch (category) {
    case 'people': return '\u{1F9D1}';
    case 'places': return '\u{1F4CD}';
    case 'themes': return '\u{1F3F7}';
    default: return '\u{1F4E6}';
  }
}

export function TopicsBrowser({
  verseId,
  verseTopics,
  verseEntities,
  loading,
  onNavigateBible,
  topicalProvider,
  tagGraphProvider,
  bibleProvider,
  topicRequest,
  onTopicRequestHandled,
  mobile,
}: TopicsBrowserProps) {
  const { t } = useTranslation();

  // The request present on the very first render seeds the nav stack, so the
  // topic's title is on screen in the first painted frame rather than after a
  // flash of the Home list.
  const seedRequestRef = useRef<PendingTopicNav | undefined>(topicRequest);
  const seed = seedRequestRef.current;

  // Navigation history stack — the requested topic wins, then whatever the
  // reader was looking at before this pane was last unmounted, then Home.
  const navKey = mobile ? 'mobile' : 'desktop';
  const restored = seed ? undefined : savedNav.get(navKey);
  const initialNav: NavEntry[] = seed
    ? [{ type: 'home' }, { type: 'topic', topicId: seed.topicId, module: seed.module, topicName: seed.topicName, sourceName: seed.sourceName }]
    : restored?.history ?? [{ type: 'home' }];
  const [history, setHistory] = useState<NavEntry[]>(initialNav);
  const [historyIndex, setHistoryIndex] = useState(seed ? 1 : restored?.historyIndex ?? 0);
  /** Last request token acted on, so re-renders don't re-navigate. */
  const handledTokenRef = useRef<number | undefined>(seed?.token);

  // Topic detail state
  const [topicDetail, setTopicDetail] = useState<TopicDetailData | null>(null);
  const [topicVerses, setTopicVerses] = useState<TopicVerseData[]>([]);
  const [verseOffset, setVerseOffset] = useState(0);
  const [versesLoadingMore, setVersesLoadingMore] = useState(false);
  /**
   * Set once a page comes back shorter than the page size. This is what stops
   * "Load more", not a server count: `verse_count` expands ranges while the
   * verses endpoint returns one row per link, so comparing the two left a
   * button that stayed forever and fetched an empty page on every click.
   */
  const [versesExhausted, setVersesExhausted] = useState(false);

  // Sub-topic filter & sort
  const [subtopicFilter, setSubtopicFilter] = useState('');
  const [subtopicSort, setSubtopicSort] = useState<'default' | 'az'>('default');

  // Entity detail state
  const [entityDetail, setEntityDetail] = useState<TagGraphEntityDetailData | null>(null);
  const [entityAssociations, setEntityAssociations] = useState<TagGraphAssociationData[]>([]);
  const [entityVerses, setEntityVerses] = useState<TagGraphVerseData[]>([]);
  const [entityTopicLinks, setEntityTopicLinks] = useState<TagGraphTopicLinkData[]>([]);

  // Associations filter & expand state
  const [assocFilter, setAssocFilter] = useState('');
  const [assocExpanded, setAssocExpanded] = useState<Set<string>>(new Set());

  // Shared loading state for detail views
  const [detailLoading, setDetailLoading] = useState(false);
  /**
   * Why the current detail view has no content, when it has none.
   *
   * Without this every failure — a provider that isn't wired up, a 404, a
   * dropped connection — rendered as an empty pane under a topic title, which
   * is indistinguishable from "this topic is empty" and from the app hanging.
   */
  const [detailError, setDetailError] = useState<string | null>(null);
  /**
   * Generation counter for detail loads. Without it two overlapping loads can
   * interleave — the slower one's `clearDetail()` landing after the faster
   * one's `setTopicDetail()` — leaving a titled but permanently blank pane.
   */
  const loadSeqRef = useRef(0);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TopicSearchResultData[]>([]);
  const [entitySearchResults, setEntitySearchResults] = useState<TagGraphSearchResultData[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<any>(null);

  // Memoize mapped verse arrays to prevent VerseRefList from clearing its
  // cache on every parent re-render (the .map() creates new references).
  const topicVerseMapped = useMemo(() =>
    topicVerses.map(tv => ({
      startVerseId: tv.start_verse_id,
      endVerseId: tv.end_verse_id !== tv.start_verse_id ? tv.end_verse_id : undefined,
      context: tv.context,
    })),
    [topicVerses]
  );

  const entityVerseMapped = useMemo(() =>
    entityVerses.map(ev => ({
      startVerseId: ev.startVerseId,
      endVerseId: ev.endVerseId !== ev.startVerseId ? ev.endVerseId : undefined,
    })),
    [entityVerses]
  );

  // Load the seeded topic on mount — or re-load whatever the restored nav
  // stack points at, so a restored entry never lands on an empty pane.
  useEffect(() => {
    const request = seedRequestRef.current;
    if (request) {
      onTopicRequestHandled?.();
      loadTopic(request.module, request.topicId);
      return;
    }
    const entry = initialNav[historyIndex];
    if (entry && entry.type !== 'home') loadNavEntry(entry);
  }, []);

  // Remember the nav stack for the next mount.
  useEffect(() => {
    savedNav.set(navKey, { history, historyIndex });
  }, [history, historyIndex, navKey]);

  // Honour requests that arrive while this browser is already mounted. A
  // reader of the pending request that runs only on mount drops them entirely.
  useEffect(() => {
    const token = topicRequest?.token;
    if (!topicRequest || token === undefined || token === handledTokenRef.current) return;
    handledTokenRef.current = token;
    onTopicRequestHandled?.();
    navigateTo({
      type: 'topic',
      topicId: topicRequest.topicId,
      module: topicRequest.module,
      topicName: topicRequest.topicName,
      sourceName: topicRequest.sourceName,
    });
  }, [topicRequest?.token]);

  const currentEntry = history[historyIndex];
  const isHome = currentEntry.type === 'home';
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  // Clear all detail state
  const clearDetail = () => {
    setDetailError(null);
    setTopicDetail(null);
    setTopicVerses([]);
    setVerseOffset(0);
    setVersesExhausted(false);
    setEntityDetail(null);
    setEntityAssociations([]);
    setEntityVerses([]);
    setEntityTopicLinks([]);
    setAssocFilter('');
    setAssocExpanded(new Set());
  };

  const navigateTo = useCallback((entry: NavEntry, preserveSearch?: { query: string; topics: TopicSearchResultData[]; entities: TagGraphSearchResultData[] }) => {
    const newHistory = history.slice(0, historyIndex + 1);
    // Save the active search state on the current entry so Back can restore it
    if (preserveSearch && newHistory.length > 0) {
      newHistory[newHistory.length - 1] = {
        ...newHistory[newHistory.length - 1],
        searchQuery: preserveSearch.query,
        searchResultsCache: preserveSearch.topics,
        entitySearchResultsCache: preserveSearch.entities,
      };
    }
    newHistory.push(entry);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    if (entry.type === 'topic' && entry.topicId && entry.module) {
      loadTopic(entry.module, entry.topicId);
    } else if (entry.type === 'entity' && entry.entityId && entry.entityCategory) {
      loadEntity(entry.entityCategory, entry.entityId);
    }
  }, [history, historyIndex, topicalProvider, tagGraphProvider]);

  const loadNavEntry = (entry: NavEntry) => {
    if (entry.type === 'topic' && entry.topicId && entry.module) {
      loadTopic(entry.module, entry.topicId);
      setSearchQuery('');
      setSearchResults([]);
      setEntitySearchResults([]);
    } else if (entry.type === 'entity' && entry.entityId && entry.entityCategory) {
      loadEntity(entry.entityCategory, entry.entityId);
      setSearchQuery('');
      setSearchResults([]);
      setEntitySearchResults([]);
    } else {
      clearDetail();
      // Restore cached search results directly (no re-fetch)
      if (entry.searchQuery && entry.searchResultsCache) {
        setSearchQuery(entry.searchQuery);
        setSearchResults(entry.searchResultsCache);
        setEntitySearchResults(entry.entitySearchResultsCache ?? []);
        setSearching(false);
      } else {
        setSearchQuery('');
        setSearchResults([]);
        setEntitySearchResults([]);
      }
    }
  };

  const goBack = () => {
    if (!canGoBack) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    loadNavEntry(history[newIndex]);
  };

  const goForward = () => {
    if (!canGoForward) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    loadNavEntry(history[newIndex]);
  };

  const goHome = () => {
    setHistoryIndex(0);
    setHistory([{ type: 'home' }]);
    clearDetail();
    setSearchQuery('');
    setSearchResults([]);
    setEntitySearchResults([]);
  };

  const VERSE_PAGE_SIZE = 100;

  const loadTopic = async (module: string, topicId: number) => {
    const seq = ++loadSeqRef.current;
    setDetailLoading(true);
    setDetailError(null);
    clearDetail();
    setSubtopicFilter('');
    setSubtopicSort('default');
    if (!topicalProvider) {
      // Returning silently here left `detailLoading` false and `topicDetail`
      // null: a topic title over an empty pane, with nothing in the console.
      setDetailLoading(false);
      setDetailError(t('topicsBrowser.topicUnavailable'));
      return;
    }
    try {
      const [detail, verses] = await Promise.all([
        topicalProvider.getTopic(module, topicId),
        topicalProvider.getVersesForTopic(module, topicId, VERSE_PAGE_SIZE, 0),
      ]);
      if (seq !== loadSeqRef.current) return;  // a newer load superseded this one
      if (!detail) {
        setDetailError(t('topicsBrowser.topicUnavailable'));
      } else {
        setTopicDetail(detail);
        setTopicVerses(verses);
        setVerseOffset(verses.length);
        setVersesExhausted(verses.length < VERSE_PAGE_SIZE);
      }
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      console.error('Error loading topic:', error);
      setDetailError(t('topicsBrowser.topicLoadFailed'));
    }
    if (seq === loadSeqRef.current) setDetailLoading(false);
  };

  const loadMoreVerses = async () => {
    const entry = history[historyIndex];
    if (!entry.module || !entry.topicId || !topicalProvider || versesLoadingMore) return;
    setVersesLoadingMore(true);
    try {
      const more = await topicalProvider.getVersesForTopic(entry.module, entry.topicId, VERSE_PAGE_SIZE, verseOffset);
      setTopicVerses(prev => [...prev, ...more]);
      setVerseOffset(prev => prev + more.length);
      if (more.length < VERSE_PAGE_SIZE) setVersesExhausted(true);
    } catch (error) {
      console.error('Error loading more verses:', error);
      // Don't retry blindly against a failing endpoint.
      setVersesExhausted(true);
    }
    setVersesLoadingMore(false);
  };

  const loadEntity = async (category: string, entityId: string) => {
    const seq = ++loadSeqRef.current;
    setDetailLoading(true);
    setDetailError(null);
    clearDetail();
    if (!tagGraphProvider) {
      setDetailLoading(false);
      setDetailError(t('topicsBrowser.entityUnavailable'));
      return;
    }
    try {
      // Use allSettled so one failing endpoint doesn't block the rest
      const [detailR, assocR, versesR, linksR] = await Promise.allSettled([
        tagGraphProvider.getEntity(category, entityId),
        tagGraphProvider.getAssociations(category, entityId),
        tagGraphProvider.getVersesForEntity(category, entityId),
        tagGraphProvider.getTopicLinksForEntity(category, entityId),
      ]);
      if (seq !== loadSeqRef.current) return;
      if (detailR.status === 'fulfilled') setEntityDetail(detailR.value);
      if (assocR.status === 'fulfilled') setEntityAssociations(assocR.value);
      if (versesR.status === 'fulfilled') setEntityVerses(versesR.value);
      if (linksR.status === 'fulfilled') setEntityTopicLinks(linksR.value);
      if (detailR.status !== 'fulfilled' || !detailR.value) {
        setDetailError(t('topicsBrowser.entityUnavailable'));
      }
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      console.error('Error loading entity:', error);
      setDetailError(t('topicsBrowser.entityUnavailable'));
    }
    if (seq === loadSeqRef.current) setDetailLoading(false);
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!value.trim()) {
      setSearchResults([]);
      setEntitySearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const [topicResults, entityResults] = await Promise.all([
          topicalProvider?.searchTopics(value.trim()) ?? Promise.resolve([]),
          tagGraphProvider?.searchEntities(value.trim()) ?? Promise.resolve([]),
        ]);
        setSearchResults(topicResults);
        setEntitySearchResults(entityResults);
      } catch {
        setSearchResults([]);
        setEntitySearchResults([]);
      }
      setSearching(false);
    }, 300);
  };

  const handleTopicClick = (topicId: number, module: string, topicName: string, sourceName?: string) => {
    const snapshot = searchQuery ? { query: searchQuery, topics: searchResults, entities: entitySearchResults } : undefined;
    setSearchQuery('');
    setSearchResults([]);
    setEntitySearchResults([]);
    navigateTo({ type: 'topic', topicId, module, topicName, sourceName: sourceName ?? currentEntry.sourceName }, snapshot);
  };

  const handleEntityClick = (entityId: string, category: string, name: string) => {
    const snapshot = searchQuery ? { query: searchQuery, topics: searchResults, entities: entitySearchResults } : undefined;
    setSearchQuery('');
    setSearchResults([]);
    setEntitySearchResults([]);
    navigateTo({ type: 'entity', entityId, entityCategory: category, entityName: name }, snapshot);
  };

  // Shared nav bar
  const renderNav = (showTitle?: boolean) => {
    if (mobile) {
      // Mobile: show back button when not at home
      if (!isHome) {
        return (
          <div class="topics-browser__mobile-nav">
            <button class="topics-browser__mobile-back" onClick={goBack} disabled={!canGoBack}>
              <i class="fa-solid fa-chevron-left" /> {t('topicsBrowser.back')}
            </button>
          </div>
        );
      }
      return null;
    }
    return (
      <div class="topics-browser__nav">
        <button class="topics-browser__nav-btn" onClick={isHome ? undefined : goHome} disabled={isHome} title={t('topicsBrowser.home')}>
          <i class="fa-solid fa-house" />
        </button>
        <button class="topics-browser__nav-btn" disabled={!canGoBack} onClick={goBack}>
          <i class="fa-solid fa-arrow-left" />
        </button>
        <button class="topics-browser__nav-btn" disabled={!canGoForward} onClick={goForward}>
          <i class="fa-solid fa-arrow-right" />
        </button>
        {showTitle && currentEntry.type === 'topic' && currentEntry.topicName && (
          <span class="topics-browser__title">
            {currentEntry.topicName}
          </span>
        )}
        {showTitle && currentEntry.type === 'entity' && currentEntry.entityName && (
          <span class="topics-browser__title">
            {entityIcon(currentEntry.entityCategory ?? '')} {currentEntry.entityName}
          </span>
        )}
      </div>
    );
  };

  const renderSearchBar = () => (
    <div class="topics-browser__search">
      <input
        type="text"
        class="topics-browser__search-input"
        placeholder={t('topicsBrowser.searchPlaceholder')}
        value={searchQuery}
        onInput={(e) => handleSearch((e.target as HTMLInputElement).value)}
      />
      {searchQuery && (
        <button
          class="topics-browser__search-cancel"
          onClick={() => handleSearch('')}
        >
          <i class="fa-solid fa-xmark" />
        </button>
      )}
    </div>
  );

  // Group verse topics by source for hierarchical list display (matches StudyTopics format)
  const groupedVerseTopics = useMemo(() => {
    const groups = new Map<string, { sourceName: string; topics: typeof verseTopics }>();
    for (const topic of verseTopics) {
      const key = topic.source_abbreviation;
      if (!groups.has(key)) {
        groups.set(key, { sourceName: topic.source_name, topics: [] });
      }
      groups.get(key)!.topics.push(topic);
    }
    return [...groups.values()];
  }, [verseTopics]);

  // ========== Render: Home view ==========
  if (isHome && !searchQuery) {
    const verseLabel = verseId ? formatVerseRef(verseId) : null;

    return (
      <div class="topics-browser">
        {renderNav()}
        {renderSearchBar()}

        {loading && <div class="topics-browser__loading">{t('topicsBrowser.loading')}</div>}

        {!loading && verseTopics.length === 0 && verseEntities.length === 0 && (
          <div class="topics-browser__empty">{t('topicsBrowser.noTopicsVerse')}</div>
        )}

        {groupedVerseTopics.length > 0 && (
          <div class="topics-browser__section">
            <div class="topics-browser__section-header">
              {verseLabel
                ? t('topicsBrowser.topicsForVerse', { verse: verseLabel })
                : t('topicsBrowser.topicalIndexes')}
            </div>
            <div class="study-topics">
              {groupedVerseTopics.map(group => (
                <div key={group.sourceName} class="study-topics__group">
                  <div class="study-topics__group-label">{group.sourceName}</div>
                  <ul class="study-topics__list">
                    {group.topics.map(topic => (
                      <li key={`${topic.source_abbreviation}-${topic.topic_id}`}>
                        <span class="study-topics__chain">
                          {topic.ancestors.map((a, i) => (
                            <span key={`${i}-${a.topic_id}`}>
                              {i > 0 && <span class="study-topics__chain-sep"> &gt; </span>}
                              {a.topic_id > 0 ? (
                                <span
                                  class="study-topics__chain-link"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => handleTopicClick(a.topic_id, topic.source_abbreviation, a.name, topic.source_name)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') handleTopicClick(a.topic_id, topic.source_abbreviation, a.name, topic.source_name); }}
                                >{a.name}{a.verse_count > 0 && <span class="study-topics__count">&nbsp;({a.verse_count})</span>}</span>
                              ) : (
                                // See StudyTopics: an id-less ancestor from an
                                // older study cache is text, not a link.
                                <span class="study-topics__chain-name">{a.name}</span>
                              )}
                            </span>
                          ))}
                          {topic.ancestors.length > 0 && <span class="study-topics__chain-sep"> &gt; </span>}
                          <span
                            class="study-topics__chain-link study-topics__chain-current"
                            role="button"
                            tabIndex={0}
                            onClick={() => handleTopicClick(topic.topic_id, topic.source_abbreviation, topic.name, topic.source_name)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleTopicClick(topic.topic_id, topic.source_abbreviation, topic.name, topic.source_name); }}
                          >{topic.name}<span class="study-topics__count">&nbsp;({topic.verse_count})</span></span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {verseEntities.length > 0 && (
          <div class="topics-browser__section">
            <div class="topics-browser__section-header">{t('topicsBrowser.relatedEntities')}</div>
            {verseEntities.map(entity => (
              <button
                key={`${entity.category}-${entity.entity_id}`}
                class="entity-card entity-card--clickable"
                onClick={() => handleEntityClick(entity.entity_id, entity.category, entity.name)}
              >
                <div class="entity-card__header">
                  <span class="entity-card__icon">{entityIcon(entity.category)}</span>
                  <span class="entity-card__name">{entity.name}</span>
                  <span class="entity-card__badge">{entity.category}</span>
                </div>
                {entity.notes && (
                  <div class="entity-card__notes">{entity.notes.substring(0, 120)}{entity.notes.length > 120 ? '...' : ''}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ========== Render: Search results ==========
  if (searchQuery) {
    return (
      <div class="topics-browser">
        {renderNav()}
        {renderSearchBar()}

        {!searching && (searchResults.length > 0 || entitySearchResults.length > 0) && (
          <div class="topics-browser__section-header">{t('topicsBrowser.searchResultsFor', { query: searchQuery })}</div>
        )}

        {searching && <div class="topics-browser__loading">{t('topicsBrowser.searching')}</div>}
        {!searching && searchResults.length === 0 && entitySearchResults.length === 0 && searchQuery.trim() && (
          <div class="topics-browser__empty">{t('topicsBrowser.noTopicsSearch', { query: searchQuery })}</div>
        )}

        {entitySearchResults.length > 0 && (
          <div class="topics-browser__section">
            <div class="topics-browser__section-header">{t('topicsBrowser.entities')}</div>
            {entitySearchResults.map(entity => (
              <button
                key={`entity-${entity.category}-${entity.id}`}
                class="entity-card entity-card--clickable"
                onClick={() => handleEntityClick(entity.id, entity.category, entity.name)}
              >
                <div class="entity-card__header">
                  <span class="entity-card__icon">{entityIcon(entity.category)}</span>
                  <span class="entity-card__name">{entity.name}</span>
                  <span class="entity-card__badge">{entity.category}</span>
                </div>
                {entity.notes && (
                  <div class="entity-card__notes">{entity.notes.substring(0, 120)}{entity.notes.length > 120 ? '...' : ''}</div>
                )}
              </button>
            ))}
          </div>
        )}

        {searchResults.length > 0 && (() => {
          // Group search results by source, same as home view
          const groups = new Map<string, { sourceName: string; results: typeof searchResults }>();
          for (const result of searchResults) {
            const key = result.source_abbreviation;
            if (!groups.has(key)) {
              groups.set(key, { sourceName: result.source_name, results: [] });
            }
            groups.get(key)!.results.push(result);
          }
          return (
            <div class="topics-browser__section">
              <div class="topics-browser__section-header">{t('topicsBrowser.topicalIndexes')}</div>
              <div class="study-topics">
                {[...groups.values()].map(group => (
                  <div key={group.sourceName} class="study-topics__group">
                    <div class="study-topics__group-label">{group.sourceName}</div>
                    <ul class="study-topics__list">
                      {group.results.map(result => (
                        <li key={`${result.source_abbreviation}-${result.topic_id}`}>
                          <span class="study-topics__chain">
                            {result.ancestors.map((a, i) => (
                              <span key={a.topic_id}>
                                {i > 0 && <span class="study-topics__chain-sep"> &gt; </span>}
                                <span
                                  class="study-topics__chain-link"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => handleTopicClick(a.topic_id, result.source_abbreviation, a.name, result.source_name)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') handleTopicClick(a.topic_id, result.source_abbreviation, a.name, result.source_name); }}
                                >{a.name}{a.verse_count > 0 && <span class="study-topics__count">&nbsp;({a.verse_count})</span>}</span>
                              </span>
                            ))}
                            {result.ancestors.length > 0 && <span class="study-topics__chain-sep"> &gt; </span>}
                            <span
                              class="study-topics__chain-link study-topics__chain-current"
                              role="button"
                              tabIndex={0}
                              onClick={() => handleTopicClick(result.topic_id, result.source_abbreviation, result.name, result.source_name)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleTopicClick(result.topic_id, result.source_abbreviation, result.name, result.source_name); }}
                            >{result.name}<span class="study-topics__count">&nbsp;({result.verse_count})</span></span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // ========== Render: Entity detail ==========
  if (currentEntry.type === 'entity') {
    return (
      <div class="topics-browser">
        {renderNav(true)}

        {detailLoading && <div class="topics-browser__loading">{t('topicsBrowser.loadingEntity')}</div>}

        {!detailLoading && !entityDetail && (
          <div class="topics-browser__empty">{detailError ?? t('topicsBrowser.entityUnavailable')}</div>
        )}

        {!detailLoading && entityDetail && (
          <div class="topics-browser__detail">
            {entityDetail.notes && (
              <div class="topics-browser__entity-notes">{entityDetail.notes as string}</div>
            )}

            {/* Entity-specific fields (roles, tribe, nation, etc.) */}
            {entityDetail.roles && Array.isArray(entityDetail.roles) && (entityDetail.roles as string[]).length > 0 && (
              <div class="topics-browser__entity-meta">
                <span class="topics-browser__entity-meta-label">{t('topicsBrowser.roles')}</span> {(entityDetail.roles as string[]).join(', ')}
              </div>
            )}

            {entityTopicLinks.length > 0 && (
              <div class="topics-browser__topic-links">
                <div class="topics-browser__section-header">
                  {t('topicsBrowser.inTopicalIndexes', { count: entityTopicLinks.length })}
                </div>
                {entityTopicLinks.map(link => (
                  <button
                    key={`${link.source_module}-${link.topic_id}`}
                    class="topic-card topic-card--child"
                    onClick={() => handleTopicClick(link.topic_id, link.source_module, link.topic_name ?? `Topic #${link.topic_id}`, link.source_name ?? undefined)}
                  >
                    <div class="topic-card__header">
                      <span class="topic-card__name">{link.topic_name ?? `Topic #${link.topic_id}`}</span>
                      <span class="topic-card__meta">
                        <span class="topic-card__source">{link.source_name ?? link.source_module}</span>
                        {link.verse_count != null && <span class="topic-card__count">{link.verse_count}v</span>}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {entityAssociations.length > 0 && (() => {
              const CATEGORY_ORDER = ['people', 'places', 'themes', 'objects'];
              const CATEGORY_LABELS: Record<string, string> = { people: t('topicsBrowser.entityTypes.people'), places: t('topicsBrowser.entityTypes.places'), themes: t('topicsBrowser.entityTypes.themes'), objects: t('topicsBrowser.entityTypes.objects') };
              const CARDS_COLLAPSED = 6;

              // Filter associations
              const lf = assocFilter.toLowerCase();
              const filtered = lf
                ? entityAssociations.filter(a =>
                    a.entity2Name.toLowerCase().includes(lf) || a.relationshipName.toLowerCase().includes(lf))
                : entityAssociations;

              // Group by category
              const grouped = new Map<string, TagGraphAssociationData[]>();
              for (const assoc of filtered) {
                const cat = assoc.entity2Category;
                if (!grouped.has(cat)) grouped.set(cat, []);
                grouped.get(cat)!.push(assoc);
              }

              const sortedCategories = CATEGORY_ORDER.filter(c => grouped.has(c));
              // Append any categories not in the predefined order
              for (const cat of grouped.keys()) {
                if (!sortedCategories.includes(cat)) sortedCategories.push(cat);
              }

              return (
                <div class="topics-browser__associations">
                  <div class="topics-browser__section-header">
                    {t('topicsBrowser.related', { count: entityAssociations.length })}
                  </div>
                  {entityAssociations.length > 8 && (
                    <input
                      type="text"
                      class="topics-browser__assoc-filter"
                      placeholder={t('topicsBrowser.filterRelated')}
                      value={assocFilter}
                      onInput={(e) => setAssocFilter((e.target as HTMLInputElement).value)}
                    />
                  )}
                  {sortedCategories.map(cat => {
                    const items = grouped.get(cat)!;
                    const isExpanded = assocExpanded.has(cat);
                    const visible = isExpanded ? items : items.slice(0, CARDS_COLLAPSED);
                    const label = CATEGORY_LABELS[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);

                    return (
                      <div key={cat} class="topics-browser__assoc-category">
                        <div class="topics-browser__assoc-category-header">
                          <span class="topics-browser__assoc-category-icon">{entityIcon(cat)}</span>
                          <span>{label} ({items.length})</span>
                        </div>
                        <div class="topics-browser__assoc-grid">
                          {visible.map(assoc => (
                            <button
                              key={assoc.id}
                              class="entity-card entity-card--clickable entity-card--compact entity-card--grid"
                              onClick={() => handleEntityClick(assoc.entity2Id, assoc.entity2Category, assoc.entity2Name)}
                            >
                              <div class="entity-card__name">{assoc.entity2Name}</div>
                              <div class="entity-card__relationship">{assoc.relationshipName}</div>
                            </button>
                          ))}
                        </div>
                        {items.length > CARDS_COLLAPSED && (
                          <button
                            class="topics-browser__assoc-expand"
                            onClick={() => {
                              const next = new Set(assocExpanded);
                              if (isExpanded) next.delete(cat); else next.add(cat);
                              setAssocExpanded(next);
                            }}
                          >
                            {isExpanded ? t('topicsBrowser.showFewer') : `${t('topicsBrowser.showMore')} ${items.length - CARDS_COLLAPSED} more`}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {assocFilter && sortedCategories.length === 0 && (
                    <div class="topics-browser__empty">{t('topicsBrowser.noRelatedMatch', { query: assocFilter })}</div>
                  )}
                </div>
              );
            })()}

            {entityVerses.length > 0 && (
              <div class="topics-browser__verses">
                <div class="topics-browser__section-header">
                  {t('topicsBrowser.verses', { count: entityVerses.length })}
                </div>
                <VerseRefList
                  verses={entityVerseMapped}
                  onNavigateBible={onNavigateBible}
                  bibleProvider={bibleProvider}
                  storageKey="bible-entity-verses-show"
                />
              </div>
            )}

            {entityAssociations.length === 0 && entityVerses.length === 0 && entityTopicLinks.length === 0 && !entityDetail.notes && (
              <div class="topics-browser__empty">{t('topicsBrowser.noAdditionalDetails')}</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ========== Render: Topic detail ==========
  return (
    <div class="topics-browser">
      {renderNav(true)}

      {detailLoading && <div class="topics-browser__loading">{t('topicsBrowser.loadingTopic')}</div>}

      {/* A blank pane under a topic title reads as a hung app. Say what
          happened instead — the failure is invisible otherwise. */}
      {!detailLoading && !topicDetail && (
        <div class="topics-browser__empty">{detailError ?? t('topicsBrowser.topicUnavailable')}</div>
      )}

      {!detailLoading && topicDetail && (
        <div class="topics-browser__detail">
          {mobile ? (
            <>
              <div class="topics-browser__mobile-topic-title">{currentEntry.topicName}</div>
              {topicDetail.parent_chain && topicDetail.parent_chain.length > 0 && (
                <div class="topics-browser__mobile-hierarchy">
                  {topicDetail.parent_chain.map((p, i) => (
                    <span key={p.topic_id}>
                      {i > 0 && <span class="topics-browser__breadcrumb-sep"> &gt; </span>}
                      <button
                        class="topics-browser__breadcrumb-link"
                        onClick={() => handleTopicClick(p.topic_id, currentEntry.module!, p.name)}
                      >{p.name}</button>
                    </span>
                  ))}
                  <span class="topics-browser__breadcrumb-sep"> &gt; </span>
                  <span class="topics-browser__breadcrumb-current">{currentEntry.topicName}</span>
                </div>
              )}
              {currentEntry.sourceName && (
                <div class="topics-browser__mobile-source">{currentEntry.sourceName}</div>
              )}
            </>
          ) : (
            <>
              {currentEntry.sourceName && (
                <div class="topics-browser__source-subtitle">{currentEntry.sourceName}</div>
              )}
              <div class="topics-browser__breadcrumb">
                {topicDetail.parent_chain && topicDetail.parent_chain.length > 0 && (
                  <>
                    {topicDetail.parent_chain.map((p, i) => (
                      <span key={p.topic_id}>
                        {i > 0 && <span class="topics-browser__breadcrumb-sep"> &gt; </span>}
                        <button
                          class="topics-browser__breadcrumb-link"
                          onClick={() => handleTopicClick(p.topic_id, currentEntry.module!, p.name)}
                        >{p.name}</button>
                      </span>
                    ))}
                    <span class="topics-browser__breadcrumb-sep"> &gt; </span>
                  </>
                )}
                <span class="topics-browser__breadcrumb-current">{currentEntry.topicName}</span>
              </div>
            </>
          )}

          {/*
            Redirect topics ("Abarim" -> "See NEBO") have no children and no
            verse links — 813 of them in Nave's. Without rendering the
            description they painted a breadcrumb over an empty pane, which is
            what "clicking a topic shows nothing" turned out to be.
          */}
          {topicDetail.topic.description && (
            <div class="topics-browser__description">
              {(() => {
                const seeAlso = /^see\s+(.+?)\.?$/i.exec(topicDetail.topic.description.trim());
                if (!seeAlso) return topicDetail.topic.description;
                const target = seeAlso[1];
                return (
                  <>
                    {t('topicsBrowser.seeAlso')}{' '}
                    <button
                      class="topics-browser__see-also"
                      onClick={() => handleSearch(target)}
                    >{target}</button>
                  </>
                );
              })()}
            </div>
          )}

          {!detailLoading && topicDetail.children.length === 0 && topicVerses.length === 0
            && !topicDetail.topic.description && (
            <div class="topics-browser__empty">{t('topicsBrowser.topicHasNoEntries')}</div>
          )}

          {topicDetail.children.length > 0 && (() => {
            // Filter and sort sub-topics
            let filtered = topicDetail.children;
            if (subtopicFilter) {
              const lf = subtopicFilter.toLowerCase();
              filtered = filtered.filter(c => c.name.toLowerCase().includes(lf));
            }
            if (subtopicSort === 'az') {
              filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
            }
            return (
              <div class="topics-browser__subtopics">
                <div class="topics-browser__section-header">
                  <span>{t('topicsBrowser.subTopics', { count: topicDetail.children.length })}</span>
                  <div class="topics-browser__subtopics-controls">
                    {topicDetail.children.length > 8 && (
                      <input
                        type="text"
                        class="topics-browser__subtopics-filter"
                        placeholder={t('topicsBrowser.filterSubTopics')}
                        value={subtopicFilter}
                        onInput={(e) => setSubtopicFilter((e.target as HTMLInputElement).value)}
                      />
                    )}
                    <button
                      class={`topics-browser__sort-btn ${subtopicSort === 'az' ? 'topics-browser__sort-btn--active' : ''}`}
                      onClick={() => setSubtopicSort(prev => prev === 'default' ? 'az' : 'default')}
                      title={subtopicSort === 'default' ? t('topicsBrowser.sortAZ') : t('topicsBrowser.sortDefault')}
                    >
                      {subtopicSort === 'default' ? t('topicsBrowser.sortAZShort') : t('topicsBrowser.sortDefaultShort')}
                    </button>
                  </div>
                </div>
                {filtered.map(child => (
                  <button
                    key={child.topic_id}
                    class="topic-card topic-card--child"
                    onClick={() => handleTopicClick(child.topic_id, currentEntry.module!, child.name)}
                  >
                    <div class="topic-card__header">
                      <span class="topic-card__name">{child.name}</span>
                      <span class="topic-card__meta">
                        <span class="topic-card__count">{child.verse_count}v</span>
                        {(child as any).child_count > 0 && (
                          <span class="topic-card__child-count">{(child as any).child_count} {t('topicsBrowser.sub')}</span>
                        )}
                      </span>
                    </div>
                  </button>
                ))}
                {subtopicFilter && filtered.length === 0 && (
                  <div class="topics-browser__empty">{t('topicsBrowser.noSubTopicsMatch', { query: subtopicFilter })}</div>
                )}
              </div>
            );
          })()}

          {topicVerses.length > 0 && (() => {
            // Group verses by context (sub-topic) when there are sub-topics
            const hasContextGroups = topicDetail.children.length > 0 &&
              topicVerses.some(v => v.context);
            // Reference count, not verse count: one per row the list renders.
            const refTotal = topicDetail.reference_count ?? topicVerses.length;
            const hasMoreVerses = !versesExhausted && refTotal > topicVerses.length;
            // Each row can be a range, so the verse total usually exceeds the
            // row count. Show both rather than letting one contradict the list.
            const versesHeader = (
              <>
                {t('topicsBrowser.verses', { count: refTotal })}
                {topicDetail.verse_count > refTotal && (
                  <span class="topics-browser__verse-total">
                    {' · '}{t('topicsBrowser.verseTotal', { count: topicDetail.verse_count })}
                  </span>
                )}
              </>
            );

            if (hasContextGroups) {
              // Build groups: keyed by context string, preserving order
              const groups: { label: string; verses: typeof topicVerseMapped }[] = [];
              const groupMap = new Map<string, typeof topicVerseMapped>();
              for (const tv of topicVerses) {
                const ctx = tv.context || t('topicsBrowser.general');
                if (!groupMap.has(ctx)) {
                  const arr: typeof topicVerseMapped = [];
                  groupMap.set(ctx, arr);
                  groups.push({ label: ctx, verses: arr });
                }
                groupMap.get(ctx)!.push({
                  startVerseId: tv.start_verse_id,
                  endVerseId: tv.end_verse_id !== tv.start_verse_id ? tv.end_verse_id : undefined,
                  context: tv.context,
                });
              }
              return (
                <div class="topics-browser__verses">
                  <div class="topics-browser__section-header">
                    {versesHeader}
                  </div>
                  {groups.map(g => (
                    <div key={g.label} class="topics-browser__verse-group">
                      <div class="topics-browser__verse-group-label">{g.label}</div>
                      <VerseRefList
                        verses={g.verses}
                        onNavigateBible={onNavigateBible}
                        bibleProvider={bibleProvider}
                        storageKey={`bible-topic-verses-${g.label}`}
                      />
                    </div>
                  ))}
                  {hasMoreVerses && (
                    <button
                      class="topics-browser__load-more"
                      onClick={loadMoreVerses}
                      disabled={versesLoadingMore}
                    >
                      {versesLoadingMore ? t('topicsBrowser.loadingShort') : t('topicsBrowser.loadMoreVerses')}
                    </button>
                  )}
                </div>
              );
            }

            return (
              <div class="topics-browser__verses">
                <div class="topics-browser__section-header">
                  {versesHeader}
                </div>
                <VerseRefList
                  verses={topicVerseMapped}
                  totalCount={refTotal}
                  hasMore={hasMoreVerses}
                  onNavigateBible={onNavigateBible}
                  bibleProvider={bibleProvider}
                  storageKey="bible-topic-verses-show"
                  onLoadMore={hasMoreVerses ? loadMoreVerses : undefined}
                  loadingMore={versesLoadingMore}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
