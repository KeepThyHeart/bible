import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../hooks/useStore';
import { useEscapeKey } from '../../hooks/useEscapeKey';
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
  const agreeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);

  useEscapeKey(open, () => remoteConsentStore.decline());

  // Focus the primary button on open; give focus back on close.
  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement;
    agreeRef.current?.focus();
    return () => {
      const el = previousFocus.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div class="settings-panel-overlay remote-consent-overlay" onClick={() => remoteConsentStore.decline()}>
      <div
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
        </p>
        <div class="remote-consent__actions">
          <button
            type="button"
            class="remote-consent__btn"
            data-testid="remote-consent-decline"
            onClick={() => remoteConsentStore.decline()}
          >
            {t('remoteSemantic.consent.decline')}
          </button>
          <button
            type="button"
            ref={agreeRef}
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
