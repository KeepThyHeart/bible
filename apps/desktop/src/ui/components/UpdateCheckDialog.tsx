import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { unwrap } from '../services/ipcResult';
import { activateFocusTrap } from '../utils/focusTrap';
import type { UpdateCheckInfo, UpdateCheckOutcome } from '../../../electron/services/UpdateCheckService';
import type { UpdateDownloadProgress } from '../../../electron/services/UpdateInstallService';

export interface UpdateCheckDialogProps {
  onClose: () => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'confirm'; info: UpdateCheckInfo }
  | { kind: 'offline'; info: UpdateCheckInfo }
  | { kind: 'not-configured' }
  | { kind: 'checking'; info: UpdateCheckInfo }
  | { kind: 'result'; outcome: UpdateCheckOutcome }
  | { kind: 'downloading'; version: string }
  | { kind: 'downloaded'; version: string }
  | { kind: 'download-failed'; message: string };

/**
 * Manual "Check for Updates" dialog.
 *
 * Flow, designed for the persecuted-user model - no egress happens without an
 * explicit, informed action:
 *   1. `loading` - pull pre-flight info (`updates.getInfo()`), which makes NO
 *                   network request; it only reports the host + offline state.
 *   2. `offline` - if the master offline switch is on, we stop here and say so.
 *   3. `confirm` - show the exact host that WILL be contacted and ask the user
 *                   to confirm before any request is made.
 *   4. `checking` - on confirm, call `updates.check()`, which contacts the host
 *                   through the single NetworkGateway.
 *   5. `result` - up-to-date, or a newer version with release notes and a
 *                   manual download link (opened externally; nothing auto-runs).
 */
