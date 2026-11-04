/**
 * The account dialog and toast (`shellOverlays`, rendered once by the shell). The dialog shows the screen the store's
 * `dialog` names; closing it (Escape, the X, a click outside) is refused while an unconfirmed recovery code is shown.
 * Notices (verified, sent, signed out...) show inside the dialog, or as a toast when it is closed.
 */
import { useEffect, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { accountStore } from './instance';
import { AccountScreen, useAccountState } from './AccountScreens';
import { failureKey } from './errors';
import type { AccountState } from './accountStore';
import './accounts.scss';

function noticeText(t: (k: string) => string, n: NonNullable<AccountState['notice']>): string {
  return n.token ? t(failureKey(n.token)) : t(`accounts.notice.${n.id}`);
}

function Toast() {
  const { t } = useTranslation();
  const s = useAccountState();
  const notice = s.dialog === null ? s.notice : undefined;
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => accountStore.dismissNotice(), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (!notice) return null;
  return (
    <div class="kth-accounts-toast" role="status" data-testid="accounts-toast">{noticeText(t, notice)}</div>
  );
}

function Dialog({ dialog }: { dialog: NonNullable<AccountState['dialog']> }) {
  const { t } = useTranslation();
  const s = useAccountState();
  const ref = useRef<HTMLDivElement>(null);
  const close = () => accountStore.close();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, [dialog]);
  const locked = dialog === 'recovery';
  return (
    <div class="settings-panel-overlay kth-accounts-overlay" onClick={close}>
      <div
        ref={ref} class="kth-accounts-dialog" role="dialog" aria-modal="true" aria-label={t('accounts.title')}
        data-testid="accounts-dialog" data-screen={dialog} onClick={(e) => e.stopPropagation()}
      >
        <div class="kth-accounts-dialog__header">
          <h3><i class="fa-solid fa-user" aria-hidden="true" /> {t('accounts.title')}</h3>
          {locked ? null : (
            <button type="button" class="kth-accounts-dialog__close" onClick={close} title={t('accounts.close')} aria-label={t('accounts.close')}>
              <i class="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          )}
        </div>
        <div class="kth-accounts-dialog__body">
          {s.notice ? (
            <p class="kth-account__notice" role="status" data-testid="accounts-notice">
              {noticeText(t, s.notice)}{' '}
              <button type="button" class="kth-account__link" onClick={() => accountStore.dismissNotice()}>{t('accounts.close')}</button>
            </p>
          ) : null}
          <AccountScreen dialog={dialog} />
        </div>
      </div>
    </div>
  );
}

export function AccountDialog() {
  const s = useAccountState();
  return (
    <>
      {s.dialog ? <Dialog dialog={s.dialog} /> : null}
      <Toast />
    </>
  );
}
