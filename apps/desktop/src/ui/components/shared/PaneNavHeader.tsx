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
 *
 * The Back/Forward/Home buttons render `.control-nav-button` from
 * `styles/controls.css` rather than inline styles - that stylesheet is also
 * served to extension panels at `ext-ui://host/controls.css`, so an extension
 * that needs its own "back" affordance can match this one instead of
 * inventing a fourth shape for it. `:disabled` there carries the same
 * dimmed-color/not-allowed treatment `buttonStyle` used to compute by hand.
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
        className="control-nav-button"
        data-testid="pane-nav-back"
        onClick={onBack}
        disabled={!canGoBack}
        title={t('ui.paneNav.goBack')}
      >
        &lt;
      </button>
      <button
        className="control-nav-button"
        data-testid="pane-nav-forward"
        onClick={onForward}
        disabled={!canGoForward}
        title={t('ui.paneNav.goForward')}
      >
        &gt;
      </button>
      {onHome && (
        <button
          className="control-nav-button"
          data-testid="pane-nav-home"
          onClick={onHome}
          disabled={!canGoHome}
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
