import React, { useState, useEffect } from 'react';
import { getNotesForVerse, SerializedNote } from '../services/notesAPI';
import { useI18n } from '../contexts/useI18n';
import { usePopupPosition } from '../hooks/usePopupPosition';

/** Fixed popup width, matching the previous hand-rolled positioning. */
const TOOLTIP_WIDTH = 320;
/**
 * First-paint height estimate used for synchronous placement (see
 * `usePopupPosition`). The note list itself is capped at `max-h-48` (192px,
 * scrolling beyond that), plus the outer `p-3` padding (~24px) and the
 * "click to view" footer with its top border/margin (~30px) - so ~246px is
 * a safe upper bound for the common case of one or more short notes. The
 * loading/empty states are much shorter than this; the hook's post-mount
 * refinement (`usePopupPosition`) shrinks the popup for those without a
 * visible flash, since it measures and corrects inside `useLayoutEffect`
 * (before the browser paints) rather than after.
 */
const ESTIMATED_HEIGHT = 246;

interface NotePreviewTooltipProps {
  /** The verse ID to show notes for */
  verseId: number;
  /** Position to show the tooltip */
  position: { x: number; y: number };
  /** Callback when tooltip should be closed */
  onClose: () => void;
  /** Callback to cancel any pending close timeout */
  onMouseEnter?: () => void;
  /** Callback to navigate to notes pane */
  onViewNote?: (verseId: number) => void;
}

/**
 * Tooltip component that shows a note preview on hover
 */
const NotePreviewTooltip: React.FC<NotePreviewTooltipProps> = ({
  verseId,
  position,
  onClose,
  onMouseEnter,
  onViewNote
}) => {
  const { t } = useI18n();
  const [notes, setNotes] = useState<SerializedNote[]>([]);
  const [loading, setLoading] = useState(true);
  const { ref: tooltipRef, style: popupStyle } = usePopupPosition(position, {
    width: TOOLTIP_WIDTH,
    estimatedHeight: ESTIMATED_HEIGHT,
  });

  // Fetch notes on mount
  useEffect(() => {
    const fetchNotes = async () => {
      try {
        setLoading(true);
        const verseNotes = await getNotesForVerse(verseId);
        setNotes(verseNotes);
      } catch (err) {
        console.error('Error fetching notes preview:', err);
        setNotes([]);
      } finally {
        setLoading(false);
      }
    };

    fetchNotes();
  }, [verseId]);

  // Get excerpt from HTML content
  const getExcerpt = (html: string, maxLength: number = 150): string => {
    const text = html.replace(/<[^>]*>/g, '');
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  return (
    <div
      ref={tooltipRef}
      data-testid="note-preview-tooltip"
      className="z-50 bg-surface-elevated border border-border-secondary rounded-lg shadow-xl p-3"
      style={popupStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onClose}
    >
      {/* Content */}
      {loading ? (
        <div className="text-text-secondary text-sm">{t('notePreviewTooltip.loading')}</div>
      ) : notes.length === 0 ? (
        <div className="text-text-secondary text-sm">{t('notePreviewTooltip.noNotesFound')}</div>
      ) : (
        <div className="text-sm space-y-2 max-h-48 overflow-y-auto">
          {notes.slice(0, 3).map((note) => (
            <div
              key={note.noteId}
              className="p-2 bg-surface-secondary rounded cursor-pointer hover:bg-background-hover"
              onClick={() => onViewNote?.(verseId)}
            >
              {note.title && (
                <div className="font-medium text-text-primary mb-1">{note.title}</div>
              )}
              <div className="text-text-secondary text-xs">
                {getExcerpt(note.content || '')}
              </div>
            </div>
          ))}
          {notes.length > 3 && (
            <div className="text-xs text-text-muted text-center">
              +{notes.length - 3} more note{notes.length - 3 > 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="text-xs text-text-muted mt-2 pt-2 border-t border-border">
        {t('notePreviewTooltip.clickToView')}
      </div>
    </div>
  );
};

export default NotePreviewTooltip;
