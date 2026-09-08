import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { featurePackAPI } from '../services/electronAPI';
import { useSearchStore } from '../stores/useSearchStore';

/**
 * "Features" tab of the Module Manager: optional capabilities the user can add
 * after install.
 *
 * Semantic search is the only one today. It is not shipped enabled because the
 * embedding index and model together run to hundreds of megabytes - far more
 * than the study content in the installer - so it is offered as a download
 * instead of being carried by every copy of the app.
 *
 * A pack can also be installed from a local file or folder. That is not only a
 * stopgap for having nowhere to host one yet: it is how an offline machine gets
 * the feature at all, and how anyone building a pack tests it.
 *
 * Progress is polled rather than pushed. The install runs in the main process
 * and deliberately outlives this dialog, so the panel has to be able to
 * reattach to an install already in flight when it is reopened; polling gives
 * that for free, where an event subscription would have to replay state.
 */

/** Mirrors `FeaturePack` in @bible/core (the validated catalog listing). */
interface FeaturePackListing {
  pack_id: string;
  pack_type: string;
  name: string;
  version: string;
  description: string;
  license: string;
  license_url?: string | null;
  download_size_bytes: number;
  installed_size_bytes: number;
}

/** Mirrors `SemanticPackStatus` in electron/services/SemanticPackService.ts. */
interface FeaturePackStatus {
  installed: boolean;
  manifest: {
    packId: string;
    name: string;
    version: string;
    license: string;
    installedAt: string;
    installedSizeBytes: number;
  } | null;
  progress: {
    packId: string;
    phase: 'idle' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
    percent: number;
    bytesDownloaded: number;
    totalBytes: number;
    currentArtifact: number;
    artifactCount: number;
    speedBps: number;
    error?: string;
  } | null;
}

const POLL_INTERVAL_MS = 750;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

