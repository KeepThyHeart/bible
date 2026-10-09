import { useTranslation } from 'react-i18next';
import { presenterIsLive, presenterSend, presenterToggleBlank, usePresenterState } from '../presenterSink';
import { stepWall } from '../../study/usePresenterShortcuts';

/**
 * Three icon buttons: previous, show/hide (blank), next. Previous and next step
 * by verse or slide, exactly as the clicker keys do.
 */
export function Transport() {
  const { t } = useTranslation();
  const state = usePresenterState();
  const blanked = state?.display.blanked ?? false;
  const canStep = Boolean(state?.live);
  // Live, stepping also moves the Bible pane and is throttled; before going live it is the local session.
  const step = (direction: 'next' | 'previous'): void => {
    if (presenterIsLive()) stepWall(direction);
    else presenterSend({ type: direction });
  };

  return (
    <div class="pz-transport" role="group" aria-label={t('present.control.transport')}>
      <button
        type="button"
        class="pz-transport__btn"
        disabled={!canStep}
        onClick={() => step('previous')}
        title={t('present.previous')}
        aria-label={t('present.previous')}
      >
        <i class="fa-solid fa-chevron-left" aria-hidden="true" />
      </button>
      <button
        type="button"
        class={`pz-transport__btn pz-transport__btn--blank ${blanked ? 'pz-transport__btn--on' : ''}`}
        onClick={presenterToggleBlank}
        title={blanked ? t('present.unblank') : t('present.blank')}
        aria-label={blanked ? t('present.unblank') : t('present.blank')}
        aria-pressed={blanked}
      >
        <i class={`fa-solid ${blanked ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" />
      </button>
      <button
        type="button"
        class="pz-transport__btn"
        disabled={!canStep}
        onClick={() => step('next')}
        title={t('present.next')}
        aria-label={t('present.next')}
      >
        <i class="fa-solid fa-chevron-right" aria-hidden="true" />
      </button>
    </div>
  );
}
