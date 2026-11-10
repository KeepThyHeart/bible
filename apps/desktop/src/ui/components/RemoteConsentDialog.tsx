/**
 * RemoteConsentDialog.tsx
 *
 * Notice for the online meaning search (task 0190). Shown by the search store
 * before an Ideas search the user asked for, when the build configures a
 * remote service and the user has not agreed yet. Nothing is sent until
 * "Agree and search". The three answers:
 *   - Agree and search: recorded; this and later Ideas searches use the service.
 *   - Not now (or Escape): NOT recorded. Only this Ideas search is skipped
 *     (the keyword results stay); the next one asks again.
 *   - Don't use the online service: recorded; Ideas search then uses the local
 *     meaning pack when one is installed, and otherwise says what it needs.
 * Mounted once at app level; renders nothing otherwise.
 */

import { useEffect, useRef } from 'react';
import { useSearchStore } from '../stores/useSearchStore';
import { useI18n } from '../contexts/useI18n';
import { activateFocusTrap } from '../utils/focusTrap';
import { openModuleManager } from '../utils/openModuleManager';

export function RemoteConsentDialog() {
  const { t } = useI18n();
  const open = useSearchStore((s) => s.consentDialogOpen);
  const answer = useSearchStore((s) => s.answerRemoteConsent);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        void answer('notNow');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, answer]);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    if (!node) return;
    const handle = activateFocusTrap(node);
    return () => handle.release();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ backgroundColor: 'var(--theme-bg-overlay)' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-consent-title"
        aria-describedby="remote-consent-body"
        data-testid="remote-consent-dialog"
        className="rounded-lg shadow-xl flex flex-col"
        style={{
          width: 480,
          maxWidth: '90vw',
          backgroundColor: 'var(--theme-bg-primary)',
          border: '1px solid var(--theme-border-primary)',
        }}
      >
        <div className="p-4" style={{ borderBlockEnd: '1px solid var(--theme-border-primary)' }}>
          <h2 id="remote-consent-title" className="text-lg font-semibold" style={{ color: 'var(--theme-text-heading)' }}>
            {t('remoteConsent.title')}
          </h2>
        </div>
        <div id="remote-consent-body" className="p-4 space-y-3 text-sm" style={{ color: 'var(--theme-text-primary)' }}>
          <p>{t('remoteConsent.body')}</p>
          <p>{t('remoteConsent.never')}</p>
          <p data-testid="remote-consent-local">
            {t('remoteConsent.local')}{' '}
            <button
              type="button"
              className="underline"
              style={{ color: 'var(--theme-accent-primary)' }}
              data-testid="remote-consent-get-pack"
              onClick={() => {
                void answer('notNow');
                openModuleManager('features');
              }}
            >
              {t('remoteConsent.getPack')}
            </button>
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 p-4" style={{ borderBlockStart: '1px solid var(--theme-border-primary)' }}>
          <button
            type="button"
            onClick={() => void answer('declined')}
            className="px-3 py-1.5 rounded text-sm me-auto"
            style={{ color: 'var(--theme-text-secondary)' }}
            data-testid="remote-consent-never"
            title={t('remoteConsent.dontUseOnlineHint')}
          >
            {t('remoteConsent.dontUseOnline')}
          </button>
          <button
            type="button"
            onClick={() => void answer('notNow')}
            className="px-3 py-1.5 rounded text-sm"
            style={{ border: '1px solid var(--theme-accent-primary)', color: 'var(--theme-accent-primary)' }}
            data-testid="remote-consent-decline"
          >
            {t('remoteConsent.decline')}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => void answer('granted')}
            className="px-3 py-1.5 rounded text-sm"
            style={{ backgroundColor: 'var(--theme-accent-primary)', color: 'var(--theme-accent-text)' }}
            data-testid="remote-consent-agree"
          >
            {t('remoteConsent.agree')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RemoteConsentDialog;
