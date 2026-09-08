import React from 'react';
import { useModuleStore, DownloadProgress } from '../stores/useModuleStore';
import { useI18n } from '../contexts/useI18n';

const DownloadProgressPanel: React.FC = () => {
  const { t } = useI18n();
  const { activeDownloads, pauseDownload, resumeDownload, cancelDownload } = useModuleStore();

  if (activeDownloads.length === 0) {
    return null;
  }

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  // Format time remaining
  const formatTimeRemaining = (seconds: number | undefined): string => {
    if (!seconds || seconds === 0) return 'Calculating...';
    if (seconds < 60) return `${Math.round(seconds)}s remaining`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m remaining`;
    return `${Math.round(seconds / 3600)}h remaining`;
  };

  // Format speed
  const formatSpeed = (mbps: number | undefined): string => {
    if (!mbps) return '';
    if (mbps < 1) return `${Math.round(mbps * 1024)} KB/s`;
    return `${mbps.toFixed(2)} MB/s`;
  };

  // A finished download is the one state change worth interrupting the user
  // for; everything else (percentage ticks, speed) would be noise if announced.
  const finishedNames = activeDownloads
    .filter((d: DownloadProgress) => d.status === 'completed')
    .map((d: DownloadProgress) => d.moduleName)
    .join(', ');

  return (
    <div className="border-t border-border bg-surface-secondary">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-text-heading">
            {t('downloadProgressPanel.activeDownloads', { v1: activeDownloads.length })}
          </h3>
        </div>

        {/* Single polite status region for the whole panel. */}
        <div aria-live="polite" className="sr-only">
          {finishedNames
            ? // Worded to stay grammatical at any count.
              t('ui.downloadProgress.finishedAnnouncement', { names: finishedNames })
            : ''}
        </div>

        <div className="space-y-3">
          {activeDownloads.map((download: DownloadProgress) => (
            <div
              key={download.queueId}
              className="bg-surface border border-border rounded-lg p-3"
            >
              {/* Download header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0 me-4">
                  <h4 className="text-sm font-medium text-text-heading truncate">
                    {download.moduleName}
                  </h4>
                  <p className="text-xs text-text-tertiary">{download.moduleId}</p>
                </div>
                <div className="flex gap-1">
                  {download.status === 'downloading' && (
                    <button
                      type="button"
                      onClick={() => pauseDownload(download.queueId)}
                      className="p-1 text-text-secondary hover:text-text-primary transition-colors"
                      title={t('ui.downloadProgress.pause')}
                      aria-label={t('ui.downloadProgress.pause')}
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <path
                          fillRule="evenodd"
                          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  )}
                  {download.status === 'paused' && (
                    <button
                      type="button"
                      onClick={() => resumeDownload(download.queueId)}
                      className="p-1 text-accent hover:text-accent-hover transition-colors"
                      title={t('ui.downloadProgress.resume')}
                      aria-label={t('ui.downloadProgress.resume')}
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => cancelDownload(download.queueId)}
                    className="p-1 text-danger hover:text-danger-text transition-colors"
                    title={t('ui.downloadProgress.cancel')}
                    aria-label={t('ui.downloadProgress.cancel')}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-2">
                <div
                  className="w-full bg-control rounded-full h-2 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(download.progressPercentage)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t('ui.downloadProgress.progressLabel', { name: download.moduleName })}
                >
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      download.status === 'downloading'
                        ? 'bg-accent'
                        : download.status === 'paused'
                        ? 'bg-warning'
                        : download.status === 'completed'
                        ? 'bg-success'
                        : download.status === 'failed'
                        ? 'bg-danger'
                        : 'bg-background-strong'
                    }`}
                    style={{ width: `${download.progressPercentage}%` }}
                  />
                </div>
              </div>

              {/* Download stats */}
              <div className="flex items-center justify-between text-xs text-text-tertiary">
                <div className="flex items-center gap-3">
                  <span className="font-medium">
                    {download.progressPercentage.toFixed(1)}%
                  </span>
                  {download.totalBytes && (
                    <span>
                      {formatFileSize(download.progressBytes)} /{' '}
                      {formatFileSize(download.totalBytes)}
                    </span>
                  )}
                  {download.status === 'downloading' && download.speedMBps && (
                    <span className="text-accent font-medium">
                      {formatSpeed(download.speedMBps)}
                    </span>
                  )}
                </div>

                <div>
                  {download.status === 'downloading' && (
                    <span>{formatTimeRemaining(download.estimatedTimeRemaining)}</span>
                  )}
                  {download.status === 'paused' && (
                    <span className="text-warning font-medium">{t('ui.downloadProgress.statusPaused')}</span>
                  )}
                  {download.status === 'pending' && (
                    <span className="text-text-secondary">{t('ui.downloadProgress.statusPending')}</span>
                  )}
                  {download.status === 'completed' && (
                    <span className="text-success font-medium">{t('ui.downloadProgress.statusComplete')}</span>
                  )}
                  {download.status === 'failed' && (
                    <span className="text-danger font-medium">
                      {t('ui.downloadProgress.failed', {
                        reason: download.errorMessage || t('ui.downloadProgress.unknownError'),
                      })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DownloadProgressPanel;
