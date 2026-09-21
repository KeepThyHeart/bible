/**
 * ModuleDetailsPanel
 *
 * Right-hand details panel of the Module Manager dialog, shown when a table row
 * is selected. Purely props-driven for the row, with two pieces of local
 * behaviour:
 *
 * - installed modules load their full metadata through the module store's
 *   `detailsSlice` (`loadModuleDetails` -> `selectedModuleDetails`);
 * - Re-index calls `moduleAPI.reindexModule` itself and keeps its own
 *   busy / success / error state.
 *
 * The panel does NOT own confirm dialogs or the install/update/uninstall calls:
 * the dialog wires `onInstall` / `onUpdate` / `onUninstall` to its own handlers.
 *
 * It is not a modal, so it adds no focus trap of its own (the dialog already
 * has one). Escape while focus is inside the panel closes just the panel and is
 * not allowed to bubble to the dialog's own Escape handler.
 *
 * Only metadata that exists is rendered: an absent field never shows an empty
 * label.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { useModuleStore } from '../../stores/useModuleStore';
import { moduleAPI } from '../../stores/module/moduleAPI';
import type { ModuleRow } from '../../stores/module/moduleRows';
import type { DownloadProgress as ActiveDownload } from '../../stores/module/types';
import { useTd } from './moduleManagerI18n';
import { ProgressRing } from '../shared/ProgressRing';

export interface ModuleDetailsPanelProps {
  row: ModuleRow;
  /** The in-flight download for this module, if any. Disables install actions. */
  activeDownload?: ActiveDownload;
  isOffline: boolean;
  onClose: () => void;
  onInstall: (row: ModuleRow) => void;
  onUpdate: (row: ModuleRow) => void;
  onUninstall: (row: ModuleRow, removeUserData: boolean) => void;
}

type ReindexState =
  | { phase: 'idle' }
  | { phase: 'busy'; percent?: number }
  | { phase: 'success' }
  | { phase: 'error'; message: string };

function formatFileSize(bytes: number | undefined): string | undefined {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return undefined;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

function formatDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

function isHttpUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url);
}

/** Best-effort percentage from the (loosely typed) indexing progress payload. */
function extractPercent(progress: unknown): number | undefined {
  if (!progress || typeof progress !== 'object') return undefined;
  const p = progress as Record<string, unknown>;
  for (const key of ['percent', 'percentage', 'progressPercentage']) {
    const v = p[key];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.min(100, Math.max(0, v));
  }
  const current = p.current ?? p.completed ?? p.processed;
  const total = p.total;
  if (typeof current === 'number' && typeof total === 'number' && total > 0) {
    return Math.min(100, Math.max(0, (current / total) * 100));
  }
  return undefined;
}

