import { useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { presentStore } from '../../../stores/presentStore';
import { goLive } from '../presenterSink';
import { usePresenter } from '../../../components/Present/usePresenter';

/**
 * The short status row at the top of Control: Not live / Live, how many devices
 * have joined, Go live / End, and the hamburger. Ending asks first, because it
 * ends the screen for everyone.
 */
export function StatusRow(props: { menuOpen: boolean; onToggleMenu: () => void }) {
  const { t } = useTranslation();
  const view = usePresenter();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const live = view.presenting;
  const connected = view.connection === 'live';

  return (
    <div class="pz-status">
      <span class={`pz-status__state ${live ? 'pz-status__state--live' : ''}`}>
        {live ? <><span class="pz-status__dot" aria-hidden="true" />{t('present.app.live')}</> : t('present.app.notLive')}
      </span>

      {live && (
        <span
          class={`pz-status__viewers ${connected ? '' : 'pz-status__viewers--offline'}`}
          title={connected ? t('present.viewersTooltip') : t('present.reconnecting')}
        >
          <i class="fa-solid fa-tv" aria-hidden="true" />
          {view.viewers}
        </span>
      )}

      <span class="pz-status__spacer" />

      {!live && (
        <button
          type="button"
          class="pz-btn pz-btn--primary"
          disabled={view.busy}
          onClick={() => void goLive()}
        >
          {t('present.control.goLive')}
        </button>
      )}
      {live && !confirmEnd && (
        <button type="button" class="pz-btn" onClick={() => setConfirmEnd(true)}>
          {t('present.control.endLive')}
        </button>
      )}
      {live && confirmEnd && (
        <span class="pz-status__confirm">
          <span>{t('present.endConfirm')}</span>
          <button type="button" class="pz-btn pz-btn--danger" onClick={() => { setConfirmEnd(false); void presentStore.end(); }}>
            {t('present.endYes')}
          </button>
          <button type="button" class="pz-btn" onClick={() => setConfirmEnd(false)}>
            {t('common.cancel')}
          </button>
        </span>
      )}

      <button
        type="button"
        class={`pz-btn pz-btn--icon ${props.menuOpen ? 'pz-btn--on' : ''}`}
        data-control-menu-toggle
        onClick={props.onToggleMenu}
        aria-haspopup="menu"
        aria-expanded={props.menuOpen}
        title={t('present.control.moreTooltip')}
        aria-label={t('present.control.moreTooltip')}
      >
        <i class="fa-solid fa-ellipsis" aria-hidden="true" />
      </button>
    </div>
  );
}