const UpdateCheckDialog: React.FC<UpdateCheckDialogProps> = ({ onClose }) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  // Whether this install can apply an update in place (step 6). Windows and a
  // writable AppImage can; a .deb/.rpm is the package manager's job, and an
  // unsigned macOS bundle cannot be swapped by Squirrel.Mac. False until the
  // main process answers, so the in-app button never appears speculatively.
  const [canInstall, setCanInstall] = useState(false);
  const [progress, setProgress] = useState<UpdateDownloadProgress | null>(null);

  // Pre-flight: read host + offline state without contacting anything.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await unwrap(window.electron.updates.getInfo());
        if (cancelled) return;
        if (!info.configured) {
          setPhase({ kind: 'not-configured' });
        } else if (info.offline) {
          setPhase({ kind: 'offline', info });
        } else {
          setPhase({ kind: 'confirm', info });
        }
      } catch {
        if (!cancelled) setPhase({ kind: 'not-configured' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Focus trap + Escape to close.
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const handle = activateFocusTrap(node);
    return () => handle.release();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const runCheck = async (info: UpdateCheckInfo) => {
    setPhase({ kind: 'checking', info });
    try {
      const outcome = await unwrap(window.electron.updates.check());
      setPhase({ kind: 'result', outcome });
    } catch (err) {
      setPhase({
        kind: 'result',
        outcome: {
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
          host: info.host,
        },
      });
    }
  };

  // Ask whether this install can self-update, once an update is actually on
  // offer. Makes no network request.
  useEffect(() => {
    if (phase.kind !== 'result' || phase.outcome.status !== 'update-available') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await unwrap(window.electron.updates.canInstall());
        if (!cancelled) setCanInstall(res.supported);
      } catch {
        // Leave it false - the manual download link is always available, so a
        // failure here costs the user nothing.
      }
    })();
    return () => { cancelled = true; };
  }, [phase]);

  // Progress arrives as broadcast events while a download is in flight.
  useEffect(() => {
    return window.electron.updates.onDownloadProgress(setProgress);
  }, []);

  const runDownload = async (version: string) => {
    setProgress(null);
    setPhase({ kind: 'downloading', version });
    try {
      const outcome = await unwrap(window.electron.updates.download());
      if (outcome.status === 'downloaded') {
        setPhase({ kind: 'downloaded', version: outcome.version });
      } else if (outcome.status === 'blocked') {
        setPhase({ kind: 'download-failed', message: t('updateCheck.blockedByPrivacy') });
      } else if (outcome.status === 'unsupported') {
        setPhase({ kind: 'download-failed', message: t('updateCheck.cannotSelfUpdate') });
      } else {
        setPhase({ kind: 'download-failed', message: outcome.message });
      }
    } catch (err) {
      setPhase({
        kind: 'download-failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const openDownload = (url: string) => {
    if (!url) return;
    const w = window as unknown as {
      electron?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
    };
    void w.electron?.ipcRenderer?.invoke('app:open-external', url);
  };

  return (
    <div className="fixed inset-0 bg-background-overlay flex items-center justify-center z-50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-check-title"
        className="bg-surface rounded-lg shadow-xl w-full max-w-lg p-6 flex flex-col gap-4"
        data-testid="update-check-dialog"
      >
        <h2 id="update-check-title" className="text-xl font-semibold text-text-heading">
          {t('updateCheck.title')}
        </h2>

        {phase.kind === 'loading' && (
          <p className="text-text-secondary">{t('updateCheck.preparing')}</p>
        )}

        {phase.kind === 'not-configured' && (
          <p className="text-text-secondary" data-testid="update-not-configured">
            {t('updateCheck.notConfigured')}
          </p>
        )}

        {phase.kind === 'offline' && (
          <p className="text-text-secondary" data-testid="update-offline">
            {t('updateCheck.offline')}
          </p>
        )}

        {phase.kind === 'confirm' && (
          <>
            <p className="text-text-secondary">
              {t('updateCheck.confirmIntro')}
            </p>
            <p className="px-3 py-2 rounded bg-background-warm font-mono text-sm text-text-primary break-all" data-testid="update-host">
              {phase.info.host}
            </p>
            <p className="text-xs text-text-muted">
              {t('updateCheck.currentVersion', { version: phase.info.currentVersion })}
            </p>
          </>
        )}

        {phase.kind === 'checking' && (
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
            <p className="text-text-secondary">
              {t('updateCheck.checking', { host: phase.info.host })}
            </p>
          </div>
        )}

        {phase.kind === 'result' && phase.outcome.status === 'up-to-date' && (
          <p className="text-text-secondary" data-testid="update-up-to-date">
            {t('updateCheck.upToDate', { version: phase.outcome.currentVersion })}
          </p>
        )}

        {phase.kind === 'result' && phase.outcome.status === 'offline' && (
          <p className="text-text-secondary" data-testid="update-offline">
            {t('updateCheck.offline')}
          </p>
        )}

        {phase.kind === 'result' && phase.outcome.status === 'error' && (
          <p className="text-danger" data-testid="update-error">
            {t('updateCheck.error', { message: phase.outcome.message })}
          </p>
        )}

        {phase.kind === 'result' && phase.outcome.status === 'update-available' && (
          <div className="flex flex-col gap-3" data-testid="update-available">
            <p className="text-text-primary font-medium">
              {t(
                'updateCheck.available',
                { version: phase.outcome.latestVersion, current: phase.outcome.currentVersion, },
              )}
            </p>
            {phase.outcome.releaseNotes && (
              <div className="max-h-48 overflow-auto rounded border border-border bg-background-warm p-3 text-sm text-text-secondary whitespace-pre-wrap">
                {phase.outcome.releaseNotes}
              </div>
            )}
          </div>
        )}

        {phase.kind === 'downloading' && (
          <div className="flex flex-col gap-2" data-testid="update-downloading">
            <p className="text-text-secondary">
              {t('updateCheck.downloading', { version: phase.version })}
            </p>
            <div className="h-2 w-full rounded bg-background-warm overflow-hidden">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${Math.round(progress?.percent ?? 0)}%` }}
              />
            </div>
            <p className="text-xs text-text-muted">
              {Math.round(progress?.percent ?? 0)}%
            </p>
          </div>
        )}

        {phase.kind === 'downloaded' && (
          <p className="text-text-primary" data-testid="update-downloaded">
            {t('updateCheck.downloaded', { version: phase.version })}
          </p>
        )}

        {phase.kind === 'download-failed' && (
          <p className="text-danger" data-testid="update-download-failed">
            {phase.message}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          {phase.kind === 'confirm' && (
            <button
              type="button"
              onClick={() => runCheck(phase.info)}
              className="px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors"
              data-testid="update-check-confirm"
            >
              {t('updateCheck.checkNow')}
            </button>
          )}
          {phase.kind === 'result' && phase.outcome.status === 'update-available' && canInstall && (
            <button
              type="button"
              onClick={() => void runDownload((phase.outcome as { latestVersion: string }).latestVersion)}
              className="px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors"
              data-testid="update-download-install"
            >
              {t('updateCheck.downloadAndInstall')}
            </button>
          )}
          {phase.kind === 'downloaded' && (
            <button
              type="button"
              onClick={() => void window.electron.updates.install()}
              className="px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors"
              data-testid="update-restart-install"
            >
              {t('updateCheck.restartAndInstall')}
            </button>
          )}
          {phase.kind === 'result' && phase.outcome.status === 'update-available' && phase.outcome.releaseUrl && (
            <button
              type="button"
              onClick={() => openDownload((phase.outcome as { releaseUrl: string }).releaseUrl)}
              // Demoted to a secondary action when the in-app install is
              // available, so the dialog never shows two competing primaries.
              className={
                canInstall
                  ? 'px-4 py-2 text-sm font-medium text-text-primary border border-border rounded hover:bg-background-hover transition-colors'
                  : 'px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors'
              }
              data-testid="update-download"
            >
              {t('updateCheck.download')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded hover:bg-background-hover transition-colors"
            data-testid="update-check-close"
          >
            {phase.kind === 'confirm'
              ? t('updateCheck.cancel')
              : t('updateCheck.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdateCheckDialog;
