import { useCallback, useEffect, useState } from 'react';
import { useDeferredLoading } from '../../../hooks/useDeferredLoading';
import { unwrap } from '../../../services/ipcResult';
import { loadAlsoIn, loadTopicDetail, loadTopicVerses } from '../../../services/topicalContentCache';
import {
  BrowseTopicResult,
  TopicDetail,
  AlsoInResult,
  TopicVerseResult,
  TagGraphAssociation,
  TagGraphEntityDetail,
  PeopleRelationshipResult,
  EntityFacetResult,
  EntityTopicLinkResult,
  PAGE_SIZE,
  VERSE_PAGE_SIZE,
} from '../types';
import type { VerseTopic } from '../../shared/VerseTopicsList';

export interface UseTopicsPaneDataParams {
  currentView: string;
  currentTopicId?: number;
  currentTopicAbbreviation?: string;
  currentVerseId?: number;
  currentEntityId?: string;
  currentEntityCategory?: string;
  sourceFilters: string[];
  browseOffset: number;
  /**
   * What the reader has typed into the browse view's search box.
   *
   * Blank means "browse": the list shows top-level topics only. Two characters
   * or more switches the same list over to search results, so the search box
   * and the list are one thing rather than a filter sitting under a separate
   * typeahead dropdown.
   */
  searchQuery: string;
}

export interface UseTopicsPaneDataResult {
  browseTopics: BrowseTopicResult[];
  topicDetail: TopicDetail | null;
  topicVerses: TopicVerseResult[];
  alsoIn: AlsoInResult[];
  verseTopics: VerseTopic[];
  tagGraphAssociations: TagGraphAssociation[];
  tagGraphMapping: { entityId: string; entityCategory: string } | null;
  entityDetail: TagGraphEntityDetail | null;
  entityAssociations: TagGraphAssociation[];
  entityRelationships: PeopleRelationshipResult[];
  entityAliases: string[];
  entityFacets: EntityFacetResult[];
  entityTopicLinks: EntityTopicLinkResult[];
  loading: boolean;
  hasMore: boolean;
  /** True while another page of this topic's passages is being fetched. */
  loadingMoreVerses: boolean;
  /** True when this topic has passages beyond the ones already loaded. */
  hasMoreVerses: boolean;
  /** Fetch the next page of this topic's passages and append them. */
  loadMoreVerses: () => void;
}

/**
 * Encapsulates all data-loading effects for the Topics pane:
 * browse list, topic detail (+ verses + also-in + tag graph),
 * entity detail (+ associations/aliases/facets/topic links/relationships),
 * and verse-topics.
 */
