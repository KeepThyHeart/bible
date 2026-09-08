/**
 * The Topics home page.
 *
 * Two things are pinned here. The list is the *top level* of the index, and
 * every row that has sub-topics says so - without that cue a root looks
 * identical to a leaf and there is nothing to suggest drilling in. And there is
 * one search box, whose results land in the list beneath it: a typeahead
 * dropdown *and* a separate "Filter list..." input over a flat list of all
 * 17,206 topics would make the filter look broken.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

vi.mock('../onboarding/PaneEmptyState', () => ({
  default: (props: { testId: string }) => <div data-testid={props.testId} />,
}));

import BrowseView from './BrowseView';
import { BrowseTopicResult } from './types';
import { enT } from '../../testing/enCatalog';

const NAVES = { abbreviation: 'nave', name: "Nave's", language_code: 'en' };

function topic(over: Partial<BrowseTopicResult> = {}): BrowseTopicResult {
  return {
    topic_id: 1,
    name: 'Fine',
    source_abbreviation: 'nave',
    source_name: "Nave's Topical Bible",
    verse_count: 4,
    ...over,
  };
}

function renderView(props: Partial<React.ComponentProps<typeof BrowseView>> = {}) {
  const onSearchQueryChange = vi.fn();
  const onTopicClick = vi.fn();
  const result = render(
    <BrowseView
      topics={[topic()]}
      availableModules={[NAVES] as never}
      sourceFilters={[]}
      searchQuery=""
      loading={false}
      hasMore={false}
      onTopicClick={onTopicClick}
      onSourceFilterChange={vi.fn()}
      onSearchQueryChange={onSearchQueryChange}
      onLoadMore={vi.fn()}
      {...props}
    />,
  );
  return { ...result, onSearchQueryChange, onTopicClick };
}

describe('BrowseView', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('search box', () => {
    it('offers exactly one input, and it is the search box', () => {
      renderView();

      expect(screen.getByTestId('topic-search-input')).toBeInTheDocument();
      // The redundant second box is gone.
      expect(screen.queryByTestId('topic-browse-filter')).not.toBeInTheDocument();
    });

    it('commits the query after the reader stops typing', () => {
      const { onSearchQueryChange } = renderView();

      fireEvent.change(screen.getByTestId('topic-search-input'), { target: { value: 'jeri' } });
      expect(onSearchQueryChange).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(250); });
      expect(onSearchQueryChange).toHaveBeenCalledWith('jeri');
    });

    it('ignores a query too short to search on', () => {
      const { onSearchQueryChange } = renderView();

      fireEvent.change(screen.getByTestId('topic-search-input'), { target: { value: 'j' } });
      act(() => { vi.advanceTimersByTime(250); });

      expect(onSearchQueryChange).toHaveBeenCalledWith('');
    });

    it('restores the browse list the moment the box is cleared', () => {
      // Not after the debounce: the reader is asking for the list back, and
      // waiting for it reads as the box being stuck.
      const { onSearchQueryChange } = renderView({ searchQuery: 'jeri' });

      fireEvent.change(screen.getByTestId('topic-search-input'), { target: { value: '' } });

      expect(onSearchQueryChange).toHaveBeenCalledWith('');
    });
  });

  describe('the list', () => {
    it('marks a row that has sub-topics', () => {
      renderView({ topics: [topic({ child_count: 3 })] });

      expect(screen.getByTestId('topic-list-item-subtopics')).toBeInTheDocument();
    });

    it('leaves a childless row unmarked', () => {
      renderView({ topics: [topic({ child_count: 0 })] });

      expect(screen.queryByTestId('topic-list-item-subtopics')).not.toBeInTheDocument();
    });

    it('shows a search hit under its ancestry rather than a sub-topic count', () => {
      renderView({
        searchQuery: 'penalty',
        topics: [topic({ topic_id: 2, name: '(A penalty)', parent_path: 'Fine', child_count: 0 })],
      });

      expect(screen.getByTestId('topic-list-item-path')).toHaveTextContent('Fine');
    });

    it('names the source on every row', () => {
      renderView();

      expect(screen.getByTestId('topic-list-item')).toHaveTextContent("Nave's Topical Bible");
    });

    it('opens the topic in its own index when clicked', () => {
      const { onTopicClick } = renderView({ topics: [topic({ topic_id: 7, source_abbreviation: 'torrey' })] });

      fireEvent.click(screen.getByTestId('topic-list-item'));

      expect(onTopicClick).toHaveBeenCalledWith('torrey', 7);
    });

    it('puts search results in the list, not in a dropdown over it', () => {
      renderView({ searchQuery: 'jeri', topics: [topic({ name: 'Jericho' })] });

      const results = screen.getByTestId('topic-search-results');
      expect(results).toContainElement(screen.getByTestId('topic-list-item'));
      expect(screen.queryByTestId('topic-browse-results')).not.toBeInTheDocument();
    });

    it('says so when a search matches nothing', () => {
      renderView({ searchQuery: 'xyzzy', topics: [] });

      expect(screen.getByTestId('topic-search-empty')).toHaveTextContent('xyzzy');
      // The "no modules" onboarding must not stand in for an empty search.
      expect(screen.queryByTestId('topics-empty-state')).not.toBeInTheDocument();
    });

    it('falls back to the empty-source onboarding when browsing comes back empty', () => {
      renderView({ searchQuery: '', topics: [] });

      expect(screen.getByTestId('topics-empty-state')).toBeInTheDocument();
    });
  });
});
