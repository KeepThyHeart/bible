import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import TopicSearchBar from '../shared/TopicSearchBar';
import TopicCard from '../shared/TopicCard';
import VerseListWithPreview from '../shared/VerseListWithPreview';
import RelatedTagGraphSection from './RelatedTagGraphSection';
import { TopicDetail, TopicVerseResult, AlsoInResult, TagGraphAssociation } from './types';

interface TopicViewProps {
  detail: TopicDetail | null;
  verses: TopicVerseResult[];
  /** The verse the reader is on, marked in the passage list. */
  currentVerseId?: number | null;
  hasMoreVerses: boolean;
  loadingMoreVerses: boolean;
  onLoadMoreVerses: () => void;
  alsoIn: AlsoInResult[];
  abbreviation: string;
  loading: boolean;
  tagGraphAssociations: TagGraphAssociation[];
  tagGraphMapping: { entityId: string; entityCategory: string } | null;
  onTopicClick: (abbreviation: string, topicId: number) => void;
  onSearchSelect: (abbreviation: string, topicId: number) => void;
  onVerseClick: (verseId: number) => void;
  onEntityClick: (entityId: string, entityCategory: string) => void;
}

/** Topic detail view */
const TopicView: React.FC<TopicViewProps> = ({
  detail, verses, currentVerseId, alsoIn, abbreviation, loading,
  hasMoreVerses, loadingMoreVerses, onLoadMoreVerses,
  tagGraphAssociations, tagGraphMapping,
  onTopicClick, onSearchSelect, onVerseClick, onEntityClick,
}) => {
  const { t } = useI18n();
  if (loading || !detail) {
    return <div style={{ textAlign: 'center', padding: '20px', color: 'var(--theme-text-secondary)', fontSize: '13px' }}>{t('topicsPane.loadingTopic')}</div>;
  }

  return (
    <div data-testid="topic-view">
      {/* Search bar */}
      <div style={{ marginBottom: '12px' }}>
        <TopicSearchBar onSelectTopic={onSearchSelect} placeholder={t('topicsPane.searchPlaceholder')} />
      </div>

      {/* Breadcrumb */}
      {detail.parent_chain.length > 0 && (
        <div data-testid="topic-breadcrumb" style={{ fontSize: '12px', color: 'var(--theme-text-secondary)', marginBottom: '8px', display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
          {detail.parent_chain.map((p, i) => (
            <span key={p.topic_id}>
              <span
                data-testid="topic-breadcrumb-link"
                style={{ color: 'var(--theme-accent-primary)', cursor: 'pointer' }}
                onClick={() => onTopicClick(abbreviation, p.topic_id)}
              >
                {p.name}
              </span>
              {i < detail.parent_chain.length - 1 && ' > '}
            </span>
          ))}
          <span> {'>'} </span>
        </div>
      )}

      {/* Topic header */}
      <div style={{ marginBottom: '12px' }}>
        <h3 data-testid="topic-name" style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 4px 0' }}>{detail.topic.name}</h3>
        {/*
          Which index this is. "Jericho" reads identically in Nave's and in
          Torrey's, and with nothing on the page naming the source a reader had
          no way of telling the two entries apart - least of all after
          following an "Also in" link, whose whole purpose is to cross between
          them. Named the same way the "Also in" row below names the others, so
          the pair reads as "you are here / and also there".
        */}
        {detail.source_name && (
          <div data-testid="topic-source" style={{ fontSize: '12px', color: 'var(--theme-text-secondary)' }}>
            {t('topicsPane.fromSource', { source: detail.source_name })}
          </div>
        )}
        {/*
          Two counts, and the reader was only shown the misleading one. "160
          verses" was the total with ranges expanded, while the list below it
          held 49 rows - so the number never matched anything on screen. What
          is countable here is passages; the label names both so the number
          and the list agree.
        */}
        <div data-testid="topic-verse-count" style={{ fontSize: '12px', color: 'var(--theme-text-secondary)' }}>
          {typeof detail.reference_count === 'number'
            ? detail.reference_count === 1
              ? t('topicsPane.passageCountOne')
              : t('topicsPane.passageCount', { count: detail.reference_count })
            : detail.verse_count === 1
              ? t('topicsPane.verseCountOne')
              : t('topicsPane.verseCount', { count: detail.verse_count })}
        </div>
      </div>

      {/* Also in */}
      {alsoIn.length > 0 && (
        <div data-testid="topic-also-in" style={{ fontSize: '12px', color: 'var(--theme-text-secondary)', marginBottom: '12px' }}>
          {t('topicsPane.alsoIn')}{' '}
          {alsoIn.map((a, i) => (
            <span key={`${a.source_abbreviation}-${a.topic_id}`}>
              {i > 0 && ', '}
              <span
                data-testid="topic-also-in-link"
                style={{ color: 'var(--theme-accent-primary)', cursor: 'pointer' }}
                onClick={() => onTopicClick(a.source_abbreviation, a.topic_id)}
              >
                {a.source_name}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Description */}
      {detail.topic.description && (
        <div style={{ fontSize: '13px', lineHeight: '1.5', marginBottom: '12px', color: 'var(--theme-text-secondary)' }}>
          {detail.topic.description}
        </div>
      )}

      {/* Sub-topics as cards */}
      {detail.children.length > 0 && (
        <div data-testid="topic-subtopics" style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>{t('topicsPane.subTopics')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
            {detail.children.map(c => (
              <TopicCard
                key={c.topic_id}
                name={c.name}
                description={c.description}
                verseCount={c.verse_count}
                childCount={c.child_count}
                variant="child"
                onClick={() => onTopicClick(abbreviation, c.topic_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Related (Tag Graph) */}
      {tagGraphAssociations.length > 0 && tagGraphMapping && (
        <RelatedTagGraphSection
          associations={tagGraphAssociations}
          mapping={tagGraphMapping}
          onEntityClick={onEntityClick}
        />
      )}

      {/* Verses */}
      {verses.length > 0 && (
        <div data-testid="topic-verses">
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>{t('topicsPane.verses')}</div>
          <VerseListWithPreview
            verses={verses.map(v => ({ start_verse_id: v.start_verse_id, end_verse_id: v.end_verse_id, context: v.context }))}
            currentVerseId={currentVerseId ?? undefined}
            onVerseClick={onVerseClick}
            maxVisible={20}
            storageKey={`topic-verses-${abbreviation}`}
            hasMore={hasMoreVerses}
            loadingMore={loadingMoreVerses}
            onLoadMore={onLoadMoreVerses}
          />
        </div>
      )}
    </div>
  );
};

export default TopicView;