export function useTopicsPaneData(params: UseTopicsPaneDataParams): UseTopicsPaneDataResult {
  const {
    currentView,
    currentTopicId,
    currentTopicAbbreviation,
    currentVerseId,
    currentEntityId,
    currentEntityCategory,
    sourceFilters,
    browseOffset,
    searchQuery,
  } = params;

  const [browseTopics, setBrowseTopics] = useState<BrowseTopicResult[]>([]);
  const [topicDetail, setTopicDetail] = useState<TopicDetail | null>(null);
  const [topicVerses, setTopicVerses] = useState<TopicVerseResult[]>([]);
  const [loadingMoreVerses, setLoadingMoreVerses] = useState(false);
  // Set when a page comes back short - a full page tells us nothing about
  // whether more exist, so it is the *short* page that ends the list.
  const [versesExhausted, setVersesExhausted] = useState(false);
  const [alsoIn, setAlsoIn] = useState<AlsoInResult[]>([]);
  // `VerseTopic`, not `BrowseTopicResult`: the IPC returns each topic's
  // ancestry, and the narrower type would silently discard it, showing bare
  // leaf names where the Study pane shows the full path.
  const [verseTopics, setVerseTopics] = useState<VerseTopic[]>([]);
  const [tagGraphAssociations, setTagGraphAssociations] = useState<TagGraphAssociation[]>([]);
  const [tagGraphMapping, setTagGraphMapping] = useState<{ entityId: string; entityCategory: string } | null>(null);
  const [entityDetail, setEntityDetail] = useState<TagGraphEntityDetail | null>(null);
  const [entityAssociations, setEntityAssociations] = useState<TagGraphAssociation[]>([]);
  const [entityRelationships, setEntityRelationships] = useState<PeopleRelationshipResult[]>([]);
  const [entityAliases, setEntityAliases] = useState<string[]>([]);
  const [entityFacets, setEntityFacets] = useState<EntityFacetResult[]>([]);
  const [entityTopicLinks, setEntityTopicLinks] = useState<EntityTopicLinkResult[]>([]);
  const [loading, setLoading] = useState(false);
  // Deferred, not raw: a topic that resolves from the cache in a few
  // milliseconds should render its content, not blink a "loading" state on the
  // way past. See `useDeferredLoading`.
  const deferredLoading = useDeferredLoading(loading);
  const [hasMore, setHasMore] = useState(true);

  // Load browse data
  useEffect(() => {
    if (currentView !== 'browse') return;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const sources = sourceFilters.length > 0 ? sourceFilters : undefined;
        const query = searchQuery.trim();
        // Two lists, one slot. With a query the reader gets search results -
        // ranked by relevance, carrying each hit's ancestry, and spanning every
        // level of the hierarchy. With none they get the top level of the
        // index, because the flat list of all 17,206 of Nave's topics put
        // gloss subtopics like "(A penalty)" (a child of "Fine") at the top
        // level, where they mean nothing.
        const results = query.length >= 2
          ? await unwrap(window.electron.topical.searchTopics(query, sources, PAGE_SIZE, browseOffset))
          : await unwrap(window.electron.topical.browseTopics(sources, PAGE_SIZE, browseOffset, undefined, true));
        if (!cancelled) {
          if (browseOffset === 0) {
            setBrowseTopics(results);
          } else {
            setBrowseTopics(prev => [...prev, ...results]);
          }
          // `>=`, not `==`: both calls page each *module* separately and the
          // main process concatenates them, so two installed indexes return up
          // to 2 x PAGE_SIZE. An equality test made Load more vanish exactly
          // when there was most left to load.
          setHasMore(results.length >= PAGE_SIZE);
        }
      } catch (error) {
        console.error('Error loading browse topics:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [currentView, sourceFilters, browseOffset, searchQuery]);

  // Load topic detail
  useEffect(() => {
    if (currentView !== 'topic' || !currentTopicId || !currentTopicAbbreviation) return;
    let cancelled = false;
    setLoading(true);
    // A new topic starts a new list; without this the previous topic's
    // "exhausted" verdict carried over and suppressed its Load more button.
    setVersesExhausted(false);
    setLoadingMoreVerses(false);

    const load = async () => {
      try {
        // Through the cache, not straight to IPC: the Study pane prefetches a
        // topic before it hands over to this pane, and mounting is otherwise
        // frequent enough (every tab activation) to re-run these three queries
        // for content that cannot change.
        const detail = await loadTopicDetail(currentTopicAbbreviation, currentTopicId);
        if (!cancelled && detail) {
          setTopicDetail(detail);

          // Load the first page of passages. Asking for 100 with no offset
          // and no way to ask for more would show 100 of a topic's 400
          // passages and say nothing about the rest.
          const verses = await loadTopicVerses(
            currentTopicAbbreviation,
            currentTopicId,
            VERSE_PAGE_SIZE,
            0,
          );
          if (!cancelled) {
            setTopicVerses(verses);
            setVersesExhausted(verses.length < VERSE_PAGE_SIZE);
          }

          // Load also-in
          const also = await loadAlsoIn(detail.topic.name, currentTopicAbbreviation);
          if (!cancelled) setAlsoIn(also);
        }
      } catch (error) {
        console.error('Error loading topic detail:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [currentView, currentTopicId, currentTopicAbbreviation]);

  // Load tag graph associations for current topic
  // First tries topic_id-based lookup, then falls back to name-based matching
  useEffect(() => {
    if (currentView !== 'topic' || !topicDetail) {
      setTagGraphAssociations([]);
      setTagGraphMapping(null);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        // 1. Try direct topic_id lookup (works for Nave's/Torrey's topics with entity links)
        let entity = null;
        if (currentTopicAbbreviation) {
          entity = await unwrap(window.electron.tagGraph.getEntityForTopic(
            currentTopicAbbreviation,
            topicDetail.topic.topic_id
          ));
        }

        // 2. Fallback: name-based entity match (works for any source)
        if (!entity) {
          entity = await unwrap(window.electron.tagGraph.getEntityByName(topicDetail.topic.name));
        }

        if (cancelled) return;
        if (entity) {
          setTagGraphMapping({ entityId: entity.id, entityCategory: entity.category });
          const assocs = await unwrap(window.electron.tagGraph.getAssociationsForEntity(
            entity.id, entity.category
          ));
          if (!cancelled) setTagGraphAssociations(assocs);
        } else {
          setTagGraphMapping(null);
          setTagGraphAssociations([]);
        }
      } catch {
        // Tag graph not available - silent degradation
        if (!cancelled) {
          setTagGraphMapping(null);
          setTagGraphAssociations([]);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [currentView, topicDetail, currentTopicAbbreviation]);

  // Load entity detail view
  useEffect(() => {
    if (currentView !== 'entity' || !currentEntityId || !currentEntityCategory) return;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const detail = await unwrap(window.electron.tagGraph.getEntity(currentEntityId, currentEntityCategory));
        if (cancelled) return;
        setEntityDetail(detail);

        const [assocs, aliases, facets, topicLinks] = await Promise.all([
          unwrap(window.electron.tagGraph.getAssociationsForEntity(currentEntityId, currentEntityCategory)),
          unwrap(window.electron.tagGraph.getEntityAliases(currentEntityId, currentEntityCategory)),
          unwrap(window.electron.tagGraph.getFacetsForEntity(currentEntityId, currentEntityCategory)),
          unwrap(window.electron.tagGraph.getTopicLinksForEntity(currentEntityId, currentEntityCategory)),
        ]);
        if (cancelled) return;
        setEntityAssociations(assocs);
        setEntityAliases(aliases);
        setEntityFacets(facets);
        setEntityTopicLinks(topicLinks);

        if (currentEntityCategory === 'people') {
          const rels = await unwrap(window.electron.tagGraph.getPeopleRelationships(currentEntityId));
          if (!cancelled) setEntityRelationships(rels);
        } else {
          setEntityRelationships([]);
        }
      } catch (error) {
        console.error('Error loading entity detail:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [currentView, currentEntityId, currentEntityCategory]);

  // Load verse-topics
  useEffect(() => {
    if (currentView !== 'verse-topics' || !currentVerseId) return;
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const topics = await unwrap(window.electron.topical.getTopicsForVerse(currentVerseId));
        if (!cancelled) setVerseTopics(topics);
      } catch (error) {
        console.error('Error loading verse topics:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [currentView, currentVerseId]);

  /**
   * Whether this topic has passages past the ones already loaded.
   *
   * Prefers `reference_count` - the number of stored links, which is exactly
   * how many rows the query can return. `verse_count` expands ranges, so
   * comparing it against a loaded row count leaves a Load more button that
   * never goes away. When the main process is older and sends no reference
   * count, fall back to "the last page came back full", which is the same
   * signal the browse list uses.
   */
  const referenceCount = topicDetail?.reference_count;
  const hasMoreVerses =
    typeof referenceCount === 'number'
      ? topicVerses.length < referenceCount
      : !versesExhausted && topicVerses.length > 0;

  const loadMoreVerses = useCallback(() => {
    if (!currentTopicId || !currentTopicAbbreviation) return;
    if (loadingMoreVerses || !hasMoreVerses) return;

    const offset = topicVerses.length;
    setLoadingMoreVerses(true);
    void (async () => {
      try {
        const more = await unwrap(
          window.electron.topical.getVersesForTopic(
            currentTopicAbbreviation,
            currentTopicId,
            VERSE_PAGE_SIZE,
            offset,
          ),
        );
        setTopicVerses(prev => [...prev, ...more]);
        setVersesExhausted(more.length < VERSE_PAGE_SIZE);
      } catch (error) {
        console.error('Error loading more topic verses:', error);
        // Stop asking rather than looping on a failing query. The button
        // disappears; Back and forward re-entry retry from scratch.
        setVersesExhausted(true);
      } finally {
        setLoadingMoreVerses(false);
      }
    })();
  }, [currentTopicId, currentTopicAbbreviation, loadingMoreVerses, hasMoreVerses, topicVerses.length]);

  return {
    browseTopics,
    topicDetail,
    topicVerses,
    loadingMoreVerses,
    hasMoreVerses,
    loadMoreVerses,
    alsoIn,
    verseTopics,
    tagGraphAssociations,
    tagGraphMapping,
    entityDetail,
    entityAssociations,
    entityRelationships,
    entityAliases,
    entityFacets,
    entityTopicLinks,
    loading: deferredLoading,
    hasMore,
  };
}
