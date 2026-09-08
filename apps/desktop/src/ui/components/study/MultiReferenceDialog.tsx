import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { truncateText } from '../../utils/verseFormatting';
import { useEscapeKey } from '../../hooks/useOverlayDismissal';

/**
 * Types of reference entries that can be displayed in the dialog
 */
export type ReferenceEntry =
  | CommentaryMentionEntry
  | BookSectionEntry
  | CrossReferenceEntry;

export interface CommentaryMentionEntry {
  type: 'commentary_mention';
  /** Module ID of the commentary that produced this mention. Used by the navigate-to-commentary handler. */
  moduleId: number;
  entryId: number;
  verseIdStart: number;
  verseReference: string;
  context?: string;
}

export interface BookSectionEntry {
  type: 'book_section';
  /** Module ID of the book that produced this section. Used by the navigate-to-book handler. */
  moduleId: number;
  sectionId: number;
  sectionTitle: string;
  context?: string;
  referenceId: number;
}

export interface CrossReferenceEntry {
  type: 'cross_reference';
  /** Module ID of the cross-reference module that produced this entry. Forwarded for tooltip/diagnostic use. */
  moduleId: number;
  xrefId: number;
  toVerseId: number;
  verseReference: string;
  relationshipType?: string;
  notes?: string;
}

export interface MultiReferenceDialogProps {
  isOpen: boolean;
  title: string;
  references: ReferenceEntry[];
  onClose: () => void;
  onSelect: (entry: ReferenceEntry) => void;
}

/**
 * Dialog for displaying multiple verse references
 * Used when a link has multiple occurrences (e.g., "Wesley x15")
 */
const MultiReferenceDialog: React.FC<MultiReferenceDialogProps> = ({
  isOpen,
  title,
  references,
  onClose,
  onSelect
}) => {
  const { t } = useI18n();
  // Escape is the generic Cancel; this dialog had only its backdrop and the x.
  useEscapeKey(isOpen, onClose);
  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const getPrimaryText = (ref: ReferenceEntry): string => {
    switch (ref.type) {
      case 'commentary_mention':
        return ref.verseReference;
      case 'book_section':
        return ref.sectionTitle;
      case 'cross_reference':
        return ref.verseReference + (ref.relationshipType ? ` (${ref.relationshipType})` : '');
    }
  };

  const getSecondaryText = (ref: ReferenceEntry): string | undefined => {
    switch (ref.type) {
      case 'commentary_mention':
        return ref.context ? truncateText(ref.context, 150) : undefined;
      case 'book_section':
        return ref.context ? truncateText(ref.context, 150) : undefined;
      case 'cross_reference':
        return ref.notes;
    }
  };

  return (
    <div
      className="fixed inset-0 bg-background-overlay flex items-center justify-center z-50"
      onClick={handleBackdropClick}
    >
      <div className="bg-surface rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-xl font-semibold text-text-heading">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors"
            aria-label={t('multiReferenceDialog.closeLabel')}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {references.length === 0 ? (
            <p className="text-text-secondary text-center py-8">{t('multiReferenceDialog.noReferences')}</p>
          ) : (
            <div className="space-y-2">
              {references.map((ref, idx) => {
                const primaryText = getPrimaryText(ref);
                const secondaryText = getSecondaryText(ref);

                return (
                  <button
                    key={idx}
                    onClick={() => {
                      onSelect(ref);
                      onClose();
                    }}
                    className="w-full text-start px-4 py-3 rounded-lg border border-border hover:border-accent hover:bg-accent-light transition-colors"
                  >
                    <div className="font-medium text-text-heading mb-1">{primaryText}</div>
                    {secondaryText && (
                      <div className="text-sm text-text-secondary">{secondaryText}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-background-tertiary hover:bg-background-active text-text-primary rounded-lg transition-colors"
          >
            {t('multiReferenceDialog.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MultiReferenceDialog;
