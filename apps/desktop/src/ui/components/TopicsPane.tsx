import React, { useEffect, useCallback } from 'react';
import { useTopicsStore } from '../stores/useTopicsStore';
import { useTopicsPanel } from '../stores/hooks/useTopicsPanel';
import { useTopicalIndexStore } from '../stores/useTopicalIndexStore';
import { previewVerseInPrimary } from '../stores/crossStoreBridge';
import PaneNavHeader from './shared/PaneNavHeader';
import SuggestionBanner from './shared/SuggestionBanner';
import BrowseView from './TopicsPane/BrowseView';
import TopicView from './TopicsPane/TopicView';
import VerseTopicsView from './TopicsPane/VerseTopicsView';
import EntityDetailView from './TopicsPane/EntityDetailView';
import { useTopicsPaneData } from './TopicsPane/hooks/useTopicsPaneData';
import { PAGE_SIZE } from './TopicsPane/types';
import { DEFAULT_PANEL_ID } from '../stores/helpers/panelStateHelpers';

interface TopicsPaneProps {
  /**
   * Optional so the pane can be mounted by a detached window, which renders
   * straight from `COMPONENT_MAP` and has no dockview panel to take an id from.
   * Matches the Bible/Commentary/Book panes.
   */
  panelId?: string;
  /**
   * The verse this pane was on when it was popped out.
   *
   * A detached window shares no store with the main one, so without this the
   * window opened on the bare browse list and "Home" had nowhere to go. The
   * verse travels in the pop-out payload (see `DockviewTabRenderer`).
   */
  initialVerseId?: number | null;
}

/**
 * Topics Pane - full topical index browsing with hierarchy,
 * verse lists, search, and cross-index exploration.
 */
