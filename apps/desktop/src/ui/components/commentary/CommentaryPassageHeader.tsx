import React from 'react';
import { useBibleStore } from '../../stores/useBibleStore';
import { formatVerseReference } from '../../utils/verseReference';
import { useI18n } from '../../contexts/useI18n';
import { PinButton } from '../shared/icons/PinIcon';

interface CommentaryPassageHeaderProps {
  currentVerseId: number | null;
  pinned: boolean;
  onTogglePin: () => void;
}

/**
 * Passage header bar showing the current verse reference, pin toggle, and Aa settings button.
 * Shared between CommentaryPane and CommentarySinglePanel.
 */
const CommentaryPassageHeader: React.FC<CommentaryPassageHeaderProps> = ({
  currentVerseId,
  pinned,
  onTogglePin,
}) => {
  const { t } = useI18n();
  return (
    <div
      className="flex items-center justify-between flex-shrink-0"
      style={{
        padding: '4px 12px',
        background: pinned
          ? 'color-mix(in srgb, var(--theme-accent-primary) 8%, var(--theme-bg-secondary))'
          : 'var(--theme-bg-secondary)',
        borderBottom: `1px solid ${pinned ? 'var(--theme-accent-primary)' : 'var(--theme-border-primary)'}`,
      }}
    >
      {/* Left: passage label + pin */}
      <div className="flex items-center gap-0.5">
        {currentVerseId && (
          <span
            className="font-semibold text-text-primary cursor-pointer hover:text-accent transition-colors"
            style={{ fontSize: '13px' }}
            onClick={() => {
              useBibleStore.getState().navigateToVerseInPrimary(currentVerseId); // allow-getstate: event handler - imperative navigation, no subscription needed
            }}
            title={t('ui.commentaryPassageHeader.goToVerse')}
            data-testid="commentary-verse-ref"
          >
            {formatVerseReference(currentVerseId)}
          </span>
        )}
        <PinButton
          pinned={pinned}
          onToggle={onTogglePin}
          title={pinned ? 'Unpin to sync with Bible pane' : 'Pin commentary to current passage'}
        />
      </div>

      {/* Right: Aa settings button */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('open-preferences-fonts', { detail: 'commentary' }))}
        className="text-text-secondary hover:text-text-primary hover:bg-background-hover transition-colors font-semibold rounded"
        style={{ padding: '2px 8px', border: '1px solid var(--theme-border-primary)', fontSize: '13px' }}
        title={t('ui.commentaryPassageHeader.textSettings')}
      >
        Aa
      </button>
    </div>
  );
};

export default CommentaryPassageHeader;
