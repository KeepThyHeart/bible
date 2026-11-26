/**
 * PrivacySection.tsx
 *
 * "Privacy" tab of the Preferences dialog: the master "Allow web requests"
 * switch. Until this section existed, the ONLY way to reach the switch was
 * the native Privacy → Allow Web Requests menu item - two other messages in
 * the app already pointed users at "Preferences" for it
 * (`networkHandlers.ts`, `windowSecurity.ts`) even though nothing here
 * answered that.
 *
 * Bound to `useNetworkStore`, the same store the menu checkbox, first run and
 * the Module Manager's offline banner read - so this toggle can never
 * disagree with any of them.
 */

import React, { useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { clearHistory } from '../../services/clearHistory';

/** History switches and the Clear history action (task 0224). */
export const HistoryPrivacy: React.FC = () => {
  const { t } = useI18n();
  const reopenSearchTabs = usePreferencesStore((s) => s.reopenSearchTabs);
  const setReopenSearchTabs = usePreferencesStore((s) => s.setReopenSearchTabs);
  const rememberReadingHistory = usePreferencesStore((s) => s.rememberReadingHistory);
  const setRememberReadingHistory = usePreferencesStore((s) => s.setRememberReadingHistory);
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);

  return (
    <div data-testid="privacy-history">
      <h3 className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
        {t('preferencesDialog.privacyHistoryHeading')}
      </h3>
      <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
        {t('preferencesDialog.privacyHistoryIntro')}
      </p>
      <label className="flex items-center gap-2 cursor-pointer mt-3">
        <input
          type="checkbox"
          checked={reopenSearchTabs}
          onChange={(e) => setReopenSearchTabs(e.target.checked)}
          className="w-4 h-4 rounded"
          style={{ accentColor: 'var(--theme-accent-primary)' }}
          data-testid="privacy-reopen-search-tabs"
        />
        <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
          {t('preferencesDialog.reopenSearchTabsLabel')}
        </span>
      </label>
      <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
        {t('preferencesDialog.reopenSearchTabsDescription')}
      </p>
      <label className="flex items-center gap-2 cursor-pointer mt-3">
        <input
          type="checkbox"
          checked={rememberReadingHistory}
          onChange={(e) => setRememberReadingHistory(e.target.checked)}
          className="w-4 h-4 rounded"
          style={{ accentColor: 'var(--theme-accent-primary)' }}
          data-testid="privacy-remember-reading-history"
        />
        <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
          {t('preferencesDialog.rememberReadingHistoryLabel')}
        </span>
      </label>
      <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
        {t('preferencesDialog.rememberReadingHistoryDescription')}
      </p>

      <div className="mt-4">
        {!confirming ? (
          <button
            type="button"
            className="px-3 py-1 text-sm rounded border"
            style={{ borderColor: 'var(--theme-border-primary)', color: 'var(--theme-text-primary)' }}
            onClick={() => { setCleared(false); setConfirming(true); }}
            data-testid="privacy-clear-history"
          >
            {t('preferencesDialog.clearHistoryButton')}
          </button>
        ) : (
          <div
            role="alertdialog"
            aria-label={t('preferencesDialog.clearHistoryConfirmTitle')}
            className="p-3 rounded border"
            style={{ borderColor: 'var(--theme-border-primary)', background: 'var(--theme-bg-secondary)' }}
            data-testid="privacy-clear-history-confirm"
          >
            <p className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
              {t('preferencesDialog.clearHistoryConfirmTitle')}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
              {t('preferencesDialog.clearHistoryConfirmBody')}
            </p>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                className="px-3 py-1 text-sm rounded"
                style={{ background: 'var(--theme-accent-primary)', color: 'var(--theme-accent-text)' }}
                onClick={() => { clearHistory(); setConfirming(false); setCleared(true); }}
                data-testid="privacy-clear-history-confirm-button"
              >
                {t('preferencesDialog.clearHistoryConfirmButton')}
              </button>
              <button
                type="button"
                className="px-3 py-1 text-sm rounded border"
                style={{ borderColor: 'var(--theme-border-primary)', color: 'var(--theme-text-primary)' }}
                onClick={() => setConfirming(false)}
                data-testid="privacy-clear-history-cancel"
              >
                {t('preferencesDialog.clearHistoryCancel')}
              </button>
            </div>
          </div>
        )}
        <p role="status" className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }} data-testid="privacy-clear-history-status">
          {cleared ? t('preferencesDialog.clearHistoryDone') : ''}
        </p>
      </div>
    </div>
  );
};

export const PrivacySection: React.FC = () => {
  const { t } = useI18n();
  const { allowWebRequests, requestAllow } = useNetworkStore();
  // Optimistic toggle state so the switch tracks the click immediately rather
  // than waiting on the native confirmation dialog's round trip; snapped back
  // to the store's value below if the user cancels that dialog.
  const [pending, setPending] = useState(false);

  // Until the catalog carries the key, `t` hands the key back; use English.
  const pendingKey = 'preferencesDialog.allowWebRequestsPending';
  const pendingMsg = t(pendingKey);
  const pendingText = pendingMsg === pendingKey ? 'Waiting for your confirmation in the dialog that just opened\u2026' : pendingMsg;

  const handleToggle = async (checked: boolean) => {
    if (pending) return;
    if (!checked) {
      // Turning off is never gated - apply immediately.
      await requestAllow(false);
      return;
    }
    setPending(true);
    try {
      // Resolves to what the user actually decided at the native dialog, not
      // the request - a cancel comes back `false` and the checkbox must snap
      // back to unchecked, which it does here because `allowWebRequests`
      // (read from the store above) only changes when `requestAllow` sets it.
      await requestAllow(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allowWebRequests}
            // Not `disabled` while the native confirmation is open: a disabled
            // control drops keyboard focus to <body> and it never comes back.
            // `aria-busy` + the status line below carry the state instead, and
            // `handleToggle` ignores clicks until the dialog resolves.
            aria-busy={pending}
            onChange={(e) => void handleToggle(e.target.checked)}
            className="w-4 h-4 rounded"
            style={{ accentColor: 'var(--theme-accent-primary)' }}
            data-testid="privacy-allow-web-requests-checkbox"
          />
          <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            {t('preferencesDialog.allowWebRequestsLabel')}
          </span>
        </label>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('preferencesDialog.allowWebRequestsDescription')}
        </p>
        {/* Always mounted so assistive tech announces the text when it appears. */}
        <p
          role="status"
          className="text-xs mt-1"
          style={{ color: 'var(--theme-text-secondary)' }}
          data-testid="privacy-allow-web-requests-status"
        >
          {pending ? pendingText : ''}
        </p>
      </div>

      <HistoryPrivacy />

      {/* B-161: every online feature in one place, with where it is controlled. */}
      <div data-testid="privacy-online-features">
        <h3 className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
          {t('preferencesDialog.privacyOnlineHeading')}
        </h3>
        <ul className="list-disc ps-5 mt-1 space-y-1 text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
          <li>{t('preferencesDialog.privacyOnlineModules')}</li>
          <li>{t('preferencesDialog.privacyOnlineUpdates')}</li>
          <li>{t('preferencesDialog.privacyOnlineSpeech')}</li>
          <li>{t('preferencesDialog.privacyOnlineSearch')}</li>
          <li>{t('preferencesDialog.privacyOnlineDiagnostics')}</li>
          <li>{t('preferencesDialog.privacyOnlineLinks')}</li>
        </ul>
        <p className="text-xs mt-2" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('preferencesDialog.privacyOnlineFooter')}
        </p>
      </div>
    </div>
  );
};

export default PrivacySection;
