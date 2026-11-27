/**
 * UpdatesSection.tsx
 *
 * "Updates" tab of the Preferences dialog (task 0234): what version this is,
 * which release channel it follows, a button that opens the same Check for
 * Updates dialog as the Help menu, and the opt-in "Check for updates at startup".
 *
 * Nothing here contacts the network by itself. Mounting reads local facts only
 * (`updates.getInfo`/`canInstall` make no request); the button hands over to the
 * dialog, which names the host and asks before it contacts anything. "Allow web
 * requests" still governs every check.
 */

import React, { useEffect, useState } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { unwrap } from '../../services/ipcResult';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import type { UpdateCheckInfo } from '../../../../electron/services/UpdateCheckService';
import type { UnsupportedReason } from '../../../../electron/services/UpdateInstallService';

/** `beta` -> `Beta`. The channel name comes from the version string itself. */
function titleCase(channel: string): string {
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

export const UpdatesSection: React.FC = () => {
  const { t } = useI18n();
  const allowWebRequests = useNetworkStore((s) => s.allowWebRequests);
  const loadNetwork = useNetworkStore((s) => s.load);
  const checkAtStartup = usePreferencesStore((s) => s.checkUpdatesAtStartup);
  const setCheckAtStartup = usePreferencesStore((s) => s.setCheckUpdatesAtStartup);
  const [info, setInfo] = useState<UpdateCheckInfo | null>(null);
  const [unsupported, setUnsupported] = useState<UnsupportedReason | null>(null);

  useEffect(() => {
    void loadNetwork();
    let cancelled = false;
    void (async () => {
      try {
        const next = await unwrap(window.electron.updates.getInfo());
        if (!cancelled) setInfo(next);
      } catch {
        // Leave the version lines out; the button still works.
      }
      try {
        const res = await unwrap(window.electron.updates.canInstall());
        if (!cancelled && !res.supported && res.reason) setUnsupported(res.reason);
      } catch {
        // No note is better than a wrong one.
      }
    })();
    return () => { cancelled = true; };
  }, [loadNetwork]);

  const note =
    unsupported === 'linux-package-manager'
      ? t('preferencesDialog.updatesNoteLinuxPackage')
      : unsupported === 'macos-unsigned'
        ? t('preferencesDialog.updatesNoteMacUnsigned')
        : null;

  return (
    <div className="space-y-6" data-testid="updates-section">
      <p className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
        {t('preferencesDialog.updatesIntro')}
      </p>

      <div className="space-y-1" data-testid="updates-version-block">
        <p className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }} data-testid="updates-version">
          {info ? t('preferencesDialog.updatesVersion', { version: info.currentVersion }) : ' '}
        </p>
        {info?.buildId ? (
          <p className="text-xs" style={{ color: 'var(--theme-text-secondary)' }} data-testid="updates-build">
            {t('preferencesDialog.updatesBuild', { buildId: info.buildId })}
          </p>
        ) : null}
        {info ? (
          <p className="text-xs" style={{ color: 'var(--theme-text-secondary)' }} data-testid="updates-channel">
            {info.channel
              ? t('preferencesDialog.updatesChannelPre', { channel: titleCase(info.channel) })
              : t('preferencesDialog.updatesChannelStable')}
          </p>
        ) : null}
      </div>

      <div>
        <button
          type="button"
          className="px-3 py-1.5 text-sm font-medium rounded"
          style={{ background: 'var(--theme-accent-primary)', color: 'var(--theme-accent-text)' }}
          onClick={() => window.dispatchEvent(new CustomEvent('command:app:checkForUpdates'))}
          data-testid="updates-check-button"
        >
          {t('preferencesDialog.updatesCheckButton')}
        </button>
        {!allowWebRequests && (
          <p className="text-xs mt-2" style={{ color: 'var(--theme-text-secondary)' }} data-testid="updates-offline-note">
            {t('preferencesDialog.updatesOfflineNote')}
          </p>
        )}
      </div>

      {note && (
        <p
          className="text-xs p-3 rounded border"
          style={{ borderColor: 'var(--theme-border-primary)', color: 'var(--theme-text-secondary)' }}
          data-testid="updates-unsupported-note"
        >
          {note}
        </p>
      )}

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={checkAtStartup}
            onChange={(e) => setCheckAtStartup(e.target.checked)}
            className="w-4 h-4 rounded"
            style={{ accentColor: 'var(--theme-accent-primary)' }}
            data-testid="updates-check-at-startup"
          />
          <span className="text-sm font-medium" style={{ color: 'var(--theme-text-primary)' }}>
            {t('preferencesDialog.updatesStartupLabel')}
          </span>
        </label>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-text-secondary)' }}>
          {t('preferencesDialog.updatesStartupDescription')}
        </p>
      </div>
    </div>
  );
};
