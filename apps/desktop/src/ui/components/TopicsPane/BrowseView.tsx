import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { TopicalIndexModule } from '../../stores/useTopicalIndexStore';
import { BrowseTopicResult } from './types';
import PaneEmptyState from '../onboarding/PaneEmptyState';

/** How long to wait after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 200;

/** Below this the box is treated as empty and the list falls back to browsing. */
const MIN_QUERY_LENGTH = 2;

interface BrowseViewProps {
  topics: BrowseTopicResult[];
  availableModules: TopicalIndexModule[];
  sourceFilters: string[];
  /** The committed (debounced) query the list is currently showing. */
  searchQuery: string;
  loading: boolean;
  hasMore: boolean;
  onTopicClick: (abbreviation: string, topicId: number) => void;
  onSourceFilterChange: (sources: string[]) => void;
  onSearchQueryChange: (query: string) => void;
  onLoadMore: () => void;
}

/**
 * Browse view: one prominent search box, and one list beneath it.
 *
 * Two separate inputs - a debounced typeahead whose hits appear in a small
 * dropdown, and a separate "Filter list..." box over a flat list of every
 * topic in every index - would not do what a reader expects of a search box:
 * the dropdown would hide its results behind a scrollbar of its own, and the
 * filter would run an FTS `MATCH` over a list of 17,206 topics, so it would
 * look like it was showing a handful of matches out of far too many. One box
 * is enough, with its results landing in the list directly beneath it.
 */
const BrowseView: React.FC<BrowseViewProps> = ({
  topics,
  availableModules,
  sourceFilters,
  searchQuery,
  loading,
  hasMore,
  onTopicClick,
  onSourceFilterChange,
  onSearchQueryChange,
  onLoadMore,
}) => {
  const { t } = useI18n();

  // The box holds every keystroke; the committed query trails it by the
  // debounce. Seeded from the prop so returning to the browse view (which
  // remounts this component) shows the query whose results are on screen.
  const [draft, setDraft] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const handleQueryChange = (value: string) => {
    setDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const next = value.trim().length >= MIN_QUERY_LENGTH ? value : '';
    // Clearing the box has to take effect at once - the reader is asking for
    // the browse list back, and making them wait out a debounce for it reads
    // as the box being stuck.
    if (next === '') {
      onSearchQueryChange('');
      return;
    }
    debounceRef.current = setTimeout(() => onSearchQueryChange(next), SEARCH_DEBOUNCE_MS);
  };

  const searching = searchQuery.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div data-testid="topic-browse-view">
      {/* Source filter chips */}
      {availableModules.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
          {availableModules.map(mod => {
            const isActive = sourceFilters.length === 0 || sourceFilters.includes(mod.abbreviation);
            return (
              <button
                key={mod.abbreviation}
                data-testid="topic-source-filter"
                onClick={() => {
                  if (sourceFilters.length === 0) {
                    // Currently showing all - select only this one
                    onSourceFilterChange([mod.abbreviation]);
                  } else if (sourceFilters.includes(mod.abbreviation)) {
                    const next = sourceFilters.filter(s => s !== mod.abbreviation);
                    onSourceFilterChange(next.length === 0 ? [] : next);
                  } else {
                    onSourceFilterChange([...sourceFilters, mod.abbreviation]);
                  }
                }}
                style={{
                  padding: '3px 10px',
                  fontSize: '12px',
                  borderRadius: '12px',
                  border: '1px solid var(--theme-border-primary)',
                  backgroundColor: isActive ? 'var(--theme-accent-primary)' : 'transparent',
                  color: isActive ? '#fff' : 'var(--theme-text-primary)',
                  cursor: 'pointer',
                }}
              >
                {mod.name}
              </button>
            );
          })}
        </div>
      )}

      {/* The search box. Deliberately larger than the rest of the pane's
          controls: it is the way into 28,000 topics, not an afterthought. */}
      <div style={{ position: 'relative', marginBottom: '12px' }}>
        <input
          data-testid="topic-search-input"
          type="search"
          value={draft}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={t('topicsPane.searchPlaceholder')}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: '15px',
            border: '1px solid var(--theme-border-primary)',
            borderRadius: '8px',
            backgroundColor: 'var(--theme-bg-primary)',
            color: 'var(--theme-text-primary)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Which list is on screen, so the reader knows the browse list is the
          top level of the index rather than everything it holds. */}
      {!loading && topics.length > 0 && (
        <div style={{ fontSize: '11px', color: 'var(--theme-text-secondary)', margin: '0 0 6px 2px' }}>
          {searching
            ? t('topicsPane.searchResultsFor', { query: searchQuery.trim() })
            : t('topicsPane.browsingTopLevel')}
        </div>
      )}

      {/* Topic list - browse results and search results share it. */}
      <div data-testid={searching ? 'topic-search-results' : 'topic-browse-results'}>
        {topics.map(topic => (
          <BrowseTopicRow
            key={`${topic.source_abbreviation}-${topic.topic_id}`}
            topic={topic}
            subtopicLabel={
              topic.child_count === undefined || topic.child_count === 0
                ? undefined
                : topic.child_count === 1
                  ? t('topicsPane.subtopicCountOne')
                  : t('topicsPane.subtopicCount', { count: topic.child_count })
            }
            onClick={() => onTopicClick(topic.source_abbreviation, topic.topic_id)}
          />
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '12px', color: 'var(--theme-text-secondary)', fontSize: '13px' }}>{t('topicsPane.loading')}</div>}

      {!loading && hasMore && topics.length > 0 && (
        <button
          data-testid="topic-load-more"
          onClick={onLoadMore}
          style={{
            display: 'block',
            width: '100%',
            padding: '8px',
            fontSize: '12px',
            color: 'var(--theme-accent-primary)',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            marginTop: '4px',
          }}
        >
          {t('topicsPane.loadMore')}
        </button>
      )}

      {!loading && topics.length === 0 && (
        searching ? (
          <div data-testid="topic-search-empty" style={{ textAlign: 'center', padding: '20px', color: 'var(--theme-text-secondary)', fontSize: '13px' }}>
            {t('topicsPane.noTopicsMatchSearch', { query: searchQuery.trim() })}
          </div>
        ) : availableModules.length === 0 ? (
          // No topical index installed at all. Explain the feature before
          // sending the user off to the module manager to find one.
          <PaneEmptyState
            icon="🏷️"
            testId="topics-no-modules-state"
            title={t('onboarding.empty.topicsNoModules.title')}
            description={t('onboarding.empty.topicsNoModules.description')}
            actions={[
              {
                label: t('onboarding.empty.topicsNoModules.action'),
                onClick: () => window.dispatchEvent(new CustomEvent('command:module:openManager')),
                primary: true,
                testId: 'topics-empty-modules',
              },
            ]}
          />
        ) : (
          <PaneEmptyState
            icon="🏷️"
            testId="topics-empty-state"
            title={t('onboarding.empty.topics.title')}
            description={t('onboarding.empty.topics.description')}
          />
        )
      )}
    </div>
  );
};

