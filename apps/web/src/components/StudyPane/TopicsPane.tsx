import { TopicsBrowser } from './TopicsBrowser';
import { bibleStore } from '../../stores/bibleStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { studyStore } from '../../stores/studyStore';
import { useStore } from '../../hooks/useStore';
import { parseVerseId } from '../../utils/verseId';
import type { ITopicalDataProvider, ITagGraphDataProvider, IBibleDataProvider } from '../../providers/interfaces';

interface TopicsPaneProps {
  topicalProvider?: ITopicalDataProvider;
  tagGraphProvider?: ITagGraphDataProvider;
  bibleProvider?: IBibleDataProvider;
  mobile?: boolean;
}

/**
 * Standalone Topics pane — shows topics for the current verse on Home,
 * with full topic browsing and search capabilities.
 *
 * The pending topic request is *read* here and *cleared by the browser* once it
 * has actually opened the topic. It used to be consumed straight out of this
 * render body, which had two consequences: a request raised while this pane was
 * already mounted was dropped on the floor (nothing remounts, so nothing reads
 * it), and any repeat render between the read and the child's mount effect
 * could throw the request away before it was acted on.
 */
export function TopicsPane({ topicalProvider, tagGraphProvider, bibleProvider, mobile }: TopicsPaneProps) {
  const topicRequest = useStore(commentaryStore, () => commentaryStore.pendingTopicNav);

  const verseId = useStore(studyStore, () => studyStore.verseId);
  const verseTopics = useStore(studyStore, () => studyStore.verseTopics);
  const verseEntities = useStore(studyStore, () => studyStore.verseEntities);
  const topicsLoading = useStore(studyStore, () => studyStore.topicsLoading);

  const handleNavigateBible = (targetVerseId: number) => {
    const { bookNumber, chapter, verse } = parseVerseId(targetVerseId);
    bibleStore.navigateToPreview(bookNumber, chapter, verse);
  };

  return (
    <div class="topics-pane">
      <TopicsBrowser
        verseId={verseId}
        verseTopics={verseTopics}
        verseEntities={verseEntities}
        loading={topicsLoading}
        onNavigateBible={handleNavigateBible}
        topicalProvider={topicalProvider}
        tagGraphProvider={tagGraphProvider}
        bibleProvider={bibleProvider}
        topicRequest={topicRequest ?? undefined}
        onTopicRequestHandled={() => commentaryStore.consumePendingTopicNav()}
        mobile={mobile}
      />
    </div>
  );
}