const TopicsPane: React.FC<TopicsPaneProps> = ({ panelId: propPanelId, initialVerseId }) => {
  const panelId = propPanelId ?? DEFAULT_PANEL_ID;
  const {
    currentView,
    currentTopicId,
    currentTopicAbbreviation,
    currentVerseId,
    currentEntityId,
    currentEntityCategory,
    pinned,
    suggestionVerseId,
    canGoBack,
    canGoForward,
    sourceFilters,
    browseOffset,
    // The store still calls this `browseFilter`; it is the browse view's search
    // query now - one box that either searches or, when empty, browses.
    browseFilter: searchQuery,
    navigateToTopic,
    navigateToEntity,
    navigateToBrowse,
    setSourceFilter,
    setBrowseFilter: setSearchQuery,
    setBrowseOffset,
    goBack,
    goForward,
    togglePin,
    dismissSuggestion,
    acceptSuggestion,
    goHome,
    liveVerseId,
  } = useTopicsPanel(panelId);

  const { availableModules, loadAvailableModules } = useTopicalIndexStore();

  // Init/destroy panel
  useEffect(() => {
    useTopicsStore.getState().initPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    loadAvailableModules();
    return () => { useTopicsStore.getState().destroyPanel(panelId); }; // allow-getstate: mount/unmount effect - store API for panel lifecycle
  }, [panelId]);

  /**
   * Seed a popped-out window with the verse it was detached on. Runs after
   * `initPanel` above, and only while the pane is still on its fresh browse
   * view, so it never overrides where the reader has since navigated.
   */
  useEffect(() => {
    if (!initialVerseId) return;
    const store = useTopicsStore.getState(); // allow-getstate: mount effect - seed once, without re-subscribing
    const ps = store.getPanelState(panelId);
    if (ps.currentVerseId !== null || ps.currentView !== 'browse') return;
    // Sets `liveVerseId` as well as navigating, so the pane's Home button has
    // somewhere to go in a window that has no Bible pane to ask.
    store.syncAllPanelsWithVerse(initialVerseId);
  }, [panelId, initialVerseId]);

  // Centralized data loading for all views
  const {
    browseTopics,
    topicDetail,
    topicVerses,
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
    loading,
    hasMore,
    hasMoreVerses,
    loadingMoreVerses,
    loadMoreVerses,
  } = useTopicsPaneData({
    currentView,
    currentTopicId: currentTopicId ?? undefined,
    currentTopicAbbreviation: currentTopicAbbreviation ?? undefined,
    currentVerseId: currentVerseId ?? undefined,
    currentEntityId: currentEntityId ?? undefined,
    currentEntityCategory: currentEntityCategory ?? undefined,
    sourceFilters,
    browseOffset,
    searchQuery,
  });

  const handleTopicClick = useCallback((abbreviation: string, topicId: number) => {
    navigateToTopic(topicId, abbreviation);
  }, [navigateToTopic]);

  const handleSearchSelectTopic = useCallback((abbreviation: string, topicId: number) => {
    navigateToTopic(topicId, abbreviation);
  }, [navigateToTopic]);

  const handleEntityClick = useCallback((entityId: string, entityCategory: string) => {
    navigateToEntity(entityId, entityCategory);
  }, [navigateToEntity]);

  const handleVerseClick = useCallback((verseId: number) => {
    // Clicking a passage in a topic list is browsing, not choosing: the
    // reader is working down a list, and moving the commentary and notes on
    // every one of them is exactly what makes such a list unusable.
    previewVerseInPrimary(verseId);
  }, []);

  // Where Home would take the reader: the verse the Bible pane is on, or -
  // before it has said anything - the last verse this pane showed topics for.
  const homeVerseId = liveVerseId ?? suggestionVerseId ?? currentVerseId;

  const handleLoadMore = useCallback(() => {
    setBrowseOffset(browseOffset + PAGE_SIZE);
  }, [browseOffset, setBrowseOffset]);

  return (
    <div data-testid="topics-pane" className="h-full w-full flex flex-col overflow-hidden" style={{ backgroundColor: 'var(--theme-bg-primary)', color: 'var(--theme-text-primary)' }}>
      {/* Home returns to the topics for the verse being read. Without it, a
          reader who had drilled into a subject could only get back by pressing
          Back until that entry happened to resurface. */}
      <PaneNavHeader
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        pinned={pinned}
        onBack={goBack}
        onForward={goForward}
        onTogglePin={togglePin}
        onHome={goHome}
        canGoHome={homeVerseId !== null && !(currentView === 'verse-topics' && currentVerseId === homeVerseId)}
      />

      {/* Suggestion Banner */}
      {suggestionVerseId && (
        <SuggestionBanner
          verseId={suggestionVerseId}
          messagePrefix="See topics for"
          onGo={acceptSuggestion}
          onDismiss={dismissSuggestion}
        />
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {/* Browse View */}
        {currentView === 'browse' && (
          <BrowseView
            topics={browseTopics}
            availableModules={availableModules}
            sourceFilters={sourceFilters}
            searchQuery={searchQuery}
            loading={loading}
            hasMore={hasMore}
            onTopicClick={handleTopicClick}
            onSourceFilterChange={setSourceFilter}
            onSearchQueryChange={setSearchQuery}
            onLoadMore={handleLoadMore}
          />
        )}

        {/* Topic View */}
        {currentView === 'topic' && (
          <TopicView
            detail={topicDetail}
            verses={topicVerses}
            currentVerseId={homeVerseId}
            hasMoreVerses={hasMoreVerses}
            loadingMoreVerses={loadingMoreVerses}
            onLoadMoreVerses={loadMoreVerses}
            alsoIn={alsoIn}
            abbreviation={currentTopicAbbreviation!}
            loading={loading}
            tagGraphAssociations={tagGraphAssociations}
            tagGraphMapping={tagGraphMapping}
            onTopicClick={handleTopicClick}
            onSearchSelect={handleSearchSelectTopic}
            onVerseClick={handleVerseClick}
            onEntityClick={handleEntityClick}
          />
        )}

        {/* Entity View */}
        {currentView === 'entity' && (
          <EntityDetailView
            entity={entityDetail}
            associations={entityAssociations}
            relationships={entityRelationships}
            aliases={entityAliases}
            facets={entityFacets}
            topicLinks={entityTopicLinks}
            loading={loading}
            onEntityClick={handleEntityClick}
            onSearchSelect={handleSearchSelectTopic}
            onTopicLinkClick={handleTopicClick}
          />
        )}

        {/* Verse Topics View */}
        {currentView === 'verse-topics' && (
          <VerseTopicsView
            verseId={currentVerseId!}
            topics={verseTopics}
            loading={loading}
            onTopicClick={handleTopicClick}
            onSearchSelect={handleSearchSelectTopic}
            onBrowse={navigateToBrowse}
          />
        )}
      </div>
    </div>
  );
};

export default TopicsPane;
