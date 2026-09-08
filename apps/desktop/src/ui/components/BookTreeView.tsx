import React, { useState } from 'react';
import { BookSectionSummary } from '../stores/useBookStore';
import { useI18n } from '../contexts/useI18n';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { PaneOverlay } from './shared/PaneOverlay';
import BookSectionTree from './BookPane/BookSectionTree';

interface BookTreeViewProps {
  abbreviation: string;
  summaries: BookSectionSummary[];
  currentSectionId: number | null;
  onSelectSection: (sectionId: number) => void;
  onClose: () => void;
  /**
   * The dialog owns its own loading/empty/error states so that opening it can
   * be what *starts* the summaries fetch. Gating the dialog on summaries
   * already being present made the "Contents" button a no-op on first click,
   * and a permanent no-op whenever the query failed.
   */
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

const BookTreeView: React.FC<BookTreeViewProps> = ({
  abbreviation,
  summaries,
  currentSectionId,
  onSelectSection,
  onClose,
  isLoading = false,
  error = null,
  onRetry
}) => {
  const { t } = useI18n();
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  /** Expand-all is a footer action, so it lives here rather than in the tree. */
  const [expandAll, setExpandAll] = useState<ReadonlySet<number> | undefined>(undefined);

  const closeLabel = t('ui.bookTreeView.close');

  return (
    <PaneOverlay onDismiss={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="book-tree-title"
        className="bg-surface rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {/* Header */}
        <div className="px-xl py-lg border-b border-border flex items-center justify-between">
          <div>
            <h2 id="book-tree-title" className="text-2xl font-semibold text-text-heading">{t('ui.bookTreeView.tableOfContents')}</h2>
            <p className="text-sm text-text-secondary mt-xs">
              {t('ui.bookTreeView.sectionCount', { abbreviation, count: summaries.length, })}
            </p>
          </div>
          <button
            type="button"
            className="text-text-secondary hover:text-text-primary transition-colors"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {/* Tree View */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-text-secondary" data-testid="book-tree-loading">
              {t('ui.bookTreeView.loading')}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-sm h-full" data-testid="book-tree-error">
              <div className="text-danger">{t('ui.bookTreeView.loadFailed')}</div>
              <div className="text-xs text-text-secondary">{error}</div>
              {onRetry && (
                <button
                  type="button"
                  className="px-lg py-sm bg-control text-text-primary rounded hover:bg-control-hover"
                  onClick={onRetry}
                >
                  {t('ui.bookTreeView.retry')}
                </button>
              )}
            </div>
          ) : summaries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-secondary">
              {t('ui.bookTreeView.noSections')}
            </div>
          ) : (
            <BookSectionTree
              summaries={summaries}
              currentSectionId={currentSectionId}
              onSelectSection={onSelectSection}
              forceExpanded={expandAll}
            />
          )}
        </div>

        {/* Footer */}
        <div className="px-xl py-md border-t border-border flex justify-between items-center">
          <button
            type="button"
            className="text-sm text-accent hover:underline"
            onClick={() => setExpandAll(new Set(summaries.map(s => s.section_id)))}
          >
            {t('ui.bookTreeView.expandAll')}
          </button>
          <button
            type="button"
            className="text-sm text-accent hover:underline"
            onClick={() => setExpandAll(undefined)}
          >
            {t('ui.bookTreeView.collapseAll')}
          </button>
          <button
            type="button"
            className="px-lg py-sm bg-control text-text-primary rounded hover:bg-control-hover"
            onClick={onClose}
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </PaneOverlay>
  );
};

export default BookTreeView;
