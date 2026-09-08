import React from 'react';
import { formatVerseReference } from '../../utils/verseReference';
import { useI18n } from '../../contexts/useI18n';

interface CommentaryPinnedBannerProps {
  pinnedVerseId: number;
  onSyncToCurrent: () => void;
}

/**
 * Banner shown when commentary is pinned to a specific verse and the Bible
 * has navigated away. Offers a "Sync to current verse" button.
 */
const CommentaryPinnedBanner: React.FC<CommentaryPinnedBannerProps> = ({ pinnedVerseId, onSyncToCurrent }) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between px-3 py-1 bg-warning-soft border-b border-warning-border text-xs">
      <span className="text-warning-text">
        {t('commentaryPane.pinnedTo', { reference: formatVerseReference(pinnedVerseId), })}
      </span>
      <button
        onClick={onSyncToCurrent}
        className="px-2 py-0.5 text-warning-text hover:bg-warning-soft rounded transition-colors"
      >
        {t('commentaryPane.syncToCurrentVerse')}
      </button>
    </div>
  );
};

export default CommentaryPinnedBanner;