const FeaturePackPanel: React.FC = () => {
  const { t } = useI18n();
  const [available, setAvailable] = useState<FeaturePackListing[]>([]);
  const [status, setStatus] = useState<FeaturePackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const checkSemanticAvailability = useSearchStore(s => s.checkSemanticAvailability);

  const refreshStatus = useCallback(async (): Promise<FeaturePackStatus | null> => {
    try {
      const next = (await featurePackAPI.getStatus()) as FeaturePackStatus;
      setStatus(next);
      return next;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  // Initial load: catalog listings plus whatever is already installed or
  // running. Both are needed before the panel can render a meaningful state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [listings, current] = await Promise.all([
          featurePackAPI.listAvailable() as Promise<FeaturePackListing[]>,
          featurePackAPI.getStatus() as Promise<FeaturePackStatus>,
        ]);
        if (cancelled) return;
        setAvailable(listings);
        setStatus(current);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll only while an install is actually running, and stop as soon as it
  // reaches a terminal phase - a permanent timer on an idle dialog is wasted
  // IPC on every tick.
  const isRunning = status?.progress != null
    && status.progress.phase !== 'done'
    && status.progress.phase !== 'error';

  useEffect(() => {
    if (!isRunning) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;

    pollRef.current = setInterval(() => {
      void (async () => {
        const next = await refreshStatus();
        // The search UI keys off `semanticAvailable`; refresh it the moment the
        // install lands so the toggle appears without reopening the app.
        if (next?.progress?.phase === 'done') {
          void checkSemanticAvailability();
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isRunning, refreshStatus, checkSemanticAvailability]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleInstall = async (packId: string): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await featurePackAPI.install(packId);
      await refreshStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    setBusy(true);
    try {
      await featurePackAPI.cancel();
      await refreshStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSideload = async (kind: 'file' | 'folder'): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      // `null` means the user closed the picker - nothing started, and nothing
      // to report.
      await featurePackAPI.installFromFile(kind);
      await refreshStatus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUninstall = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await featurePackAPI.uninstall();
      await refreshStatus();
      await checkSemanticAvailability();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-3" data-testid="feature-pack-loading">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
        <span className="text-text-secondary">{t('featurePacks.loading')}</span>
      </div>
    );
  }

  const installed = status?.installed === true;
  const progress = status?.progress ?? null;
  const installedPackId = status?.manifest?.packId ?? null;

  /**
   * An install whose pack is in no catalog - the normal case for a sideload,
   * and the only case for one that failed before its manifest could be read
   * (the pack id is empty until then). Without this it would run, and fail,
   * entirely invisibly.
   */
  const unlistedProgress = progress
    && progress.phase !== 'done'
    && !available.some(p => p.pack_id === progress.packId)
    ? progress
    : null;

  const renderProgress = (p: NonNullable<FeaturePackStatus['progress']>): React.ReactElement => (
    <div className="mt-4" data-testid="feature-pack-progress">
      <div
        className="h-2 w-full bg-background-tertiary rounded overflow-hidden"
        role="progressbar"
        aria-valuenow={p.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('featurePacks.progressLabel')}
      >
        <div className="h-full bg-accent transition-all" style={{ width: `${p.percent}%` }} />
      </div>
      <div className="text-xs text-text-secondary mt-2 flex justify-between">
        <span>
          {p.phase === 'installing'
            ? p.currentArtifact > 0
              ? t(
                'featurePacks.phaseInstallingFile',
                { current: String(p.currentArtifact), total: String(p.artifactCount), },
              )
              : t('featurePacks.phaseInstalling')
            : t(
              'featurePacks.phaseDownloading',
              { current: String(p.currentArtifact), total: String(p.artifactCount), },
            )}
        </span>
        <span>
          {formatBytes(p.bytesDownloaded)} / {formatBytes(p.totalBytes)}
          {p.speedBps > 0 && ` · ${formatBytes(p.speedBps)}/s`}
        </span>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-4" data-testid="feature-pack-panel">
      <div>
        <h3 className="text-lg font-semibold text-text-heading">
          {t('featurePacks.heading')}
        </h3>
        <p className="text-sm text-text-secondary mt-1">
          {t('featurePacks.subheading')}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="px-4 py-3 rounded bg-danger-soft border border-danger-border text-sm text-danger-text"
          data-testid="feature-pack-error"
        >
          {error}
        </div>
      )}

      {available.length === 0 && !installed && (
        <div className="px-4 py-6 rounded border border-border text-sm text-text-secondary" data-testid="feature-pack-empty">
          {t('featurePacks.none')}
        </div>
      )}

      {available.map((pack) => {
        const isThisInstalled = installed && installedPackId === pack.pack_id;
        const isThisRunning = progress?.packId === pack.pack_id
          && progress.phase !== 'done'
          && progress.phase !== 'error';

        return (
          <div
            key={pack.pack_id}
            className="border border-border rounded-lg p-4 bg-surface"
            data-testid={`feature-pack-card-${pack.pack_id}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-text-primary">{pack.name}</h4>
                  <span className="text-xs text-text-tertiary">v{pack.version}</span>
                  {isThisInstalled && (
                    <span
                      className="text-xs px-2 py-0.5 rounded bg-success-soft text-success-text border border-success-border"
                      data-testid="feature-pack-installed-badge"
                    >
                      {t('featurePacks.installed')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-secondary mt-1">{pack.description}</p>
                <div className="text-xs text-text-tertiary mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    {t(
                      'featurePacks.downloadSize',
                      { size: formatBytes(pack.download_size_bytes), },
                    )}
                  </span>
                  <span>
                    {t('featurePacks.diskSize', { size: formatBytes(pack.installed_size_bytes), })}
                  </span>
                  <span>
                    {t('featurePacks.license', { license: pack.license })}
                  </span>
                </div>
              </div>

              <div className="flex-shrink-0 flex flex-col gap-2 items-end">
                {isThisRunning ? (
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={busy}
                    className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded hover:bg-background-hover disabled:opacity-50"
                    data-testid="feature-pack-cancel"
                  >
                    {t('featurePacks.cancel')}
                  </button>
                ) : isThisInstalled ? (
                  <button
                    type="button"
                    onClick={handleUninstall}
                    disabled={busy}
                    className="px-4 py-2 text-sm font-medium text-danger border border-danger-border rounded hover:bg-danger-soft disabled:opacity-50"
                    data-testid="feature-pack-uninstall"
                  >
                    {t('featurePacks.remove')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleInstall(pack.pack_id)}
                    disabled={busy || progress != null && isRunning}
                    className="px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover disabled:opacity-50"
                    data-testid="feature-pack-install"
                  >
                    {t('featurePacks.install')}
                  </button>
                )}
              </div>
            </div>

            {isThisRunning && progress && renderProgress(progress)}

            {progress?.packId === pack.pack_id && progress.phase === 'error' && (
              <div
                className="mt-4 px-3 py-2 rounded bg-danger-soft border border-danger-border text-sm text-danger-text"
                role="alert"
                data-testid="feature-pack-install-error"
              >
                {progress.error ?? t('featurePacks.installFailed')}
              </div>
            )}
          </div>
        );
      })}

      {/*
        An installed pack whose listing is gone from every catalog still has to
        be manageable - otherwise disabling a repository would strand the pack
        on disk with no way to remove it from the UI.
      */}
      {installed && !available.some(p => p.pack_id === installedPackId) && status?.manifest && (
        <div className="border border-border rounded-lg p-4 bg-surface" data-testid="feature-pack-orphan">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="font-semibold text-text-primary">{status.manifest.name}</h4>
              <p className="text-sm text-text-secondary mt-1">
                {t('featurePacks.notInCatalog')}
              </p>
              <div className="text-xs text-text-tertiary mt-2">
                {t(
                  'featurePacks.diskSize',
                  { size: formatBytes(status.manifest.installedSizeBytes), },
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleUninstall}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-danger border border-danger-border rounded hover:bg-danger-soft disabled:opacity-50"
              data-testid="feature-pack-uninstall-orphan"
            >
              {t('featurePacks.remove')}
            </button>
          </div>
        </div>
      )}

      {/*
        A sideload in flight, or one that failed. Sideloaded packs usually
        appear in no catalog, so without this the only feedback would be the
        feature quietly appearing - or quietly not.
      */}
      {unlistedProgress && (
        <div className="border border-border rounded-lg p-4 bg-surface" data-testid="feature-pack-sideload-status">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h4 className="font-semibold text-text-primary">
                {unlistedProgress.packId
                  || t('featurePacks.sideloadPending')}
              </h4>
              <p className="text-sm text-text-secondary mt-1">
                {t('featurePacks.sideloadInProgress')}
              </p>
            </div>
            {unlistedProgress.phase !== 'error' && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={busy}
                className="flex-shrink-0 px-4 py-2 text-sm font-medium text-text-primary border border-border rounded hover:bg-background-hover disabled:opacity-50"
                data-testid="feature-pack-sideload-cancel"
              >
                {t('featurePacks.cancel')}
              </button>
            )}
          </div>

          {unlistedProgress.phase === 'error' ? (
            <div
              className="mt-4 px-3 py-2 rounded bg-danger-soft border border-danger-border text-sm text-danger-text"
              role="alert"
              data-testid="feature-pack-sideload-error"
            >
              {unlistedProgress.error ?? t('featurePacks.installFailed')}
            </div>
          ) : (
            renderProgress(unlistedProgress)
          )}
        </div>
      )}

      {/*
        Sideloading exists because a pack has to be installable before there is
        anywhere to host one - and it stays useful afterwards for machines that
        never go online, and for anyone testing a pack they built themselves.
      */}
      <div className="border border-border border-dashed rounded-lg p-4" data-testid="feature-pack-sideload">
        <h4 className="font-semibold text-text-primary text-sm">
          {t('featurePacks.sideloadHeading')}
        </h4>
        <p className="text-sm text-text-secondary mt-1">
          {t('featurePacks.sideloadHelp')}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => handleSideload('file')}
            disabled={busy || isRunning}
            className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded hover:bg-background-hover disabled:opacity-50"
            data-testid="feature-pack-sideload-file"
          >
            {t('featurePacks.sideloadChooseFile')}
          </button>
          <button
            type="button"
            onClick={() => handleSideload('folder')}
            disabled={busy || isRunning}
            className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded hover:bg-background-hover disabled:opacity-50"
            data-testid="feature-pack-sideload-folder"
          >
            {t('featurePacks.sideloadChooseFolder')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeaturePackPanel;