interface BrowseTopicRowProps {
  topic: BrowseTopicResult;
  /** "3 subtopics", or undefined for a leaf. */
  subtopicLabel: string | undefined;
  onClick: () => void;
}

/**
 * One row of the browse/search list.
 *
 * Close kin to `shared/TopicListItem`, which it deliberately does not use: the
 * browse list needs to say how many sub-topics a row holds - with the list
 * restricted to the top level, that count is the reader's only cue that a row
 * is worth opening - and `TopicListItem` has no slot for it. Keeps
 * `topic-list-item` / `topic-list-item-name` so the two lists stay
 * interchangeable to callers and tests.
 */
const BrowseTopicRow: React.FC<BrowseTopicRowProps> = ({ topic, subtopicLabel, onClick }) => {
  const secondary = topic.parent_path ?? subtopicLabel;
  return (
    <button
      data-testid="topic-list-item"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: secondary ? '4px 10px' : '6px 10px',
        border: 'none',
        backgroundColor: 'transparent',
        color: 'var(--theme-text-primary)',
        cursor: 'pointer',
        fontSize: '13px',
        textAlign: 'start',
        gap: '8px',
        borderRadius: '4px',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--theme-tab-bg-hover, rgba(0,0,0,0.05))'; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      <span style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        <span data-testid="topic-list-item-name" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {topic.name}
        </span>
        {secondary && (
          <span
            data-testid={topic.parent_path ? 'topic-list-item-path' : 'topic-list-item-subtopics'}
            style={{
              display: 'block',
              fontSize: '11px',
              color: 'var(--theme-text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: 0.7,
              lineHeight: '1.3',
            }}
          >
            {secondary}
          </span>
        )}
      </span>
      <span style={{ fontSize: '11px', color: 'var(--theme-text-secondary)', flexShrink: 0 }}>
        ({topic.source_name})
      </span>
      {topic.verse_count > 0 && (
        <span style={{
          fontSize: '11px',
          color: 'var(--theme-text-secondary)',
          backgroundColor: 'var(--theme-bg-secondary, rgba(0,0,0,0.06))',
          padding: '1px 6px',
          borderRadius: '8px',
          flexShrink: 0,
        }}>
          {topic.verse_count}
        </span>
      )}
      {/* A disclosure cue, so "has sub-topics" reads at a glance as well as
          from the count line. */}
      <span aria-hidden="true" style={{ fontSize: '12px', color: 'var(--theme-text-secondary)', flexShrink: 0, opacity: subtopicLabel ? 0.8 : 0 }}>
        ›
      </span>
    </button>
  );
};

export default BrowseView;
