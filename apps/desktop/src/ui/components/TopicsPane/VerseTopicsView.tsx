import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import TopicSearchBar from '../shared/TopicSearchBar';
import VerseTopicsList, { type VerseTopic } from '../shared/VerseTopicsList';
import { formatVerseReference } from '../../utils/verseReference';

interface VerseTopicsViewProps {
  verseId: number;
  topics: VerseTopic[];
  loading: boolean;
  onTopicClick: (abbreviation: string, topicId: number) => void;
  onSearchSelect: (abbreviation: string, topicId: number) => void;
  onBrowse: () => void;
}

/**
 * "What is this verse about?" in the Topics pane.
 *
 * The list itself is `shared/VerseTopicsList`, the same component the Study
 * pane uses, so the answer does not depend on which pane you ask. A flat list
 * of leaf names rendered here instead would throw away the `ancestors` the
 * IPC layer already sends: the Study pane would show "Salvation (412) >
 * Repentance (58) > Godly Sorrow (9)" while the pane dedicated to topics
 * showed "Godly Sorrow" and nothing about where it sits.
 */
const VerseTopicsView: React.FC<VerseTopicsViewProps> = ({
  verseId, topics, loading, onTopicClick, onSearchSelect, onBrowse,
}) => {
  const { t } = useI18n();
  const label = formatVerseReference(verseId);

  return (
    <div>
      <div style={{ marginBottom: '12px' }}>
        <TopicSearchBar onSelectTopic={onSearchSelect} placeholder={t('topicsPane.searchPlaceholder')} />
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        marginBottom: '12px',
        backgroundColor: 'var(--theme-bg-secondary, rgba(0,0,0,0.03))',
        borderRadius: '6px',
        fontSize: '14px',
      }}>
        <span style={{ fontWeight: 500 }}>
          {t('topicsPane.topicsForVerse', { reference: label })}
        </span>
        <button
          onClick={onBrowse}
          style={{
            fontSize: '12px',
            border: 'none',
            backgroundColor: 'transparent',
            color: 'var(--theme-accent-primary)',
            cursor: 'pointer',
          }}
        >
          {t('topicsPane.browseAll')}
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--theme-text-secondary)', fontSize: '13px' }}>{t('topicsPane.loading')}</div>
      ) : (
        <VerseTopicsList
          topics={topics}
          onTopicClick={onTopicClick}
          emptyState={
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--theme-text-secondary)', fontSize: '13px' }}>
              {t('topicsPane.noTopicsForVerse')}
            </div>
          }
        />
      )}
    </div>
  );
};

export default VerseTopicsView;
