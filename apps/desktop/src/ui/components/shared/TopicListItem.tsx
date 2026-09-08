import React from 'react';

interface TopicListItemProps {
  topicName: string;
  parentPath?: string;
  source?: string;
  verseCount?: number;
  onClick: () => void;
  indented?: boolean;
}

/**
 * Renders a single topic entry with name, source label, and verse count badge.
 * Used in Study Pane topic list, Topics Pane browse/sub-topics.
 */
const TopicListItem: React.FC<TopicListItemProps> = ({ topicName, parentPath, source, verseCount, onClick, indented }) => {
  return (
    <button
      data-testid="topic-list-item"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: parentPath ? '4px 10px' : '6px 10px',
        paddingInlineStart: indented ? '24px' : '10px',
        border: 'none',
        backgroundColor: 'transparent',
        color: 'var(--theme-text-primary)',
        cursor: 'pointer',
        fontSize: '13px',
        textAlign: 'start',
        gap: '8px',
        borderRadius: '4px',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--theme-tab-bg-hover, rgba(0,0,0,0.05))';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
        <span data-testid="topic-list-item-name" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {topicName}
        </span>
        {parentPath && (
          <span style={{
            display: 'block',
            fontSize: '11px',
            color: 'var(--theme-text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            opacity: 0.7,
            lineHeight: '1.3',
          }}>
            {parentPath}
          </span>
        )}
      </span>
      {source && (
        <span style={{
          fontSize: '11px',
          color: 'var(--theme-text-secondary)',
          flexShrink: 0,
        }}>
          ({source})
        </span>
      )}
      {verseCount !== undefined && verseCount > 0 && (
        <span style={{
          fontSize: '11px',
          color: 'var(--theme-text-secondary)',
          backgroundColor: 'var(--theme-bg-secondary, rgba(0,0,0,0.06))',
          padding: '1px 6px',
          borderRadius: '8px',
          flexShrink: 0,
        }}>
          {verseCount}
        </span>
      )}
    </button>
  );
};

export default TopicListItem;
