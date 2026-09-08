/**
 * "What is this verse about?" - the topics a verse belongs to, grouped by
 * source and shown as a clickable hierarchy.
 *
 * Each row is the topic's full ancestry, not just its name:
 *
 *     - Salvation (412) > Repentance (58) > Godly Sorrow (9)
 *
 * That is what makes the answer usable. A bare leaf name ("Godly Sorrow")
 * says where the verse was filed but not what it was filed *under*, and a
 * topical index is only as useful as the path into it - every segment is a
 * link, so the reader can step out to the broader subject or in to the narrow
 * one without going back to browse.
 *
 * Lifted out of `StudyPane`, which grew this rendering inline. The Topics pane
 * had its own flat list that dropped the `ancestors` the IPC layer was already
 * sending, so the same question got a worse answer depending on which pane you
 * asked it in. Both render this now.
 */
import React from 'react';
import { useI18n } from '../../contexts/useI18n';

/** One step in a topic's ancestry, including the topic itself. */
export interface VerseTopicAncestor {
  topic_id: number;
  name: string;
  verse_count: number;
}

/** A topic a verse belongs to, as the `topical:getTopicsForVerse` IPC returns it. */
export interface VerseTopic {
  topic_id: number;
  name: string;
  description?: string;
  parent_topic_id?: number;
  parent_name?: string;
  /** Root-first chain above this topic. Absent for a root topic. */
  ancestors?: VerseTopicAncestor[];
  source_abbreviation: string;
  source_name: string;
  verse_count: number;
}

export interface VerseTopicsListProps {
  topics: VerseTopic[];
  onTopicClick: (sourceAbbreviation: string, topicId: number) => void;
  /**
   * Scales font sizes with the pane's UI scale. The Study pane runs at its own
   * scale; panes without one pass nothing and get the raw pixel sizes.
   */
  scale?: (px: number) => number | string;
  /** Rendered in place of the list when there are no topics. */
  emptyState?: React.ReactNode;
}

const identityScale = (px: number): number => px;

const VerseTopicsList: React.FC<VerseTopicsListProps> = ({
  topics,
  onTopicClick,
  scale = identityScale,
  emptyState,
}) => {
  const { t } = useI18n();

  if (topics.length === 0) {
    return <>{emptyState ?? t('studyPane.noTopics')}</>;
  }

  // Grouped by source so two topical indexes that both file a verse under
  // "Grace" read as two answers, not one contradictory list.
  const bySource = topics.reduce<Record<string, VerseTopic[]>>((acc, topic) => {
    const key = topic.source_abbreviation;
    if (!acc[key]) acc[key] = [];
    acc[key].push(topic);
    return acc;
  }, {});

  return (
    <>
      {Object.entries(bySource).map(([sourceAbbr, sourceTopics]) => (
        <div key={sourceAbbr} style={{ marginBottom: '8px' }}>
          <div
            style={{
              fontSize: scale(10),
              color: 'var(--theme-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '4px',
            }}
          >
            {sourceTopics[0].source_name}
          </div>

          {sourceTopics.map(topic => {
            const chain: VerseTopicAncestor[] = [
              ...(topic.ancestors ?? []).map(a => ({
                topic_id: a.topic_id,
                name: a.name,
                verse_count: a.verse_count,
              })),
              { topic_id: topic.topic_id, name: topic.name, verse_count: topic.verse_count },
            ];

            return (
              <div
                key={`${sourceAbbr}-${topic.topic_id}`}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  fontSize: scale(12),
                  lineHeight: '1.6',
                  marginBottom: '2px',
                }}
              >
                <span
                  style={{
                    color: 'var(--theme-text-secondary)',
                    marginInlineEnd: '6px',
                    flexShrink: 0,
                  }}
                >
                  •
                </span>
                <span style={{ flexWrap: 'wrap', display: 'inline' }}>
                  {chain.map((item, depth) => (
                    <React.Fragment key={item.topic_id}>
                      {depth > 0 && (
                        <span style={{ color: 'var(--theme-text-secondary)', margin: '0 3px' }}>
                          {'>'}
                        </span>
                      )}
                      <a
                        href="#"
                        data-testid="study-topic-link"
                        onClick={e => {
                          e.preventDefault();
                          onTopicClick(topic.source_abbreviation, item.topic_id);
                        }}
                        style={{
                          color: 'var(--theme-accent-primary)',
                          textDecoration: 'none',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.textDecoration = 'underline';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.textDecoration = 'none';
                        }}
                      >
                        {item.name}
                      </a>
                      {item.verse_count > 0 && (
                        <span
                          style={{
                            color: 'var(--theme-text-secondary)',
                            fontSize: scale(11),
                          }}
                        >
                          {' '}
                          ({item.verse_count})
                        </span>
                      )}
                    </React.Fragment>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
};

export default VerseTopicsList;
