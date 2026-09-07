import type { VerseTopicData } from '../../types';
/**
 * Component tests for TopicsPane.
 *
 * Pattern: Store-connected component. Reads verseId and topic data from
 * studyStore, and passes commentaryStore's pending topic request straight
 * through to TopicsBrowser (which clears it once it has opened it — the pane
 * deliberately does NOT consume it during render). TopicsBrowser (the heavy
 * child) is mocked to capture its props without rendering the full UI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// Capture props passed to TopicsBrowser
let lastTopicsBrowserProps: Record<string, unknown> = {};
vi.mock('./TopicsBrowser', () => ({
  TopicsBrowser: (props: Record<string, unknown>) => {
    lastTopicsBrowserProps = props;
    return <div data-testid="topics-browser" data-verse-id={props.verseId as number} />;
  },
}));

import { TopicsPane } from './TopicsPane';
import { studyStore } from '../../stores/studyStore';
import { commentaryStore } from '../../stores/commentaryStore';

beforeEach(() => {
  lastTopicsBrowserProps = {};
  // Reset study store to a clean state
  studyStore.verseId = null;
  studyStore.verseTopics = [];
  studyStore.verseEntities = [];
  studyStore.topicsLoading = false;
  // Ensure no pending topic nav
  commentaryStore.pendingTopicNav = null;
});

describe('TopicsPane', () => {
  it('renders the topics-pane container', () => {
    const { container } = render(<TopicsPane />);
    expect(container.querySelector('.topics-pane')).toBeTruthy();
  });

  it('renders TopicsBrowser inside the pane', () => {
    const { container } = render(<TopicsPane />);
    expect(container.querySelector('[data-testid="topics-browser"]')).toBeTruthy();
  });

  it('passes verseId from studyStore to TopicsBrowser', () => {
    act(() => { studyStore.verseId = 43003016; });
    render(<TopicsPane />);
    expect(lastTopicsBrowserProps.verseId).toBe(43003016);
  });

  it('passes null verseId when studyStore has no verse', () => {
    render(<TopicsPane />);
    expect(lastTopicsBrowserProps.verseId).toBeNull();
  });

  it('passes verseTopics from studyStore to TopicsBrowser', () => {
    // Was `{ topicId, topicName, module, sourceName }` — camelCase keys that do
    // not appear on `VerseTopicData` at all, so the test proved the prop was
    // forwarded without proving it could carry a real topic.
    const topics: VerseTopicData[] = [{
      topic_id: 1,
      parent_topic_id: null,
      name: 'Faith',
      description: null,
      ancestors: [],
      source_abbreviation: 'TSK',
      source_name: 'Treasury of Scripture Knowledge',
      verse_count: 12,
    }];
    act(() => { studyStore.verseTopics = topics; });
    render(<TopicsPane />);
    expect(lastTopicsBrowserProps.verseTopics).toEqual(topics);
  });

  it('passes topicsLoading from studyStore to TopicsBrowser', () => {
    act(() => { studyStore.topicsLoading = true; });
    render(<TopicsPane />);
    expect(lastTopicsBrowserProps.loading).toBe(true);
  });

  it('passes mobile prop through to TopicsBrowser', () => {
    render(<TopicsPane mobile />);
    expect(lastTopicsBrowserProps.mobile).toBe(true);
  });

  it('passes mobile=undefined when not set', () => {
    render(<TopicsPane />);
    expect(lastTopicsBrowserProps.mobile).toBeUndefined();
  });

  it('passes the pending topic request through to TopicsBrowser', () => {
    const pending = { topicId: 42, module: 'TSK', topicName: 'Grace', sourceName: 'TSK', token: 1 };
    act(() => { commentaryStore.pendingTopicNav = pending; });
    render(<TopicsPane />);
    expect(lastTopicsBrowserProps.topicRequest).toEqual(pending);
  });

  it('passes topicRequest=undefined when no request is pending', () => {
    render(<TopicsPane />);
    expect(lastTopicsBrowserProps.topicRequest).toBeUndefined();
  });

  it('does not consume the request during render — the browser clears it once opened', () => {
    const pending = { topicId: 42, module: 'TSK', topicName: 'Grace', sourceName: 'TSK', token: 1 };
    act(() => { commentaryStore.pendingTopicNav = pending; });
    render(<TopicsPane />);
    expect(commentaryStore.pendingTopicNav).toEqual(pending);
  });

  it('clears the request through onTopicRequestHandled', () => {
    const pending = { topicId: 42, module: 'TSK', topicName: 'Grace', sourceName: 'TSK', token: 1 };
    act(() => { commentaryStore.pendingTopicNav = pending; });
    render(<TopicsPane />);
    act(() => { (lastTopicsBrowserProps.onTopicRequestHandled as () => void)(); });
    expect(commentaryStore.pendingTopicNav).toBeNull();
  });

  it('picks up a request raised while the pane is already mounted', () => {
    const { rerender } = render(<TopicsPane />);
    expect(lastTopicsBrowserProps.topicRequest).toBeUndefined();
    act(() => { commentaryStore.navigateToTopic(7, 'TSK', 'Mercy'); });
    rerender(<TopicsPane />);
    expect((lastTopicsBrowserProps.topicRequest as { topicId: number }).topicId).toBe(7);
  });

  it('passes optional provider props through to TopicsBrowser', () => {
    const topicalProvider = {} as never;
    const tagGraphProvider = {} as never;
    const bibleProvider = {} as never;
    render(
      <TopicsPane
        topicalProvider={topicalProvider}
        tagGraphProvider={tagGraphProvider}
        bibleProvider={bibleProvider}
      />,
    );
    expect(lastTopicsBrowserProps.topicalProvider).toBe(topicalProvider);
    expect(lastTopicsBrowserProps.tagGraphProvider).toBe(tagGraphProvider);
    expect(lastTopicsBrowserProps.bibleProvider).toBe(bibleProvider);
  });
});
