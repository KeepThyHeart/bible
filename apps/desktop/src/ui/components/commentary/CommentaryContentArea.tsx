import React from 'react';
import CommentaryEntryView from './CommentaryEntryView';
import CommentaryEmptyVerseGrid from './CommentaryEmptyVerseGrid';
import DigestDisclaimer from './DigestDisclaimer';
import { useModuleProvenance } from './useModuleProvenance';
import type { CommentaryEntry, CommentaryEntrySummary } from '../../stores/useCommentaryStore';
import { useI18n } from '../../contexts/useI18n';
import { useDeferredLoading } from '../../hooks/useDeferredLoading';
import PaneLoadingSkeleton from '../onboarding/PaneLoadingSkeleton';

interface CommentaryContentAreaProps {
  entries: CommentaryEntry[];
  moduleName: string;
  /**
   * Abbreviation of the module these entries came from. Drives the
   * machine-generated content notice - without it the notice cannot render,
   * so every call site must pass it.
   */
  moduleAbbreviation?: string;
  currentVerseId: number | null;
  isLoading: boolean;
  error: string | null;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  onBrowseAll?: () => void;
  /**
   * All entry summaries for this commentary - used to render the empty-verse
   * fallback grid so the user can jump to a verse in the current chapter that
   * DOES have an entry. When absent or empty the grid is skipped.
   */
  entrySummaries?: CommentaryEntrySummary[];
  /**
   * Called when a verse number in the empty-verse fallback grid is clicked.
   */
  onSelectVerse?: (verseId: number) => void;
}

/**
 * Renders commentary entry content with loading/error/empty states
 * and prev/next navigation at the bottom.
 * Shared between CommentaryPane and CommentarySinglePanel.
 */
const CommentaryContentArea: React.FC<CommentaryContentAreaProps> = ({
  entries,
  moduleName,
  moduleAbbreviation,
  currentVerseId,
  isLoading,
  error,
  onNavigatePrev,
  onNavigateNext,
  onBrowseAll,
  entrySummaries,
  onSelectVerse,
}) => {
  const { t } = useI18n();
  const provenanceKind = useModuleProvenance(moduleAbbreviation);
  // Brief entry fetches (cache hit, fast query) shouldn't flicker a loading
  // UI in at all - only fetches still running past 80ms show it.
  const deferredIsLoading = useDeferredLoading(isLoading);
  if (deferredIsLoading && entries.length === 0) {
    // Covers both an ordinary in-flight fetch (verse navigation with nothing
    // cached yet) and the startup session-restore gap, where openTabs is
    // published synchronously but entries/loadingByTab for the tab haven't
    // resolved yet (see sessionSlice.restoreFromSession). Reuses the same
    // skeleton CommentaryPane shows while openTabs itself is still empty, so
    // restore never flashes the "no commentary" empty state in between.
    // useDeferredLoading already debounces this by 80ms, so a fast cache-hit
    // load never shows it at all.
    return <PaneLoadingSkeleton testId="commentary-loading-skeleton" />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-danger">{error}</div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary px-md">
        <p className="mb-md">{t('commentaryContentArea.noCommentary')}</p>
        <div className="flex gap-sm">
          <button
            onClick={onNavigatePrev}
            className="px-md py-sm bg-control text-text-primary rounded hover:bg-control-hover"
          >
            <span className="rtl-mirror">{'\u25C0'}</span> {t('commentaryContentArea.previous')}
          </button>
          <button
            onClick={onNavigateNext}
            className="px-md py-sm bg-control text-text-primary rounded hover:bg-control-hover"
          >
            {t('commentaryContentArea.next')} <span className="rtl-mirror">{'\u25B6'}</span>
          </button>
          {onBrowseAll && (
            <button
              onClick={onBrowseAll}
              className="px-md py-sm bg-accent text-text-on-accent rounded hover:bg-accent-hover"
            >
              {t('commentaryContentArea.browseAll')}
            </button>
          )}
        </div>
        {currentVerseId && entrySummaries && entrySummaries.length > 0 && onSelectVerse && (
          <div className="max-w-md w-full">
            <CommentaryEmptyVerseGrid
              summaries={entrySummaries}
              currentVerseId={currentVerseId}
              onSelectVerse={onSelectVerse}
            />
          </div>
        )}
      </div>
    );
  }

  const contextBookNumber = currentVerseId ? Math.floor(currentVerseId / 1000000) : undefined;

  // Screen readers reach the notice before the text it qualifies: it is first
  // in DOM order, and the entry list points back at it with aria-describedby.
  const disclaimerId = moduleAbbreviation && provenanceKind
    ? `commentary-disclaimer-${moduleAbbreviation}`
    : undefined;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="px-xl py-md">
        {/* Machine-generated content notice - renders nothing for human-authored modules */}
        <DigestDisclaimer
          moduleAbbreviation={moduleAbbreviation}
          id={disclaimerId}
          className="mb-md"
        />
        {/* Module info */}
        <div className="flex items-center gap-2 mb-md text-xs text-text-muted">
          <span>{moduleName}</span>
          {entries.length > 1 && (
            <span>· {entries.length} entries</span>
          )}
          {entries.length > 0 && entries[0].entry_level !== 'verse' && (
            <span>· {entries[0].entry_level.charAt(0).toUpperCase() + entries[0].entry_level.slice(1)} level</span>
          )}
        </div>
        <div aria-describedby={disclaimerId}>
        {entries.map((entry, index) => (
          <CommentaryEntryView
            key={entry.entry_id || index}
            entry={entry}
            showDivider={index < entries.length - 1}
            contextBookNumber={contextBookNumber}
            showLevelBadge={entries.length > 1}
          />
        ))}
        </div>
      </div>

      {/* Prev/Next navigation after content */}
      <div className="flex items-center justify-between px-xl py-md border-t border-border">
        <button
          onClick={onNavigatePrev}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-md py-sm text-sm text-text-secondary hover:text-text-primary hover:bg-background-hover rounded transition-colors disabled:opacity-30"
        >
          <svg className="w-4 h-4 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('commentaryContentArea.previousVerse')}
        </button>
        <button
          onClick={onNavigateNext}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-md py-sm text-sm text-text-secondary hover:text-text-primary hover:bg-background-hover rounded transition-colors disabled:opacity-30"
        >
          {t('commentaryContentArea.nextVerse')}
          <svg className="w-4 h-4 rtl-mirror" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default CommentaryContentArea;
