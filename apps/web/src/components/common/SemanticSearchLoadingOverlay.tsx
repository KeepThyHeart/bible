import { useEffect, useState } from 'preact/hooks';
import { useStore } from '../../hooks/useStore';
import { searchStore } from '../../stores/searchStore';
import { useTranslation } from 'react-i18next';
import { useLocalizer } from '../../hooks/useLocalizer';
import type { Localizer } from '@bible/core/browser';

/** Step number + label for each init stage. */
const STAGE_INFO: Record<string, { step: number; label: string }> = {
  metadata: { step: 1, label: 'Downloading search data…' },
  vectors: { step: 2, label: 'Downloading search data…' },
  model: { step: 3, label: 'Loading the search engine…' },
};

function fmtMB(bytes: number | undefined, localizer: Localizer): string {
  if (!bytes) return '';
  return `${localizer.formatNumber(bytes / 1048576, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

/**
 * Non-blocking popup shown during the one-time browser semantic-search setup
 * (model + index download). Displays the current step, a progress bar (real
 * percentage when known, indeterminate otherwise), and byte counts.
 */
/** How long the "unavailable" toast stays up; the results panel keeps the message after it goes. */
export const UNAVAILABLE_TOAST_MS = 8000;

export function SemanticSearchLoadingOverlay() {
  const { t } = useTranslation();
  const localizer = useLocalizer();
  const init = useStore(searchStore, () => searchStore.semanticInit);
  const dismissed = useStore(searchStore, () => searchStore.semanticInitDismissed);

  const isError = init.status === 'error';
  // The error toast times out by itself (view-only: the store keeps the error, so the results
  // panel still explains an empty Ideas result). A new error shows it again.
  const [errorExpired, setErrorExpired] = useState(false);
  useEffect(() => {
    if (!isError) {
      setErrorExpired(false);
      return undefined;
    }
    const id = setTimeout(() => setErrorExpired(true), UNAVAILABLE_TOAST_MS);
    return () => clearTimeout(id);
  }, [isError]);

  const visible = (init.status === 'initializing' || isError) && !dismissed && !(isError && errorExpired);
  if (!visible) return null;

  if (isError && init.detail) console.warn('[ideas-search]', init.detail);
  const info = STAGE_INFO[init.stage] ?? { step: 1, label: 'Preparing…' };
  const pct = typeof init.percent === 'number' ? Math.max(0, Math.min(1, init.percent)) : null;

  return (
    <div
      class="semantic-loading"
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      // The error toast sits over the Next button and the result rows; only its own close
      // button takes the pointer, so the content underneath stays usable.
      style={isError ? { pointerEvents: 'none' } : undefined}
    >
      <button
        class="semantic-loading__close"
        style={isError ? { pointerEvents: 'auto' } : undefined}
        onClick={() => searchStore.dismissSemanticInit()}
        aria-label={t('semanticSearchLoadingOverlay.dismiss')}
      >
        <i class="fa-solid fa-xmark" />
      </button>

      {isError ? (
        <>
          <div class="semantic-loading__title">
            <i class="fa-solid fa-triangle-exclamation" style={{ color: '#c53030', marginInlineEnd: '8px' }} />
            {t('semanticSearchLoadingOverlay.unavailable')}
          </div>
        </>
      ) : (
        <>
          <div class="semantic-loading__title">
            <span class="semantic-loading__spinner" /> {t('semanticSearchLoadingOverlay.loading')}
          </div>
          <div class="semantic-loading__step">
            {t('semanticSearchLoadingOverlay.step', { step: info.step, label: info.label })}
          </div>

          <div class={`semantic-loading__bar${pct === null ? ' semantic-loading__bar--indeterminate' : ''}`}>
            <div
              class="semantic-loading__bar-fill"
              style={pct === null ? undefined : { width: `${Math.round(pct * 100)}%` }}
            />
          </div>

          <div class="semantic-loading__meta">
            <span>{pct !== null ? `${Math.round(pct * 100)}%` : ''}</span>
            <span>
              {init.total
                ? `${fmtMB(init.loaded, localizer)} / ${fmtMB(init.total, localizer)}`
                : fmtMB(init.loaded, localizer)}
            </span>
          </div>

          <div class="semantic-loading__note">
            One-time setup (~180&nbsp;MB). This can take a minute or two on the first search —
            it's cached for next time.
          </div>
        </>
      )}
    </div>
  );
}
