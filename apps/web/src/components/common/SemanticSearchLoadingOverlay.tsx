import { useStore } from '../../hooks/useStore';
import { searchStore } from '../../stores/searchStore';
import { useTranslation } from 'react-i18next';

/** Step number + label for each init stage. */
const STAGE_INFO: Record<string, { step: number; label: string }> = {
  metadata: { step: 1, label: 'Downloading search data…' },
  vectors: { step: 2, label: 'Downloading search data…' },
  model: { step: 3, label: 'Loading the search engine…' },
};

function fmtMB(bytes?: number): string {
  if (!bytes) return '';
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Non-blocking popup shown during the one-time browser semantic-search setup
 * (model + index download). Displays the current step, a progress bar (real
 * percentage when known, indeterminate otherwise), and byte counts.
 */
export function SemanticSearchLoadingOverlay() {
  const { t } = useTranslation();
  const init = useStore(searchStore, () => searchStore.semanticInit);
  const dismissed = useStore(searchStore, () => searchStore.semanticInitDismissed);

  const visible = (init.status === 'initializing' || init.status === 'error') && !dismissed;
  if (!visible) return null;

  const isError = init.status === 'error';
  const info = STAGE_INFO[init.stage] ?? { step: 1, label: 'Preparing…' };
  const pct = typeof init.percent === 'number' ? Math.max(0, Math.min(1, init.percent)) : null;

  return (
    <div class="semantic-loading" role="status" aria-live="polite">
      <button
        class="semantic-loading__close"
        onClick={() => searchStore.dismissSemanticInit()}
        aria-label={t('semanticSearchLoadingOverlay.dismiss')}
      >
        <i class="fa-solid fa-xmark" />
      </button>

      {isError ? (
        <>
          <div class="semantic-loading__title">
            <i class="fa-solid fa-triangle-exclamation" style={{ color: '#c53030', marginRight: '8px' }} />
            Ideas Search unavailable
          </div>
          <div class="semantic-loading__detail">
            {init.detail || 'Failed to load Ideas Search. Please try again later.'}
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
                ? `${fmtMB(init.loaded)} / ${fmtMB(init.total)}`
                : fmtMB(init.loaded)}
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
