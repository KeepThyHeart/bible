import React, { useMemo, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import TopicSearchBar from '../shared/TopicSearchBar';
import TopicCard from '../shared/TopicCard';
import {
  TagGraphAssociation,
  TagGraphEntityDetail,
  PeopleRelationshipResult,
  EntityFacetResult,
  EntityTopicLinkResult,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  SOURCE_DISPLAY_NAMES,
} from './types';

interface EntityDetailViewProps {
  entity: TagGraphEntityDetail | null;
  associations: TagGraphAssociation[];
  relationships: PeopleRelationshipResult[];
  aliases: string[];
  facets: EntityFacetResult[];
  topicLinks: EntityTopicLinkResult[];
  loading: boolean;
  onEntityClick: (entityId: string, entityCategory: string) => void;
  onSearchSelect: (abbreviation: string, topicId: number) => void;
  onTopicLinkClick: (abbreviation: string, topicId: number) => void;
}

/** Entity detail view (tag graph entity) */
const EntityDetailView: React.FC<EntityDetailViewProps> = ({
  entity, associations, relationships, aliases, facets, topicLinks, loading,
  onEntityClick, onSearchSelect, onTopicLinkClick,
}) => {
  const { t } = useI18n();
  const [showAllAssocs, setShowAllAssocs] = useState(false);
  const [expandedFacets, setExpandedFacets] = useState<Set<number>>(new Set());

  // Group associations by target category (must be before early return to preserve hook order)
  const grouped = useMemo(() => {
    const groups: Record<string, TagGraphAssociation[]> = {};
    for (const assoc of associations) {
      const cat = assoc.entity2Category;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(assoc);
    }
    return groups;
  }, [associations]);

  // Group topic links by source module
  const topicLinksBySource = useMemo(() => {
    const groups: Record<string, EntityTopicLinkResult[]> = {};
    for (const link of topicLinks) {
      if (!groups[link.sourceModule]) groups[link.sourceModule] = [];
      groups[link.sourceModule].push(link);
    }
    return groups;
  }, [topicLinks]);

  if (loading || !entity) {
    return <div style={{ textAlign: 'center', padding: '20px', color: 'var(--theme-text-secondary)', fontSize: '13px' }}>{t('topicsPane.loadingEntity')}</div>;
  }

  const catColor = CATEGORY_COLORS[entity.category] ?? 'var(--theme-text-secondary)';

  const toggleFacet = (facetId: number) => {
    setExpandedFacets(prev => {
      const next = new Set(prev);
      if (next.has(facetId)) next.delete(facetId);
      else next.add(facetId);
      return next;
    });
  };

  return (
    <div data-testid="entity-detail">
      {/* Search bar */}
      <div style={{ marginBottom: '12px' }}>
        <TopicSearchBar onSelectTopic={onSearchSelect} placeholder={t('topicsPane.searchPlaceholder')} />
      </div>

      {/* Entity header */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <h3 data-testid="entity-name" style={{ fontSize: '16px', fontWeight: 600, margin: 0 }}>{entity.name}</h3>
          <span data-testid="entity-category" style={{
            fontSize: '10px',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: '10px',
            backgroundColor: catColor,
            color: '#fff',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {CATEGORY_LABELS[entity.category] ?? entity.category}
          </span>
        </div>

        {/* Aliases */}
        {aliases.length > 0 && (
          <div data-testid="entity-aliases" style={{ fontSize: '12px', color: 'var(--theme-text-secondary)', marginBottom: '4px' }}>
            {t('entityDetailView.alsoKnownAs', { v1: aliases.join(', ') })}
          </div>
        )}

        {/* Category-specific details */}
        {entity.tribe && <div style={{ fontSize: '12px', color: 'var(--theme-text-secondary)' }}>{t('entityDetailView.tribe', { v1: entity.tribe })}</div>}
        {entity.nation && <div style={{ fontSize: '12px', color: 'var(--theme-text-secondary)' }}>{t('entityDetailView.nation', { v1: entity.nation })}</div>}
        {entity.roles && entity.roles.length > 0 && (
          <div style={{ fontSize: '12px', color: 'var(--theme-text-secondary)' }}>{t('entityDetailView.roles', { v1: entity.roles.join(', ') })}</div>
        )}
        {entity.modernName && <div style={{ fontSize: '12px', color: 'var(--theme-text-secondary)' }}>{t('entityDetailView.modernName', { v1: entity.modernName })}</div>}
        {entity.significance && <div style={{ fontSize: '12px', color: 'var(--theme-text-secondary)' }}>{t('entityDetailView.significance', { v1: entity.significance })}</div>}
        {entity.traditions && entity.traditions.length > 0 && (
          <div style={{ fontSize: '12px', color: 'var(--theme-text-secondary)' }}>{t('entityDetailView.traditions', { v1: entity.traditions.join(', ') })}</div>
        )}
        {entity.attributes && entity.attributes.length > 0 && (
          <div style={{ fontSize: '12px', color: 'var(--theme-text-secondary)' }}>{t('entityDetailView.attributes', { v1: entity.attributes.join(', ') })}</div>
        )}
      </div>

      {/* Topic links - "In Nave's / In Torrey's" */}
      {topicLinks.length > 0 && (
        <div style={{ marginBottom: '12px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {Object.entries(topicLinksBySource).map(([source, links]) => (
            <button
              key={source}
              onClick={() => onTopicLinkClick(source, links[0].topicId)}
              style={{
                fontSize: '11px',
                color: 'var(--theme-accent-primary)',
                backgroundColor: 'var(--theme-bg-tertiary)',
                border: '1px solid var(--theme-border-secondary)',
                borderRadius: '4px',
                cursor: 'pointer',
                padding: '3px 8px',
              }}
            >
              {SOURCE_DISPLAY_NAMES[source] ?? source}
            </button>
          ))}
        </div>
      )}

      {/* Notes */}
      {entity.notes && (
        <div style={{ fontSize: '13px', lineHeight: '1.5', marginBottom: '12px', color: 'var(--theme-text-secondary)' }}>
          {entity.notes}
        </div>
      )}

      {/* Facets (structural subtopic groups) */}
      {facets.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>{t('topicsPane.subtopics')}</div>
          {facets.map(facet => {
            const isExpanded = expandedFacets.has(facet.facetId);
            const members = facet.members ?? [];
            return (
              <div key={facet.facetId} style={{ marginBottom: '6px' }}>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: 'var(--theme-text-primary)',
                    padding: '3px 0',
                  }}
                  onClick={() => toggleFacet(facet.facetId)}
                >
                  <span style={{ fontSize: '9px', width: '12px' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
                  {facet.facetDisplayLabel}
                  <span style={{ fontSize: '11px', color: 'var(--theme-text-tertiary)', marginInlineStart: '4px' }}>
                    ({members.length})
                  </span>
                </div>
                {isExpanded && members.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '6px', marginInlineStart: '16px', marginTop: '4px' }}>
                    {members.map(m => (
                      <TopicCard
                        key={`${facet.facetId}-${m.memberEntityId}`}
                        name={m.memberName ?? m.memberEntityId}
                        categoryLabel={CATEGORY_LABELS[m.memberEntityCategory] ?? m.memberEntityCategory}
                        categoryColor={CATEGORY_COLORS[m.memberEntityCategory]}
                        variant="related"
                        onClick={() => onEntityClick(m.memberEntityId, m.memberEntityCategory)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* People relationships (family tree) */}
      {relationships.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>{t('topicsPane.familyRelationships')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
            {relationships.map(rel => (
              <TopicCard
                key={rel.id}
                name={rel.person2Name ?? rel.person2Id}
                relationship={rel.relationshipType.replace(/_/g, ' ')}
                categoryLabel="People"
                categoryColor={CATEGORY_COLORS.people}
                variant="related"
                onClick={() => onEntityClick(rel.person2Id, 'people')}
              />
            ))}
          </div>
        </div>
      )}

      {/* Associations grouped by category */}
      {Object.entries(grouped).map(([cat, assocs]) => {
        const visibleAssocs = showAllAssocs ? assocs : assocs.filter(a => a.strength >= 0.3);
        const hiddenCount = assocs.length - assocs.filter(a => a.strength >= 0.3).length;

        return (
          <div key={cat} style={{ marginBottom: '12px' }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: CATEGORY_COLORS[cat] ?? 'var(--theme-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '6px',
            }}>
              {CATEGORY_LABELS[cat] ?? cat}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
              {visibleAssocs.map(assoc => (
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
            {!showAllAssocs && hiddenCount > 0 && (
              <button
                onClick={() => setShowAllAssocs(true)}
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
                Show {hiddenCount} more...
              </button>
            )}
          </div>
        );
      })}

      {associations.length === 0 && facets.length === 0 && (
        <div style={{ textAlign: 'center', padding: '12px', color: 'var(--theme-text-secondary)', fontSize: '13px' }}>
          {t('entityDetailView.noAssociationsFoundForThisEntity')}
        </div>
      )}
    </div>
  );
};

export default EntityDetailView;