function openExternal(event: React.MouseEvent<HTMLAnchorElement>, url: string): void {
  const w = window as unknown as {
    electron?: { ipcRenderer?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
  };
  const invoke = w.electron?.ipcRenderer?.invoke;
  if (invoke) {
    event.preventDefault();
    void invoke('app:open-external', url);
  }
}

export const ModuleDetailsPanel: React.FC<ModuleDetailsPanelProps> = ({
  row,
  activeDownload,
  isOffline,
  onClose,
  onInstall,
  onUpdate,
  onUninstall,
}) => {
  const tr = useTd();

  const headingId = useId();
  const selectedModuleDetails = useModuleStore((s) => s.selectedModuleDetails);
  const loadingDetails = useModuleStore((s) => s.loadingDetails);
  const loadModuleDetails = useModuleStore((s) => s.loadModuleDetails);
  const clearDetails = useModuleStore((s) => s.clearDetails);

  const catalog = row.catalogModule;
  const installedModuleId = row.installedModule?.module_id;

  // ---- Load extra details for installed modules ---------------------------
  useEffect(() => {
    if (typeof installedModuleId !== 'number') {
      clearDetails();
      return;
    }
    void loadModuleDetails(installedModuleId);
    return () => clearDetails();
  }, [installedModuleId, loadModuleDetails, clearDetails]);

  // Only trust details that belong to the row on screen.
  const details =
    typeof installedModuleId === 'number' && selectedModuleDetails?.module_id === installedModuleId
      ? selectedModuleDetails
      : undefined;
  const installed = details ?? row.installedModule;

  // ---- Uninstall option + re-index state (reset per module) ---------------
  const [removeUserData, setRemoveUserData] = useState(false);
  const [reindex, setReindex] = useState<ReindexState>({ phase: 'idle' });
  const runRef = useRef(0);

  useEffect(() => {
    runRef.current++;
    setRemoveUserData(false);
    setReindex({ phase: 'idle' });
    return () => {
      runRef.current++;
    };
  }, [row.abbreviation]);

  const handleReindex = async (): Promise<void> => {
    const run = ++runRef.current;
    setReindex({ phase: 'busy' });
    try {
      await moduleAPI.reindexModule(row.abbreviation, (progress) => {
        if (run !== runRef.current) return;
        const percent = extractPercent(progress);
        if (percent !== undefined) setReindex({ phase: 'busy', percent });
      });
      if (run !== runRef.current) return;
      setReindex({ phase: 'success' });
      if (typeof installedModuleId === 'number') void loadModuleDetails(installedModuleId);
    } catch (error) {
      if (run !== runRef.current) return;
      setReindex({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // ---- Derived display values ---------------------------------------------
  const downloading = !!activeDownload && activeDownload.status !== 'failed';
  const isInstalled = row.installed;
  const showUpdate = isInstalled && row.updateAvailable;
  const description = catalog?.description || installed?.description;
  const version = installed?.version ?? catalog?.version;
  const latestVersion = showUpdate && catalog ? catalog.version : undefined;
  const isIndexed = reindex.phase === 'success' ? true : installed?.is_indexed;
  const usageCount = installed?.usage_count;
  const lastUsed = formatDate(installed?.last_used_date);
  const downloadSize = formatFileSize(catalog?.download_size_bytes);
  const installedSize = formatFileSize(catalog?.installed_size_bytes);
  const licenseUrl = isHttpUrl(catalog?.license_url) ? catalog?.license_url : undefined;
  const features = catalog?.features?.filter(Boolean) ?? [];
  const tags = catalog?.tags?.filter(Boolean) ?? [];
  const language = row.language_code ? row.language_code.toUpperCase() : undefined;
  const reindexBusy = reindex.phase === 'busy';

  const statusLabel = (status: ActiveDownload['status']): string => {
    switch (status) {
      case 'pending':
        return tr('moduleDetails.status.pending', 'Queued');
      case 'downloading':
        return tr('moduleDetails.status.downloading', 'Downloading');
      case 'paused':
        return tr('moduleDetails.status.paused', 'Paused');
      case 'completed':
        return tr('moduleDetails.status.completed', 'Completed');
      case 'failed':
        return tr('moduleDetails.status.failed', 'Failed');
    }
  };

  const fields: Array<{ id: string; label: string; value: React.ReactNode }> = [];
  const addField = (id: string, label: string, value: React.ReactNode | undefined | null | false): void => {
    if (value === undefined || value === null || value === false || value === '') return;
    fields.push({ id, label, value });
  };

  addField('type', tr('moduleDetails.typeLabel', 'Type'), row.module_type.replace(/_/g, ' '));
  addField('language', tr('moduleDetails.languageLabel', 'Language'), language);
  addField(
    'version',
    tr('moduleDetails.versionLabel', 'Version'),
    version
      ? latestVersion && latestVersion !== version
        ? `${version} (${tr('moduleDetails.latestVersion', 'latest: {version}', { version: latestVersion })})`
        : version
      : undefined
  );
  addField('author', tr('moduleDetails.authorLabel', 'Author'), catalog?.author);
  addField('publisher', tr('moduleDetails.publisherLabel', 'Publisher'), catalog?.publisher);
  addField('year', tr('moduleDetails.yearLabel', 'Year'), catalog?.year_published);
  addField(
    'license',
    tr('moduleDetails.licenseLabel', 'License'),
    catalog?.license
      ? licenseUrl
        ? (
          <a
            href={licenseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
            data-testid="module-details-license-link"
            onClick={(e) => openExternal(e, licenseUrl)}
          >
            {catalog.license}
          </a>
        )
        : catalog.license
      : undefined
  );
  addField('downloadSize', tr('moduleDetails.downloadSizeLabel', 'Download size'), downloadSize);
  addField('installedSize', tr('moduleDetails.installedSizeLabel', 'Installed size'), installedSize);
  addField(
    'requires',
    tr('moduleDetails.requiresLabel', 'Requires'),
    catalog?.requires_module
  );
  addField(
    'source',
    tr('moduleDetails.sourceLabel', 'Catalog source'),
    catalog?.download_url ? (
      <span className="break-all">{catalog.download_url}</span>
    ) : typeof installed?.repository_id === 'number' ? (
      tr('moduleDetails.sourceRepository', 'Repository #{id}', { id: installed.repository_id })
    ) : undefined
  );
  addField(
    'checksum',
    tr('moduleDetails.checksumLabel', 'Checksum'),
    catalog?.checksum ? <span className="font-mono break-all">{catalog.checksum}</span> : undefined
  );
  addField('published', tr('moduleDetails.publishedLabel', 'Published'), formatDate(catalog?.created_date));
  addField('updated', tr('moduleDetails.updatedLabel', 'Updated'), formatDate(catalog?.updated_date));
  if (isInstalled && typeof isIndexed === 'boolean') {
    addField(
      'indexed',
      tr('moduleDetails.indexedLabel', 'Search index'),
      isIndexed
        ? tr('moduleDetails.indexedYes', 'Indexed')
        : tr('moduleDetails.indexedNo', 'Not indexed')
    );
  }
  if (isInstalled && typeof usageCount === 'number') {
    addField('usage', tr('moduleDetails.usageLabel', 'Times used'), usageCount);
  }
  addField('lastUsed', tr('moduleDetails.lastUsedLabel', 'Last used'), lastUsed);

  const chipClass = 'text-xs px-2 py-0.5 rounded bg-surface-secondary text-text-secondary border border-border';
  const primaryBtn =
    'w-full px-4 py-2 text-sm font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <aside
      data-testid="module-details-panel"
      aria-labelledby={headingId}
      className="flex flex-col h-full min-h-0 w-full bg-surface border-l border-border"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // Close the panel only - the dialog's own Escape handler must not fire.
          e.stopPropagation();
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-4 border-b border-border bg-surface-secondary">
        <div className="min-w-0 flex-1">
          <h3
            id={headingId}
            className="text-base font-semibold text-text-heading break-words"
            data-testid="module-details-name"
          >
            {row.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <span className="text-sm text-text-secondary font-mono" data-testid="module-details-abbreviation">
              {row.abbreviation}
            </span>
            {catalog?.recommended && (
              <span className="text-xs px-2 py-0.5 bg-success-soft text-success-text rounded">
                {tr('moduleDetails.recommended', 'Recommended')}
              </span>
            )}
            {isInstalled && (
              <span className="text-xs px-2 py-0.5 bg-accent-soft text-accent-strong rounded">
                {tr('moduleDetails.installed', 'Installed')}
              </span>
            )}
            {showUpdate && (
              <span className="text-xs px-2 py-0.5 bg-warning-soft text-warning-text rounded">
                {tr('moduleDetails.updateAvailable', 'Update available')}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tr('moduleDetails.close', 'Close details')}
          title={tr('moduleDetails.close', 'Close details')}
          data-testid="module-details-close"
          className="p-1 rounded text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {description && (
          <p className="text-sm text-text-secondary whitespace-pre-line" data-testid="module-details-description">
            {description}
          </p>
        )}

        {loadingDetails && isInstalled && !details && (
          <p className="text-xs text-text-tertiary" role="status" data-testid="module-details-loading">
            {tr('moduleDetails.loading', 'Loading details...')}
          </p>
        )}

        {fields.length > 0 && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-xs" data-testid="module-details-fields">
            {fields.map((f) => (
              <React.Fragment key={f.id}>
                <dt className="font-medium text-text-secondary" data-testid={`module-details-label-${f.id}`}>
                  {f.label}
                </dt>
                <dd className="text-text-primary min-w-0 break-words" data-testid={`module-details-${f.id}`}>
                  {f.value}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        )}

        {features.length > 0 && (
          <div data-testid="module-details-features">
            <h4 className="text-xs font-medium text-text-secondary mb-1">
              {tr('moduleDetails.featuresLabel', 'Features')}
            </h4>
            <ul className="flex flex-wrap gap-1.5">
              {features.map((f) => (
                <li key={f} className={chipClass}>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tags.length > 0 && (
          <div data-testid="module-details-tags">
            <h4 className="text-xs font-medium text-text-secondary mb-1">
              {tr('moduleDetails.tagsLabel', 'Tags')}
            </h4>
            <ul className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <li key={tag} className={chipClass}>
                  {tag}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-border space-y-3">
        {activeDownload && (
          <div
            className="flex items-center gap-3"
            data-testid="module-details-download"
            aria-live="polite"
          >
            <ProgressRing
              size="small"
              percent={
                activeDownload.totalBytes && activeDownload.totalBytes > 0
                  ? Math.round(activeDownload.progressPercentage)
                  : undefined
              }
              ariaLabel={statusLabel(activeDownload.status)}
            />
            <div className="min-w-0 text-sm">
              <div className="font-medium text-text-primary">
                {statusLabel(activeDownload.status)}
                {activeDownload.totalBytes && activeDownload.totalBytes > 0 ? (
                  <span data-testid="module-details-download-percent">
                    {' '}
                    {Math.round(activeDownload.progressPercentage)}%
                  </span>
                ) : null}
              </div>
              {activeDownload.status === 'failed' && activeDownload.errorMessage && (
                <div className="text-xs text-danger break-words" role="alert">
                  {activeDownload.errorMessage}
                </div>
              )}
            </div>
          </div>
        )}

        {!isInstalled && (
          <>
            <button
              type="button"
              className={primaryBtn}
              disabled={isOffline || downloading}
              onClick={() => onInstall(row)}
              data-testid="module-details-install"
            >
              {tr('moduleDetails.install', 'Install')}
            </button>
            {isOffline && (
              <p className="text-xs text-text-tertiary" data-testid="module-details-offline-note">
                {tr('moduleDetails.offlineNote', 'You are offline. Connect to install this module.')}
              </p>
            )}
          </>
        )}

        {showUpdate && (
          <>
            <button
              type="button"
              className="w-full px-4 py-2 text-sm font-medium text-text-on-accent bg-warning rounded hover:bg-warning/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isOffline || downloading}
              onClick={() => onUpdate(row)}
              data-testid="module-details-update"
            >
              {tr('moduleDetails.update', 'Update')}
            </button>
            {isOffline && (
              <p className="text-xs text-text-tertiary" data-testid="module-details-offline-note">
                {tr('moduleDetails.offlineUpdateNote', 'You are offline. Connect to update this module.')}
              </p>
            )}
          </>
        )}

        {isInstalled && (
          <>
            <div className="space-y-1">
              <button
                type="button"
                className="w-full px-4 py-2 text-sm font-medium text-text-primary border border-border rounded hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                disabled={reindexBusy || downloading}
                onClick={() => void handleReindex()}
                data-testid="module-details-reindex"
              >
                {reindexBusy ? (
                  <>
                    <ProgressRing
                      size="small"
                      percent={reindex.phase === 'busy' ? reindex.percent : undefined}
                      ariaLabel={tr('moduleDetails.reindexing', 'Re-indexing...')}
                    />
                    {tr('moduleDetails.reindexing', 'Re-indexing...')}
                  </>
                ) : (
                  tr('moduleDetails.reindex', 'Re-index')
                )}
              </button>
              {reindex.phase === 'success' && (
                <p className="text-xs text-success-text" role="status" data-testid="module-details-reindex-success">
                  {tr('moduleDetails.reindexSuccess', 'Search index rebuilt.')}
                </p>
              )}
              {reindex.phase === 'error' && (
                <p className="text-xs text-danger break-words" role="alert" data-testid="module-details-reindex-error">
                  {tr('moduleDetails.reindexError', 'Re-index failed: {message}', {
                    message: reindex.message,
                  })}
                </p>
              )}
            </div>

            <div className="pt-3 border-t border-border space-y-2">
              <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={removeUserData}
                  onChange={(e) => setRemoveUserData(e.target.checked)}
                  data-testid="module-details-remove-data"
                />
                <span>{tr('moduleDetails.removeData', 'Also remove my data for this module')}</span>
              </label>
              <button
                type="button"
                className="w-full px-4 py-2 text-sm font-medium text-danger border border-danger rounded hover:bg-danger-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={downloading}
                onClick={() => onUninstall(row, removeUserData)}
                data-testid="module-details-uninstall"
              >
                {tr('moduleDetails.uninstall', 'Uninstall')}
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};

export default ModuleDetailsPanel;
