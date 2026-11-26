import type { ModuleRow } from '../../stores/module/moduleRows';
import type { ModuleInstallFilter, ModuleType } from '../../stores/module/types';
import type { InstallJob } from '../../stores/module/moduleAPI';
import { filterModuleRows } from './ModuleTable';
import { findRowInstallJob, isRowSelectable } from './ModuleRow';

export { isRowSelectable };

/** A batch above this many bytes asks for confirmation before it starts. */
export const LARGE_BATCH_BYTES = 1024 * 1024 * 1024;

/**
 * The rows a header checkbox / "Install selected" can act on: visible under the
 * current tab, install filter and search text, selectable, and with no install
 * job already queued, running or failed (a failed row has its own Retry).
 */
export function selectableVisibleRows(
  rows: ModuleRow[],
  type: ModuleType,
  installFilter: ModuleInstallFilter,
  searchQuery: string,
  installJobs: readonly InstallJob[]
): ModuleRow[] {
  return filterModuleRows(rows, type, installFilter, searchQuery).filter(
    (row) => isRowSelectable(row) && !findRowInstallJob(row, installJobs as InstallJob[])
  );
}

/** Sum of the catalog download sizes of the given rows (unknown sizes count as 0). */
export function totalDownloadBytes(rows: readonly ModuleRow[]): number {
  return rows.reduce((sum, row) => sum + (row.catalogModule?.download_size_bytes ?? 0), 0);
}

export type BatchSizeCheck = 'ok' | 'large' | 'exceeds-free-space';

/** Whether a batch needs a warning: over free disk space (when known) beats merely large. */
export function checkBatchSize(totalBytes: number, freeBytes: number | null): BatchSizeCheck {
  if (freeBytes !== null && totalBytes > freeBytes) return 'exceeds-free-space';
  if (totalBytes > LARGE_BATCH_BYTES) return 'large';
  return 'ok';
}
