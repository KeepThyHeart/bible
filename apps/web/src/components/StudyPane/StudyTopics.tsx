import { useEffect, useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { studyStore } from '../../stores/studyStore';
import { offlineStore } from '../../stores/offlineStore';
import { useStore } from '../../hooks/useStore';

interface StudyTopicsProps {
  onTopicClick?: (topicId: number, module: string, topicName: string, sourceName?: string) => void;
}

/**
 * StudyTopics — Verse-specific topics display for the Study pane.
 * Shows topics from Nave's/Torrey's and tag graph entities, grouped by source.
 */
export function StudyTopics({ onTopicClick }: StudyTopicsProps) {
  const { t } = useTranslation();
  const verseId = useStore(studyStore, () => studyStore.verseId);
  const verseTopics = useStore(studyStore, () => studyStore.verseTopics);
  const verseEntities = useStore(studyStore, () => studyStore.verseEntities);
  const loading = useStore(studyStore, () => studyStore.topicsLoading);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);

  // Mounted is the signal to load; see StudyCrossRefs.
  useEffect(() => {
    studyStore.ensureTopics();
  }, [verseId]);

  // Group topics by source
  const groupedTopics = useMemo(() => {
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

  if (loading) {
    return <div class="study-topics__loading">{t('studyTopics.loading')}</div>;
  }

  if (verseTopics.length === 0 && verseEntities.length === 0) {
    return <div class="study-topics__empty">{!isOnline ? t('studyTopics.offlineNotice') : t('studyTopics.noTopics')}</div>;
  }

  return (
    <div class="study-topics">
      {groupedTopics.map(group => (
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
                          onClick={() => onTopicClick?.(a.topic_id, topic.source_abbreviation, a.name, topic.source_name)}
                          onKeyDown={(e) => { if (e.key === 'Enter') onTopicClick?.(a.topic_id, topic.source_abbreviation, a.name, topic.source_name); }}
                        >{a.name}{a.verse_count > 0 && <span class="study-topics__count">&nbsp;({a.verse_count})</span>}</span>
                      ) : (
                        // An ancestor with no id — a study cache generated before
                        // ancestor ids were stored. It cannot be opened, so it is
                        // not offered as a link; clicking one used to report
                        // "This topic could not be loaded".
                        <span class="study-topics__chain-name">{a.name}</span>
                      )}
                    </span>
                  ))}
                  {topic.ancestors.length > 0 && <span class="study-topics__chain-sep"> &gt; </span>}
                  <span
                    class="study-topics__chain-link study-topics__chain-current"
                    role="button"
                    tabIndex={0}
                    onClick={() => onTopicClick?.(topic.topic_id, topic.source_abbreviation, topic.name, topic.source_name)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onTopicClick?.(topic.topic_id, topic.source_abbreviation, topic.name, topic.source_name); }}
                  >{topic.name}<span class="study-topics__count">&nbsp;({topic.verse_count})</span></span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {verseEntities.length > 0 && (
        <div class="study-topics__group">
          <div class="study-topics__group-label">{t('studyTopics.entities')}</div>
          <ul class="study-topics__list">
            {verseEntities.map(entity => (
              <li key={`${entity.category}-${entity.entity_id}`} class="study-topics__entity">
                <span class="study-topics__entity-name">{entity.name}</span>
                <span class="study-topics__entity-badge">{entity.category}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
