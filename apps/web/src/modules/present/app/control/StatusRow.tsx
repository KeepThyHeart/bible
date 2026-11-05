import { useEffect, useRef, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { presentStore } from '../../stores/presentStore';
import { goLive } from '../presenterSink';
import { usePresenter } from '../../study/usePresenter';
import { useStore } from '../../../../hooks/useStore';
import { offlineStore } from '../../../../stores/offlineStore';

/**
 * The short status row at the top of Control: Not live / Live, how many devices
 * have joined, Go live / End, and the hamburger. Ending asks first, because it
 * ends the screen for everyone.
 */
export function StatusRow(props: { menuOpen: boolean; onToggleMenu: () => void }) {
  const { t } = useTranslation();
  const view = usePresenter();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const session = useStore(presentStore, () => presentStore.session);
  const live = view.presenting;

  // Go live / End / End it replace each other, so the focused button disappears.
  // Remember where focus should go next and move it once that control has rendered.
  const goLiveRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wanted = useRef<{ target: 'goLive' | 'end' | 'cancel'; until: number } | null>(null);
  const want = (target: 'goLive' | 'end' | 'cancel'): void => { wanted.current = { target, until: Date.now() + 8000 }; };
  useEffect(() => {
    const w = wanted.current;
    if (!w) return;
    if (Date.now() > w.until) { wanted.current = null; return; }
    const el = w.target === 'goLive' ? goLiveRef.current : w.target === 'end' ? endRef.current : cancelRef.current;
    if (el) { wanted.current = null; el.focus(); }
  });
  // The stream can take a while to notice a dropped network; the browser knows at once.
  const online = useStore(offlineStore, () => offlineStore.isOnline);
  const connected = view.connection === 'live' && online;

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
          <span class="sr-only">{t('present.viewersLabel', { defaultValue: 'Viewers' })}: </span>
          {view.wall ? view.viewers : '…'}
        </span>
      )}

      {live && session?.joinCode && (
        <span class="pz-status__code" title={t('present.control.joinCodeTip')}>
          {t('present.control.joinCodeLabel')} <strong>{session.joinCode}</strong>
        </span>
      )}

      <span class="pz-status__spacer" />

      {!live && (
        <button
          type="button"
          class="pz-btn pz-btn--primary"
          ref={goLiveRef}
          disabled={view.busy}
          onClick={() => { want('end'); void goLive(); }}
        >
          {t('present.control.goLive')}
        </button>
      )}
      {live && !confirmEnd && (
        <button type="button" class="pz-btn" ref={endRef} title={t('present.liveNote')} onClick={() => { want('cancel'); setConfirmEnd(true); }}>
          {t('present.control.endLive')}
        </button>
      )}
      {live && confirmEnd && (
        <span class="pz-status__confirm">
          <span title={t('present.liveNote')}>{t('present.endConfirm')}</span>
          <button type="button" class="pz-btn pz-btn--danger" onClick={() => { want('goLive'); setConfirmEnd(false); void presentStore.end(); }}>
            {t('present.endYes')}
          </button>
          <button type="button" class="pz-btn" ref={cancelRef} onClick={() => { want('end'); setConfirmEnd(false); }}>
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
