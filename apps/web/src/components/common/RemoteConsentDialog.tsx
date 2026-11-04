import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../hooks/useStore';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useModalFocus } from '../../hooks/useModalFocus';
import { remoteConsentStore } from '../../search/remote/consentStore';

/**
 * First-use notice for the online meaning search (task 0190). Opened by
 * `remoteConsentStore.request()` when a semantic search runs with no decision
 * yet; nothing has been sent at that point. Escape and the backdrop mean "Not now".
 */
export function RemoteConsentDialog() {
  const { t } = useTranslation();
  const open = useStore(remoteConsentStore, () => remoteConsentStore.dialogOpen);
  const via = useStore(remoteConsentStore, () => remoteConsentStore.via);
  const dialogRef = useRef<HTMLDivElement>(null);
  const declineRef = useRef<HTMLButtonElement>(null);

  useEscapeKey(open, () => remoteConsentStore.decline());

  // W-029/W-036: Tab stays inside the dialog and focus goes back to whatever opened it.
  useModalFocus(open, dialogRef);

  // Initial focus on "Not now", the option that does not consent: Enter or Space on
  // open must not grant by accident.
  useEffect(() => {
    if (open) declineRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      class="settings-panel-overlay remote-consent-overlay"
      // W-029: a click on the backdrop itself (not the dialog) means "Not now", as documented above.
      onClick={(e) => { if (e.target === e.currentTarget) remoteConsentStore.decline(); }}
    >
      <div
        ref={dialogRef}
        class="remote-consent"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-consent-title"
        aria-describedby="remote-consent-body"
        data-testid="remote-consent-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 class="remote-consent__title" id="remote-consent-title">
          <i class="fa-solid fa-cloud" style={{ marginInlineEnd: '8px', opacity: 0.5 }} />
          {t('remoteSemantic.consent.title')}
        </h3>
        <p class="remote-consent__body" id="remote-consent-body">
          {t('remoteSemantic.consent.body')}
          {via === 'browser' && <> {t('remoteSemantic.consent.ipNotice')}</>}
          {' '}{t('remoteSemantic.consent.neverSent')}
          {' '}<span data-testid="remote-consent-local">{t('remoteSemantic.consent.localOption')}</span>
        </p>
        <div class="remote-consent__actions">
          <button
            type="button"
            class="remote-consent__btn"
            ref={declineRef}
            data-testid="remote-consent-decline"
            onClick={() => remoteConsentStore.decline()}
          >
            {t('remoteSemantic.consent.decline')}
          </button>
          <button
            type="button"
            class="remote-consent__btn remote-consent__btn--primary"
            data-testid="remote-consent-agree"
            onClick={() => remoteConsentStore.grant()}
          >
            {t('remoteSemantic.consent.agree')}
          </button>
        </div>
      </div>
    </div>
  );
}
