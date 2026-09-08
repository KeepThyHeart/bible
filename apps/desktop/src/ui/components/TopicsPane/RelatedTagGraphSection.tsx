import React, { useMemo, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import TopicCard from '../shared/TopicCard';
import { TagGraphAssociation, CATEGORY_LABELS, CATEGORY_COLORS } from './types';

interface RelatedTagGraphSectionProps {
  associations: TagGraphAssociation[];
  mapping: { entityId: string; entityCategory: string };
  onEntityClick: (entityId: string, entityCategory: string) => void;
}

/** Related (Tag Graph) collapsible section in TopicView */
const RelatedTagGraphSection: React.FC<RelatedTagGraphSectionProps> = ({ associations, mapping, onEntityClick }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // Group by target category
  const grouped = useMemo(() => {
    const groups: Record<string, TagGraphAssociation[]> = {};
    for (const assoc of associations) {
      const cat = assoc.entity2Category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(assoc);
    }
    return groups;
  }, [associations]);

  const visibleThreshold = 0.3;

  return (
    <div data-testid="topic-tag-graph" style={{ marginBottom: '16px' }}>
      <div
        style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px', cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ fontSize: '10px' }}>{expanded ? '\u25BC' : '\u25B6'}</span>
        {t('relatedTagGraph.heading')}
        <span
          data-testid="view-entity"
          style={{ fontSize: '11px', color: 'var(--theme-accent-primary)', fontWeight: 400, marginInlineStart: '4px', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onEntityClick(mapping.entityId, mapping.entityCategory); }}
        >
          {t('relatedTagGraph.viewEntity')}
        </span>
      </div>

      {expanded && Object.entries(grouped).map(([cat, assocs]) => {
        const visible = showAll ? assocs : assocs.filter(a => a.strength >= visibleThreshold);
        const hiddenCount = assocs.length - assocs.filter(a => a.strength >= visibleThreshold).length;

        if (visible.length === 0 && !showAll) return null;

        return (
          <div key={cat} data-testid="tag-graph-category" style={{ marginBottom: '10px' }}>
            <div data-testid="tag-graph-category-label" style={{
              fontSize: '11px',
              fontWeight: 600,
              color: CATEGORY_COLORS[cat] ?? 'var(--theme-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '6px',
            }}>
              {CATEGORY_LABELS[cat] ?? cat}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
              {visible.map(assoc => (
                <TopicCard
                  key={assoc.id}
                  name={assoc.entity2Name ?? assoc.entity2Id}
                  relationship={assoc.relationshipName}
                  categoryLabel={CATEGORY_LABELS[assoc.entity2Category] ?? assoc.entity2Category}
                  categoryColor={CATEGORY_COLORS[assoc.entity2Category]}
                  strength={assoc.strength}
                  variant="related"
                  onClick={() => onEntityClick(assoc.entity2Id, assoc.entity2Category)}
                />
              ))}
            </div>
            {!showAll && hiddenCount > 0 && (
              <button
                onClick={() => setShowAll(true)}
                style={{
                  fontSize: '11px',
                  color: 'var(--theme-accent-primary)',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 0',
                  marginTop: '4px',
                }}
              >
                {t('relatedTagGraph.showMore', { count: hiddenCount })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default RelatedTagGraphSection;
