import React from 'react';
import { useI18n } from '../../contexts/useI18n';
import { PinButton } from './icons/PinIcon';

interface PaneNavHeaderProps {
  canGoBack: boolean;
  canGoForward: boolean;
  pinned: boolean;
  onBack: () => void;
  onForward: () => void;
  onTogglePin: () => void;
  /**
   * Return to what the pane shows for the verse currently being read.
   *
   * Optional because not every pane using this header has a "home" to return
   * to. Where it does, the alternative was pressing Back until the right
   * entry happened to resurface - the Topics pane had no other way back to
   * "topics for this verse" once the reader had drilled into a subject.
   */
  onHome?: () => void;
  /** False when nothing is known to go home *to* (no verse yet). */
  canGoHome?: boolean;
}

/**
 * Shared navigation header with Back, Forward, Home, and Pin controls.
 * Used in Study Pane and Topics Pane headers.
 */
const PaneNavHeader: React.FC<PaneNavHeaderProps> = ({
  canGoBack,
  canGoForward,
  pinned,
  onBack,
  onForward,
  onTogglePin,
  onHome,
  canGoHome = true,
}) => {
  const { t } = useI18n();
  const buttonStyle = (enabled: boolean): React.CSSProperties => ({
    padding: '4px 8px',
    fontSize: '13px',
    border: 'none',
    backgroundColor: 'transparent',
    color: enabled ? 'var(--theme-text-primary)' : 'var(--theme-text-secondary)',
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.4,
    borderRadius: '4px',
  });

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      padding: '4px 8px',
      borderBottom: '1px solid var(--theme-border-primary)',
      flexShrink: 0,
    }}>
      <button
        data-testid="pane-nav-back"
        onClick={onBack}
        disabled={!canGoBack}
        style={buttonStyle(canGoBack)}
        title={t('ui.paneNav.goBack')}
      >
        &lt;
      </button>
      <button
        data-testid="pane-nav-forward"
        onClick={onForward}
        disabled={!canGoForward}
        style={buttonStyle(canGoForward)}
        title={t('ui.paneNav.goForward')}
      >
        &gt;
      </button>
      {onHome && (
        <button
          data-testid="pane-nav-home"
          onClick={onHome}
          disabled={!canGoHome}
          style={buttonStyle(canGoHome)}
          title={t('ui.paneNav.goHome')}
          aria-label={t('ui.paneNav.goHome')}
        >
          {/* A house, drawn inline like the rest of this app's icons. */}
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            style={{ display: 'block' }}
          >
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
        </button>
      )}
      <div style={{ flex: 1 }} />
      <PinButton
        pinned={pinned}
        onToggle={onTogglePin}
        title={pinned ? t('ui.paneNav.unpinTitle') : t('ui.paneNav.pinTitle')}
        label={pinned ? t('ui.paneNav.pinned') : t('ui.paneNav.pin')}
      />
    </div>
  );
};

export default PaneNavHeader;
