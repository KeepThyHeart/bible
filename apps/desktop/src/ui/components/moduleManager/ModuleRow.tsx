import React from 'react';
import type { ModuleRow } from '../../stores/module/moduleRows';
import type { DownloadProgress } from '../../stores/module/types';
import { useTd } from './moduleManagerI18n';
import { ProgressRing } from '../shared/ProgressRing';

/** Human-readable byte size ("12.5 MB"); an unknown/zero size renders as an em dash. */
export function formatFileSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${units[i]}`;
}

/**
 * The in-flight (not yet completed) download for a row, if any. A download is
 * keyed by the catalog module id, which for an installed module being updated
 * differs from its numeric installed id - so both are tried.
 */
export function findRowDownload(row: ModuleRow, downloads: DownloadProgress[]): DownloadProgress | undefined {
  const ids = new Set<string>([String(row.module_id)]);
  if (row.catalogModule) ids.add(String(row.catalogModule.module_id));
  return downloads.find(d => d.status !== 'completed' && ids.has(String(d.moduleId)));
}

export type ModuleRowStatus = 'installed' | 'update' | 'available';

export function getRowStatus(row: ModuleRow): ModuleRowStatus {
  if (!row.installed) return 'available';
  return row.updateAvailable ? 'update' : 'installed';
}

export interface ModuleTableRowProps {
  row: ModuleRow;
  selected: boolean;
  /** An install/update/uninstall for this row is in flight. */
  busy?: boolean;
  /** Network access is off - downloading actions are disabled. */
  offline?: boolean;
  /** Active downloads for this row, if any. */
  activeDownload?: DownloadProgress;
  onSelect: (row: ModuleRow) => void;
  onInstall: (row: ModuleRow) => void;
  onUpdate: (row: ModuleRow) => void;
}

/**
 * One compact table row (named `ModuleTableRow` because `ModuleRow` is the row
 * *model* type from `stores/module/moduleRows`). Clicking anywhere on the row
 * selects it; the Install/Update button in the status cell stops propagation so
 * it never also selects the row.
 */
export const ModuleTableRow: React.FC<ModuleTableRowProps> = ({
  row,
  selected,
  busy = false,
  offline = false,
  activeDownload,
  onSelect,
  onInstall,
  onUpdate,
}) => {
  const td = useTd();
  const status = getRowStatus(row);
  const abbrev = row.abbreviation;

  const installedVersion = row.installedModule?.version;
  const catalogVersion = row.catalogModule?.version;
  const versionText =
    status === 'update' && installedVersion && catalogVersion && installedVersion !== catalogVersion
      ? `${installedVersion} → ${catalogVersion}`
      : (installedVersion ?? catalogVersion ?? '—');

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  // A download in progress also disables the action button
  const hasActiveDownload = activeDownload && activeDownload.status !== 'completed';
  const actionDisabled = busy || offline || hasActiveDownload;
  const actionTitle = offline ? td('moduleTable.offlineHint', 'Network access is off') : undefined;

  return (
    <tr
      data-testid={`module-row-${abbrev}`}
      data-selected={selected ? 'true' : 'false'}
      onClick={() => onSelect(row)}
      className={`cursor-pointer border-b border-border transition-colors ${
        selected ? 'bg-accent-soft' : 'hover:bg-background-hover'
      }`}
    >
      <td className="px-4 py-2 align-middle">
        <button
          type="button"
          aria-current={selected ? 'true' : undefined}
          className="text-start block w-full min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
        >
          <span className="block text-sm font-medium text-text-heading break-words">
            {row.name}
            {row.catalogModule?.recommended && (
              <span className="ms-2 align-middle text-xs px-1.5 py-0.5 bg-success-soft text-success-text rounded">
                {td('moduleCard.recommended', 'Recommended')}
              </span>
            )}
          </span>
          <span className="block text-xs text-text-secondary font-mono">{abbrev}</span>
        </button>
      </td>
      <td className="px-4 py-2 text-sm text-text-secondary whitespace-nowrap">
        {row.language_code ? row.language_code.toUpperCase() : '—'}
      </td>
      <td className="px-4 py-2 text-sm text-text-secondary whitespace-nowrap">{versionText}</td>
      <td className="px-4 py-2 text-sm text-text-secondary whitespace-nowrap">
        {formatFileSize(row.catalogModule?.download_size_bytes)}
      </td>
      <td className="px-4 py-2 text-sm whitespace-nowrap" data-testid={`module-row-status-${abbrev}`} data-status={status}>
        <div className="flex items-center justify-end gap-2">
          {/* Per-row download progress ring */}
          <span data-testid={`module-row-progress-${abbrev}`} className="inline-flex items-center">
            {activeDownload && (
              <>
                {activeDownload.status === 'failed' ? (
                  <span
                    role="img"
                    aria-label={td('moduleTable.downloadFailed', 'Download failed')}
                    title={td('moduleTable.downloadFailed', 'Download failed')}
                    className="text-danger text-lg leading-none"
                  >
                    ✕
                  </span>
                ) : activeDownload.status === 'paused' ? (
                  <span
                    role="img"
                    aria-label={td('moduleTable.downloadPaused', 'Paused')}
                    title={td('moduleTable.downloadPaused', 'Paused')}
                    className="text-warning text-lg leading-none"
                  >
                    ⏸
                  </span>
                ) : (
                  <ProgressRing
                    percent={
                      activeDownload.totalBytes && activeDownload.totalBytes > 0
                        ? Math.round((activeDownload.progressBytes / activeDownload.totalBytes) * 100)
                        : undefined
                    }
                    size="small"
                    ariaLabel={
                      activeDownload.totalBytes && activeDownload.totalBytes > 0
                        ? td('moduleTable.downloadProgressAria', 'Downloading {name}: {percent}%', {
                            name: row.name,
                            percent: Math.round((activeDownload.progressBytes / activeDownload.totalBytes) * 100),
                          })
                        : td('moduleTable.downloadingAria', 'Downloading {name}', {
                            name: row.name,
                          })
                    }
                  />
                )}
              </>
            )}
          </span>
          {status === 'installed' && !hasActiveDownload && (
            <span className="text-success-text">{td('moduleCard.installed', 'Installed')}</span>
          )}
          {status === 'update' && !hasActiveDownload && (
            <>
              <span className="text-warning-text">{td('moduleCard.updateAvailable', 'Update available')}</span>
              <button
                type="button"
                data-testid={`module-row-update-${abbrev}`}
                onClick={(e) => {
                  stop(e);
                  onUpdate(row);
                }}
                disabled={actionDisabled}
                title={actionTitle}
                aria-label={td('moduleTable.updateAria', 'Update {name}', { name: row.name })}
                className="px-2 py-0.5 text-xs font-medium text-text-on-accent bg-warning rounded hover:bg-warning/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? td('moduleCard.updating', 'Updating...') : td('moduleCard.update', 'Update')}
              </button>
            </>
          )}
          {status === 'available' && !hasActiveDownload && (
            <>
              <span className="text-text-tertiary">{td('moduleTable.notInstalled', 'Not installed')}</span>
              <button
                type="button"
                data-testid={`module-row-install-${abbrev}`}
                onClick={(e) => {
                  stop(e);
                  onInstall(row);
                }}
                disabled={actionDisabled}
                title={actionTitle}
                aria-label={td('moduleTable.installAria', 'Install {name}', { name: row.name })}
                className="px-2 py-0.5 text-xs font-medium text-text-on-accent bg-accent rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? td('moduleCard.installing', 'Installing...') : td('moduleCard.install', 'Install')}
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
};

export default ModuleTableRow;
