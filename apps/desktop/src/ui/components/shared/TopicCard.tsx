import React from 'react';
import { useI18n } from '../../contexts/useI18n';

interface TopicCardProps {
  /** Primary display name */
  name: string;
  /** Relationship label (e.g., "Brother of", "Father of") - shown above the name */
  relationship?: string;
  /** Description or context text */
  description?: string;
  /** Category badge (e.g., "People", "Places") */
  categoryLabel?: string;
  /** Color for the category badge */
  categoryColor?: string;
  /** Verse count badge */
  verseCount?: number;
  /** Subtopic count badge */
  childCount?: number;
  /** Strength indicator (0-1 scale) for tag graph associations */
  strength?: number;
  /** Visual variant: 'child' for sub-topics, 'related' for tag graph associations */
  variant?: 'child' | 'related';
  onClick: () => void;
}

/**
 * Card component for displaying topics, sub-topics, and related entities
 * in the Topics pane. Supports different visual variants for hierarchy levels.
 */
const TopicCard: React.FC<TopicCardProps> = ({
  name,
  relationship,
  description,
  categoryLabel,
  categoryColor,
  verseCount,
  childCount,
  strength,
  variant = 'child',
  onClick,
}) => {
  const { t } = useI18n();
  const isRelated = variant === 'related';

  return (
    <button
      data-testid="topic-card"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '10px 12px',
        border: isRelated
          ? '1px dashed var(--theme-border-primary)'
          : '1px solid var(--theme-border-primary)',
        borderRadius: '8px',
        backgroundColor: 'var(--theme-bg-primary)',
        color: 'var(--theme-text-primary)',
        cursor: 'pointer',
        textAlign: 'start',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        transition: 'background-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--theme-tab-bg-hover, rgba(0,0,0,0.04))';
        e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--theme-bg-primary)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Top row: relationship label + category badge */}
      {(relationship || categoryLabel) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', minWidth: 0 }}>
          {relationship && (
            <span style={{
              fontSize: '11px',
              color: 'var(--theme-text-secondary)',
              fontStyle: 'italic',
              minWidth: 0,
            }}>
              {relationship}
            </span>
          )}
          {categoryLabel && (
            <span style={{
              fontSize: '9px',
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: '8px',
              backgroundColor: categoryColor ?? 'var(--theme-text-secondary)',
              color: '#fff',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginInlineStart: relationship ? 'auto' : '0',
            }}>
              {categoryLabel}
            </span>
          )}
        </div>
      )}

      {/* Name row with optional strength dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        {strength !== undefined && (
          <span
            style={{
              display: 'inline-block',
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: 'var(--theme-accent-primary)',
              opacity: Math.max(0.2, strength),
              flexShrink: 0,
            }}
            title={`Strength: ${(strength * 100).toFixed(0)}%`}
          />
        )}
        <span style={{
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--theme-text-primary)',
          wordBreak: 'break-word',
        }}>
          {name}
        </span>
      </div>

      {/* Description excerpt */}
      {description && (
        <span style={{
          fontSize: '11px',
          color: 'var(--theme-text-secondary)',
          marginTop: '3px',
          lineHeight: '1.4',
          wordBreak: 'break-word',
        }}>
          {description}
        </span>
      )}

      {/* Bottom row: verse count + child count badges */}
      {(verseCount !== undefined || childCount !== undefined) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
          {verseCount !== undefined && verseCount > 0 && (
            <span style={{
              fontSize: '11px',
              color: 'var(--theme-text-secondary)',
              backgroundColor: 'var(--theme-bg-secondary, rgba(0,0,0,0.06))',
              padding: '1px 7px',
              borderRadius: '8px',
            }}>
              {/* The value fed in here is `verse_count`, which expands ranges
- it counts verses, not passages. Labelling it "passages"
                  made it disagree with the list it was summarising. */}
              {verseCount === 1
                ? t('topicsPane.verseCountOne')
                : t('topicsPane.verseCount', { count: verseCount })}
            </span>
          )}
          {childCount !== undefined && childCount > 0 && (
            <span style={{
              fontSize: '11px',
              color: 'var(--theme-text-secondary)',
              backgroundColor: 'var(--theme-bg-secondary, rgba(0,0,0,0.06))',
              padding: '1px 7px',
              borderRadius: '8px',
            }}>
              {childCount === 1
                ? t('topicsPane.subtopicCountOne')
                : t('topicsPane.subtopicCount', { count: childCount })}
            </span>
          )}
        </div>
      )}
    </button>
  );
};

export default TopicCard;
