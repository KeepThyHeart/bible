import React from 'react';
import { useI18n } from '../../contexts/useI18n';

interface NotesErrorBannerProps {
  message: string;
  onRetry?: () => void;
  onSaveAs?: () => void;
  onExport?: () => void;
  onDismiss?: () => void;
}

/**
 * The action buttons sit on the danger fill, so their translucent wash is drawn
 * from `text-on-accent` (the token that is already legible against a coloured
 * fill) rather than a hard-coded white, which only worked in the light theme.
 */
const actionButtonClass =
  'px-2 py-1 text-xs rounded bg-text-on-accent/20 hover:bg-text-on-accent/30 transition-colors';

const NotesErrorBanner: React.FC<NotesErrorBannerProps> = ({
  message,
  onRetry,
  onSaveAs,
  onExport,
  onDismiss,
}) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-danger text-text-on-accent text-sm" role="alert">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="flex-1">{message}</span>
      <div className="flex items-center gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className={actionButtonClass}>
            {t('notesErrorBanner.retryButton')}
          </button>
        )}
        {onSaveAs && (
          <button type="button" onClick={onSaveAs} className={actionButtonClass}>
            {t('notesErrorBanner.saveAsButton')}
          </button>
        )}
        {onExport && (
          <button type="button" onClick={onExport} className={actionButtonClass}>
            {t('notesErrorBanner.exportButton')}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 rounded hover:bg-text-on-accent/20 transition-colors"
            title={t('notesErrorBanner.dismissTitle')}
            aria-label={t('notesErrorBanner.dismissTitle')}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};

export default NotesErrorBanner;
