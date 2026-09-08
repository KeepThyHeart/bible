/**
 * The topic detail header.
 *
 * The case that matters here is provenance: "Jericho" is a topic in Nave's and
 * a topic in Torrey's, the two say different things, and the view must name
 * which one it is showing - otherwise a reader following an "Also in" link
 * crosses between indexes with nothing on screen changing to say so.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

// Children that reach for IPC or verse text of their own; none of them is the
// subject of these tests.
vi.mock('../shared/TopicSearchBar', () => ({ default: () => <div data-testid="topic-search-bar" /> }));
vi.mock('../shared/VerseListWithPreview', () => ({ default: () => <div data-testid="topic-verses" /> }));
vi.mock('../shared/TopicCard', () => ({ default: (props: { name: string }) => <div data-testid="topic-card">{props.name}</div> }));
vi.mock('./RelatedTagGraphSection', () => ({ default: () => null }));

import TopicView from './TopicView';
import { TopicDetail } from './types';
import { enT } from '../../testing/enCatalog';

const NAVES = "Nave's Topical Bible";

function detail(overrides: Partial<TopicDetail> = {}): TopicDetail {
  return {
    topic: { topic_id: 4, name: 'Jericho' },
    children: [],
    parent_chain: [],
    verse_count: 12,
    reference_count: 9,
    source_abbreviation: 'nave',
    source_name: NAVES,
    ...overrides,
  };
}

function renderView(d: TopicDetail | null) {
  return render(
    <TopicView
      detail={d}
      verses={[]}
      currentVerseId={null}
      hasMoreVerses={false}
      loadingMoreVerses={false}
      onLoadMoreVerses={vi.fn()}
      alsoIn={[]}
      abbreviation="nave"
      loading={false}
      tagGraphAssociations={[]}
      tagGraphMapping={null}
      onTopicClick={vi.fn()}
      onSearchSelect={vi.fn()}
      onVerseClick={vi.fn()}
      onEntityClick={vi.fn()}
    />,
  );
}

describe('TopicView source attribution', () => {
  it('names the index the topic came from', () => {
    renderView(detail());

    expect(screen.getByTestId('topic-source')).toHaveTextContent(`From ${NAVES}`);
  });

  it('distinguishes the same topic name in a different index', () => {
    renderView(detail({ source_abbreviation: 'torrey', source_name: "Torrey's New Topical Textbook" }));

    expect(screen.getByTestId('topic-name')).toHaveTextContent('Jericho');
    expect(screen.getByTestId('topic-source')).toHaveTextContent("Torrey's New Topical Textbook");
  });

  it('says nothing rather than guessing when an older main process sends no source', () => {
    renderView(detail({ source_abbreviation: undefined, source_name: undefined }));

    expect(screen.queryByTestId('topic-source')).not.toBeInTheDocument();
    expect(screen.getByTestId('topic-name')).toBeInTheDocument();
  });

  it('keeps the topic name on its own, so the heading stays the name', () => {
    // The pane's own navigation and the e2e suite both read `topic-name` as
    // the topic's identity; folding the source into it would break that.
    renderView(detail());

    expect(screen.getByTestId('topic-name').textContent).toBe('Jericho');
  });
});
