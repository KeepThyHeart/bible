import React, { useState, useEffect } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useBibleStore } from '../../stores/useBibleStore';
import { formatVerseReference } from '../../utils/verseReference';

interface CommentaryVersePreviewProps {
  verseId: number;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  isLoading: boolean;
}

/**
 * Shows the current verse text at the top of the commentary content area
 * with prev/next navigation buttons.
 * Shared between CommentaryPane and CommentarySinglePanel.
 */
const CommentaryVersePreview: React.FC<CommentaryVersePreviewProps> = ({ verseId, onNavigatePrev, onNavigateNext, isLoading }) => {
  const { t } = useI18n();
  const [verseText, setVerseText] = useState('');

  // Use useBibleStore directly to get the first (primary) Bible panel's data,
  // since the actual dockview panel ID differs from DEFAULT_PANEL_ID.
  const primaryBiblePanel = useBibleStore(s => {
    const first = s.panels.values().next().value;
    return first ?? null;
  });

  useEffect(() => {
    if (!primaryBiblePanel) { setVerseText(''); return; }
    const activeBibleTab = primaryBiblePanel.openTabs[primaryBiblePanel.activeTabIndex];
    if (activeBibleTab) {
      const verses = primaryBiblePanel.versesByTab.get(activeBibleTab.tabId) || [];
      const verse = verses.find(v => v.verse_id === verseId);
      if (verse) {
        setVerseText((verse.text_html || verse.text).replace(/<[^>]*>/g, ''));
        return;
      }
    }
    setVerseText('');
  }, [verseId, primaryBiblePanel]);

  const verseRef = formatVerseReference(verseId);

  return (
    <div
      className="flex items-start gap-1 border-b border-border flex-shrink-0"
      style={{ padding: '8px', background: 'var(--theme-bg-secondary)' }}
    >
      <button
        onClick={onNavigatePrev}
        disabled={isLoading}
        className="flex items-center justify-center rounded hover:bg-background-active disabled:opacity-30 flex-shrink-0"
        style={{ padding: '4px 6px', minWidth: '28px', minHeight: '28px' }}
        title={t('commentaryVersePreview.previousTitle')}
      >
        <svg className="w-3 h-3 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <div
        className="flex-1 min-w-0 text-xs text-text-secondary cursor-pointer rounded hover:bg-background-hover"
        style={{ lineHeight: 1.4, padding: '2px 4px', overflow: 'hidden', maxHeight: 'calc(1.4em * 3)' }}
        onClick={() => {
          useBibleStore.getState().navigateToVerseInPrimary(verseId); // allow-getstate: event handler - imperative navigation, no subscription needed
        }}
        title={t('commentaryVersePreview.goToVerseTitle')}
      >
        <span className="font-semibold whitespace-nowrap me-1.5 bidi-isolate" style={{ color: 'var(--theme-accent-primary)' }}>{verseRef}</span>
        {verseText && <span>{verseText}</span>}
      </div>
      <button
        onClick={onNavigateNext}
        disabled={isLoading}
        className="flex items-center justify-center rounded hover:bg-background-active disabled:opacity-30 flex-shrink-0"
        style={{ padding: '4px 6px', minWidth: '28px', minHeight: '28px' }}
        title={t('commentaryVersePreview.nextTitle')}
      >
        <svg className="w-3 h-3 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
};

export default CommentaryVersePreview;
export type { CommentaryVersePreviewProps };
