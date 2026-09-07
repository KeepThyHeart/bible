/**
 * Component tests for StudyTopics.
 *
 * Pattern: Store-connected component with grouped topic list and entity list.
 * studyStore and offlineStore are mocked via useStore to return controlled
 * state. Tests cover loading, empty/offline states, topic group rendering,
 * entity rendering, and click/keyboard callbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

// ---- i18n ----------------------------------------------------------------
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// ---- Store state ---------------------------------------------------------
type VerseTopicData = {
  topic_id: number;
  name: string;
  source_abbreviation: string;
  source_name: string;
  verse_count: number;
  ancestors: Array<{ topic_id: number; name: string; verse_count: number }>;
};
type TagGraphEntityData = {
  entity_id: number;
  name: string;
  category: string;
};

let mockVerseTopics: VerseTopicData[] = [];
let mockVerseEntities: TagGraphEntityData[] = [];
let mockTopicsLoading = false;
let mockIsOnline = true;

vi.mock('../../hooks/useStore', () => ({
  useStore: (_store: unknown, selector: () => unknown) => selector(),
}));

vi.mock('../../stores/studyStore', () => ({
  studyStore: {
    get verseTopics() { return mockVerseTopics; },
    get verseEntities() { return mockVerseEntities; },
    get topicsLoading() { return mockTopicsLoading; },
  },
}));

vi.mock('../../stores/offlineStore', () => ({
  offlineStore: {
    get isOnline() { return mockIsOnline; },
  },
}));

import { StudyTopics } from './StudyTopics';

function makeTopic(overrides: Partial<VerseTopicData> = {}): VerseTopicData {
  return {
    topic_id: 1,
    name: 'Love',
    source_abbreviation: 'nave',
    source_name: "Nave's Topical Bible",
    verse_count: 42,
    ancestors: [],
    ...overrides,
  };
}

function makeEntity(overrides: Partial<TagGraphEntityData> = {}): TagGraphEntityData {
  return {
    entity_id: 1,
    name: 'Jesus',
    category: 'Person',
    ...overrides,
  };
}

describe('StudyTopics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerseTopics = [];
    mockVerseEntities = [];
    mockTopicsLoading = false;
    mockIsOnline = true;
  });

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  it('renders loading indicator when topicsLoading is true', () => {
    mockTopicsLoading = true;
    const { container } = render(<StudyTopics />);
    expect(container.querySelector('.study-topics__loading')).toBeTruthy();
    expect(screen.getByText('studyTopics.loading')).toBeTruthy();
  });

  it('does not render topics container while loading', () => {
    mockTopicsLoading = true;
    const { container } = render(<StudyTopics />);
    expect(container.querySelector('.study-topics')).toBeNull();
  });

  // ------------------------------------------------------------------
  // Empty state
  // ------------------------------------------------------------------
  it('renders noTopics message when online and no topics/entities', () => {
    const { container } = render(<StudyTopics />);
    expect(container.querySelector('.study-topics__empty')).toBeTruthy();
    expect(screen.getByText('studyTopics.noTopics')).toBeTruthy();
  });

  it('renders offlineNotice when offline and no topics/entities', () => {
    mockIsOnline = false;
    const { container } = render(<StudyTopics />);
    expect(container.querySelector('.study-topics__empty')).toBeTruthy();
    expect(screen.getByText('studyTopics.offlineNotice')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // Topic groups rendering
  // ------------------------------------------------------------------
  it('renders the topics container when topics are present', () => {
    mockVerseTopics = [makeTopic()];
    const { container } = render(<StudyTopics />);
    expect(container.querySelector('.study-topics')).toBeTruthy();
  });

  it('renders each topic group with a label', () => {
    mockVerseTopics = [
      makeTopic({ source_abbreviation: 'nave', source_name: "Nave's Topical Bible" }),
    ];
    const { container } = render(<StudyTopics />);
    const groupLabels = container.querySelectorAll('.study-topics__group-label');
    expect(groupLabels.length).toBeGreaterThan(0);
    expect(groupLabels[0].textContent).toBe("Nave's Topical Bible");
  });

  it('groups topics by source_abbreviation', () => {
    mockVerseTopics = [
      makeTopic({ topic_id: 1, source_abbreviation: 'nave', source_name: "Nave's" }),
      makeTopic({ topic_id: 2, name: 'Faith', source_abbreviation: 'nave', source_name: "Nave's" }),
      makeTopic({ topic_id: 3, name: 'Peace', source_abbreviation: 'torrey', source_name: "Torrey's" }),
    ];
    const { container } = render(<StudyTopics />);
    const groups = container.querySelectorAll('.study-topics__group');
    // 2 source groups (nave and torrey) — entities group not present
    expect(groups.length).toBe(2);
  });

  it('renders the topic name with verse count', () => {
    mockVerseTopics = [makeTopic({ name: 'Love', verse_count: 42 })];
    const { container } = render(<StudyTopics />);
    const currentLink = container.querySelector('.study-topics__chain-current');
    expect(currentLink?.textContent).toContain('Love');
    expect(currentLink?.textContent).toContain('42');
  });

  it('renders ancestor chain links', () => {
    mockVerseTopics = [
      makeTopic({
        name: 'Love of God',
        ancestors: [{ topic_id: 10, name: 'Love', verse_count: 100 }],
      }),
    ];
    const { container } = render(<StudyTopics />);
    const chainLinks = container.querySelectorAll('.study-topics__chain-link');
    // ancestor + current
    expect(chainLinks.length).toBe(2);
    expect(chainLinks[0].textContent).toContain('Love');
  });

  // ------------------------------------------------------------------
  // Topic click callbacks
  // ------------------------------------------------------------------
  it('calls onTopicClick when the current topic link is clicked', () => {
    mockVerseTopics = [
      makeTopic({ topic_id: 1, name: 'Love', source_abbreviation: 'nave', source_name: "Nave's" }),
    ];
    const onTopicClick = vi.fn();
    const { container } = render(<StudyTopics onTopicClick={onTopicClick} />);
    const currentLink = container.querySelector('.study-topics__chain-current')!;
    fireEvent.click(currentLink);
    expect(onTopicClick).toHaveBeenCalledWith(1, 'nave', 'Love', "Nave's");
  });

  it('calls onTopicClick on Enter key on the current topic link', () => {
    mockVerseTopics = [
      makeTopic({ topic_id: 1, name: 'Love', source_abbreviation: 'nave', source_name: "Nave's" }),
    ];
    const onTopicClick = vi.fn();
    const { container } = render(<StudyTopics onTopicClick={onTopicClick} />);
    const currentLink = container.querySelector('.study-topics__chain-current')!;
    fireEvent.keyDown(currentLink, { key: 'Enter' });
    expect(onTopicClick).toHaveBeenCalledWith(1, 'nave', 'Love', "Nave's");
  });

  it('does not fire onTopicClick for non-Enter key', () => {
    mockVerseTopics = [makeTopic()];
    const onTopicClick = vi.fn();
    const { container } = render(<StudyTopics onTopicClick={onTopicClick} />);
    const currentLink = container.querySelector('.study-topics__chain-current')!;
    fireEvent.keyDown(currentLink, { key: 'Tab' });
    expect(onTopicClick).not.toHaveBeenCalled();
  });

  it('calls onTopicClick with ancestor data when ancestor link is clicked', () => {
    mockVerseTopics = [
      makeTopic({
        topic_id: 2,
        name: 'Love of God',
        source_abbreviation: 'nave',
        source_name: "Nave's",
        ancestors: [{ topic_id: 10, name: 'Love', verse_count: 100 }],
      }),
    ];
    const onTopicClick = vi.fn();
    const { container } = render(<StudyTopics onTopicClick={onTopicClick} />);
    // First link is the ancestor
    const ancestorLink = container.querySelectorAll<HTMLElement>('.study-topics__chain-link')[0];
    fireEvent.click(ancestorLink);
    expect(onTopicClick).toHaveBeenCalledWith(10, 'nave', 'Love', "Nave's");
  });

  it('renders an ancestor with no id as plain text, not a link', () => {
    // A study cache generated before ancestor ids were stored yields
    // topic_id 0. Offering it as a link navigated to topic 0, which the
    // browser reported as "This topic could not be loaded".
    mockVerseTopics = [
      makeTopic({
        topic_id: 2,
        name: 'Love of God',
        ancestors: [{ topic_id: 0, name: 'Love', verse_count: 0 }],
      }),
    ];
    const onTopicClick = vi.fn();
    const { container } = render(<StudyTopics onTopicClick={onTopicClick} />);

    const chainLinks = container.querySelectorAll('.study-topics__chain-link');
    expect(chainLinks.length).toBe(1); // the current topic only
    const plain = container.querySelector<HTMLElement>('.study-topics__chain-name');
    expect(plain?.textContent).toBe('Love');
    fireEvent.click(plain!);
    expect(onTopicClick).not.toHaveBeenCalled();
  });

  it('does not throw when onTopicClick is not provided', () => {
    mockVerseTopics = [makeTopic()];
    const { container } = render(<StudyTopics />);
    const currentLink = container.querySelector<HTMLElement>('.study-topics__chain-current')!;
    expect(() => fireEvent.click(currentLink)).not.toThrow();
  });

  // ------------------------------------------------------------------
  // Entities rendering
  // ------------------------------------------------------------------
  it('renders entity group when verseEntities is non-empty', () => {
    mockVerseEntities = [makeEntity()];
    const { container } = render(<StudyTopics />);
    expect(container.querySelector('.study-topics__group')).toBeTruthy();
    expect(screen.getByText('studyTopics.entities')).toBeTruthy();
  });

  it('renders entity name and category badge', () => {
    mockVerseEntities = [makeEntity({ name: 'Jesus', category: 'Person' })];
    const { container } = render(<StudyTopics />);
    const entityName = container.querySelector('.study-topics__entity-name');
    const entityBadge = container.querySelector('.study-topics__entity-badge');
    expect(entityName?.textContent).toBe('Jesus');
    expect(entityBadge?.textContent).toBe('Person');
  });

  it('renders multiple entities in the entity group', () => {
    mockVerseEntities = [
      makeEntity({ entity_id: 1, name: 'Jesus', category: 'Person' }),
      makeEntity({ entity_id: 2, name: 'Jerusalem', category: 'Place' }),
    ];
    const { container } = render(<StudyTopics />);
    const entities = container.querySelectorAll('.study-topics__entity');
    expect(entities.length).toBe(2);
  });

  it('renders both topic groups and entity group together', () => {
    mockVerseTopics = [makeTopic()];
    mockVerseEntities = [makeEntity()];
    const { container } = render(<StudyTopics />);
    const groups = container.querySelectorAll('.study-topics__group');
    // 1 topic group + 1 entity group
    expect(groups.length).toBe(2);
  });
});
