import React from 'react';
import { formatVerseReference } from '../../utils/verseReference';
import { useI18n } from '../../contexts/useI18n';

interface SuggestionBannerProps {
  verseId: number;
  messagePrefix: string;
  onGo: () => void;
  onDismiss: () => void;
}

/**
 * Non-intrusive banner shown when a verse is clicked in the Bible Pane.
 * The user can choose to navigate ([Go]) or ignore ([Dismiss]).
 */
const SuggestionBanner: React.FC<SuggestionBannerProps> = ({ verseId, messagePrefix, onGo, onDismiss }) => {
  const { t } = useI18n();
  const verseLabel = formatVerseReference(verseId);

  return (
    <div
      data-testid="suggestion-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        backgroundColor: 'var(--theme-accent-bg, rgba(59, 130, 246, 0.1))',
        borderBottom: '1px solid var(--theme-border-primary)',
        fontSize: '13px',
        color: 'var(--theme-text-primary)',
        gap: '8px',
        flexShrink: 0,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {messagePrefix} {verseLabel}
      </span>
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        <button
          onClick={onGo}
          style={{
            padding: '2px 10px',
            fontSize: '12px',
            borderRadius: '4px',
            border: 'none',
            backgroundColor: 'var(--theme-accent-primary)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {t('ui.suggestionBanner.go')}
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: '2px 10px',
            fontSize: '12px',
            borderRadius: '4px',
            border: '1px solid var(--theme-border-primary)',
            backgroundColor: 'transparent',
            color: 'var(--theme-text-secondary)',
            cursor: 'pointer',
          }}
        >
          {t('ui.suggestionBanner.dismiss')}
        </button>
      </div>
    </div>
  );
};

export default SuggestionBanner;
