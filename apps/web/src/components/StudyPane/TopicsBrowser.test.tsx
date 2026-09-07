/**
 * Component tests for TopicsBrowser.
 *
 * Pattern: Props-driven component with internal navigation history.
 * topicalProvider, tagGraphProvider, and bibleProvider are passed as props
 * (mocked as vi.fn() objects).
 * i18n is mocked to return keys as-is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && 'verse' in opts) return `${key}:${opts.verse}`;
      if (opts && 'query' in opts) return `${key}:${opts.query}`;
      if (opts && 'count' in opts) return `${key}:${opts.count}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// ---- Child mock ----------------------------------------------------------
vi.mock('./VerseRefList', () => ({
  VerseRefList: ({ verses }: { verses: { startVerseId: number }[] }) => (
    <div data-testid="mock-verse-ref-list" data-count={verses.length} />
  ),
}));

vi.mock('../../utils/verseId', () => ({
  parseVerseId: (id: number) => ({
    bookNumber: Math.floor(id / 1000000),
    chapter: Math.floor((id % 1000000) / 1000),
    verse: id % 1000,
  }),
}));

vi.mock('../../constants', () => ({
  formatPassageRef: (_book: number, chapter: number, verse: number) => `${chapter}:${verse}`,
}));

import type {
  VerseTopicData,
  TagGraphEntityData,
  TopicDetailData,
  TopicVerseData,
  TopicSearchResultData,
} from '../../types';
import type { ITopicalDataProvider, ITagGraphDataProvider } from '../../providers/interfaces';
import { TopicsBrowser, resetTopicsBrowserNav } from './TopicsBrowser';

// ---- Helper factory functions -------------------------------------------
function makeVerseTopics(count = 2): VerseTopicData[] {
  // `parent_topic_id` and `description` are required on `VerseTopicData` and
  // were missing here; the factory was producing rows the provider never does.
  return Array.from({ length: count }, (_, i) => ({
    topic_id: i + 1,
    parent_topic_id: null,
    name: `Topic ${i + 1}`,
    description: null,
    verse_count: 10 + i,
    source_abbreviation: 'TSK',
    source_name: 'Treasury of Scripture Knowledge',
    ancestors: [],
  }));
}

function makeVerseEntities(count = 1): TagGraphEntityData[] {
  return Array.from({ length: count }, (_, i) => ({
    entity_id: `entity-${i + 1}`,
    category: 'people',
    name: `Person ${i + 1}`,
    notes: `Notes for person ${i + 1}`,
  }));
}

function makeTopicalProvider(): ITopicalDataProvider {
  return {
    getTopic: vi.fn(() => Promise.resolve<TopicDetailData>({
      topic: { topic_id: 1, parent_topic_id: null, name: 'Love', description: 'About love', sort_order: 0 },
      children: [{ topic_id: 2, name: 'Agape', description: null, verse_count: 5 }],
      parent_chain: [],
      verse_count: 20,
    })),
    getVersesForTopic: vi.fn(() => Promise.resolve<TopicVerseData[]>([
      // `sort_order` is required — the pane orders verses by it.
      { topic_id: 1, start_verse_id: 43003016, end_verse_id: 43003016, context: '', sort_order: 0 },
    ])),
    searchTopics: vi.fn(() => Promise.resolve<TopicSearchResultData[]>([
      // `description` is required.
      { topic_id: 1, name: 'Love', description: null, verse_count: 20, source_abbreviation: 'TSK', source_name: 'TSK', ancestors: [] },
    ])),
  } as unknown as ITopicalDataProvider;
}

function makeTagGraphProvider(): ITagGraphDataProvider {
  return {
    getEntity: vi.fn(() => Promise.resolve({ entity_id: 'e1', category: 'people', name: 'Moses', notes: null, roles: null, tribe: null })),
    getAssociations: vi.fn(() => Promise.resolve([])),
    getVersesForEntity: vi.fn(() => Promise.resolve([])),
    getTopicLinksForEntity: vi.fn(() => Promise.resolve([])),
    searchEntities: vi.fn(() => Promise.resolve([])),
  } as unknown as ITagGraphDataProvider;
}

describe('TopicsBrowser', () => {
  const defaultProps = {
    verseId: 43003016,
    verseTopics: makeVerseTopics(),
    verseEntities: [],
    loading: false,
    onNavigateBible: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // The browser remembers where it was across mounts; without this each test
    // would start wherever the previous one left off.
    resetTopicsBrowserNav();
  });

  // ------------------------------------------------------------------
  // Home view — basic rendering
  // ------------------------------------------------------------------
  it('renders the topics browser container', () => {
    const { container } = render(<TopicsBrowser {...defaultProps} />);
    expect(container.querySelector('.topics-browser')).toBeTruthy();
  });

  it('renders the search bar', () => {
    const { container } = render(<TopicsBrowser {...defaultProps} />);
    expect(container.querySelector('.topics-browser__search-input')).toBeTruthy();
  });

  it('renders nav bar with home/back/forward buttons', () => {
    const { container } = render(<TopicsBrowser {...defaultProps} />);
    const navBtns = container.querySelectorAll('.topics-browser__nav-btn');
    expect(navBtns.length).toBeGreaterThanOrEqual(3);
  });

  it('renders verse topics grouped by source', () => {
    render(<TopicsBrowser {...defaultProps} />);
    // Topic names
    expect(screen.getByText('Topic 1')).toBeTruthy();
    expect(screen.getByText('Topic 2')).toBeTruthy();
  });

  it('renders the source group label', () => {
    render(<TopicsBrowser {...defaultProps} />);
    expect(screen.getByText('Treasury of Scripture Knowledge')).toBeTruthy();
  });

  it('shows empty state when no topics or entities', () => {
    const { container } = render(
      <TopicsBrowser {...defaultProps} verseTopics={[]} verseEntities={[]} />
    );
    expect(container.querySelector('.topics-browser__empty')).toBeTruthy();
  });

  it('shows loading indicator when loading is true', () => {
    const { container } = render(
      <TopicsBrowser {...defaultProps} loading={true} verseTopics={[]} verseEntities={[]} />
    );
    expect(container.querySelector('.topics-browser__loading')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Entity cards
  // ------------------------------------------------------------------
  it('renders entity cards when entities are provided', () => {
    const entities = makeVerseEntities(2);
    const { container } = render(
      <TopicsBrowser {...defaultProps} verseEntities={entities} />
    );
    const entityCards = container.querySelectorAll('.entity-card');
    expect(entityCards.length).toBe(2);
  });

  it('renders entity name and category badge', () => {
    const entities = makeVerseEntities(1);
    render(<TopicsBrowser {...defaultProps} verseEntities={entities} />);
    expect(screen.getByText('Person 1')).toBeTruthy();
    expect(screen.getByText('people')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Navigation buttons
  // ------------------------------------------------------------------
  it('home button is disabled when at home', () => {
    const { container } = render(<TopicsBrowser {...defaultProps} />);
    const homeBtn = container.querySelector<HTMLButtonElement>('.topics-browser__nav-btn:first-child')!;
    expect(homeBtn.disabled).toBe(true);
  });

  it('back button is disabled when at home', () => {
    const { container } = render(<TopicsBrowser {...defaultProps} />);
    const navBtns = container.querySelectorAll<HTMLButtonElement>('.topics-browser__nav-btn');
    // back button is second
    expect(navBtns[1].disabled).toBe(true);
  });

  it('forward button is disabled when at latest entry', () => {
    const { container } = render(<TopicsBrowser {...defaultProps} />);
    const navBtns = container.querySelectorAll<HTMLButtonElement>('.topics-browser__nav-btn');
    expect(navBtns[2].disabled).toBe(true);
  });

  // ------------------------------------------------------------------
  // Navigation to topic
  // ------------------------------------------------------------------
  it('navigates to topic when a topic link is clicked', async () => {
    const topicalProvider = makeTopicalProvider();
    const { container } = render(
      <TopicsBrowser {...defaultProps} topicalProvider={topicalProvider} />
    );
    const topicLink = container.querySelector<HTMLElement>('.study-topics__chain-current')!;
    await act(async () => { fireEvent.click(topicLink); });
    // After navigation, back button should be enabled
    const navBtns = container.querySelectorAll<HTMLButtonElement>('.topics-browser__nav-btn');
    expect(navBtns[1].disabled).toBe(false);
  });

  it('calls topicalProvider.getTopic when navigating to a topic', async () => {
    const topicalProvider = makeTopicalProvider();
    const { container } = render(
      <TopicsBrowser {...defaultProps} topicalProvider={topicalProvider} />
    );
    const topicLink = container.querySelector<HTMLElement>('.study-topics__chain-current')!;
    await act(async () => { fireEvent.click(topicLink); });
    expect(topicalProvider.getTopic).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Navigation to entity
  // ------------------------------------------------------------------
  it('calls tagGraphProvider.getEntity when navigating to an entity', async () => {
    const tagGraphProvider = makeTagGraphProvider();
    const entities = makeVerseEntities(1);
    const { container } = render(
      <TopicsBrowser {...defaultProps} verseEntities={entities} tagGraphProvider={tagGraphProvider} />
    );
    const entityCard = container.querySelector<HTMLElement>('.entity-card--clickable')!;
    await act(async () => { fireEvent.click(entityCard); });
    expect(tagGraphProvider.getEntity).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------
  it('clears search when the cancel button is clicked', async () => {
    const topicalProvider = makeTopicalProvider();
    const { container } = render(
      <TopicsBrowser {...defaultProps} topicalProvider={topicalProvider} />
    );
    const input = container.querySelector<HTMLInputElement>('.topics-browser__search-input')!;
    fireEvent.input(input, { target: { value: 'love' } });
    // Cancel button should appear
    const cancelBtn = container.querySelector<HTMLElement>('.topics-browser__search-cancel')!;
    expect(cancelBtn).toBeTruthy();
    fireEvent.click(cancelBtn);
    // Input should be cleared
    expect(input.value).toBe('');
  });

  it('shows searching indicator while search is in progress', async () => {
    // Use fake timers so the debounce doesn't fire immediately
    vi.useFakeTimers();
    const topicalProvider = makeTopicalProvider();
    const { container } = render(
      <TopicsBrowser {...defaultProps} topicalProvider={topicalProvider} />
    );
    const input = container.querySelector<HTMLInputElement>('.topics-browser__search-input')!;
    fireEvent.input(input, { target: { value: 'love' } });
    // Before timer fires, searching should be true
    expect(container.querySelector('.topics-browser__loading')).toBeTruthy();
    vi.useRealTimers();
  });

  // ------------------------------------------------------------------
  // Mobile layout
  // ------------------------------------------------------------------
  it('does not render the standard nav bar in mobile mode', () => {
    const { container } = render(
      <TopicsBrowser {...defaultProps} mobile={true} />
    );
    expect(container.querySelector('.topics-browser__nav')).toBeNull();
  });

  it('does not render mobile back button when at home in mobile mode', () => {
    const { container } = render(
      <TopicsBrowser {...defaultProps} mobile={true} />
    );
    expect(container.querySelector('.topics-browser__mobile-nav')).toBeNull();
  });

  // ------------------------------------------------------------------
  // topicRequest prop
  // ------------------------------------------------------------------
  it('starts on a topic page when a topicRequest is present on mount', () => {
    const topicalProvider = makeTopicalProvider();
    const { container } = render(
      <TopicsBrowser
        {...defaultProps}
        topicalProvider={topicalProvider}
        topicRequest={{ topicId: 1, module: 'TSK', topicName: 'Love', sourceName: 'TSK', token: 1 }}
      />
    );
    // Not at home — back button should eventually be enabled
    const navBtns = container.querySelectorAll<HTMLButtonElement>('.topics-browser__nav-btn');
    // historyIndex starts at 1 (the requested topic), so back is enabled
    expect(navBtns[1].disabled).toBe(false);
  });

  it('reports the mount request as handled so the store can clear it', async () => {
    const onTopicRequestHandled = vi.fn();
    await act(async () => {
      render(
        <TopicsBrowser
          {...defaultProps}
          topicalProvider={makeTopicalProvider()}
          topicRequest={{ topicId: 1, module: 'TSK', topicName: 'Love', token: 1 }}
          onTopicRequestHandled={onTopicRequestHandled}
        />
      );
    });
    expect(onTopicRequestHandled).toHaveBeenCalled();
  });

  it('navigates when a request arrives while already mounted', async () => {
    // The whole point of the token: a request raised with the browser already
    // on screen used to be dropped, because nothing remounted to read it.
    const topicalProvider = makeTopicalProvider();
    const { rerender } = render(
      <TopicsBrowser {...defaultProps} topicalProvider={topicalProvider} />
    );
    expect(topicalProvider.getTopic).not.toHaveBeenCalled();
    await act(async () => {
      rerender(
        <TopicsBrowser
          {...defaultProps}
          topicalProvider={topicalProvider}
          topicRequest={{ topicId: 9, module: 'TSK', topicName: 'Hope', token: 5 }}
        />
      );
    });
    expect(topicalProvider.getTopic).toHaveBeenCalledWith('TSK', 9);
  });

  it('says why the pane is empty instead of rendering a blank topic page', async () => {
    // A titled but empty pane is indistinguishable from a hung app; every
    // failure path must land on a message.
    const topicalProvider = makeTopicalProvider();
    (topicalProvider.getTopic as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { container } = render(
      <TopicsBrowser
        {...defaultProps}
        topicalProvider={topicalProvider}
        topicRequest={{ topicId: 1, module: 'TSK', topicName: 'Love', token: 1 }}
      />
    );
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('.topics-browser__empty')).toBeTruthy();
  });
});
