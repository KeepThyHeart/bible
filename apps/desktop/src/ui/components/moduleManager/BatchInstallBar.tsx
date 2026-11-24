import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleRow } from '../../stores/module/moduleRows';
import { moduleAPI } from '../../stores/module/moduleAPI';
import ConfirmDialog from '../shared/ConfirmDialog';
import { formatFileSize } from './ModuleRow';
import { checkBatchSize, totalDownloadBytes } from './batchInstall';
import type { BatchState } from './useBatchInstall';
import { useTd } from './moduleManagerI18n';

export interface BatchInstallBarProps {
  /** Ticked rows that are visible and installable / updatable right now. */
  selectedRows: ModuleRow[];
  /** Visible rows with an update (shown only under the Updates filter). */
  updateRows: ModuleRow[];
  /** Network access is off: the selection controls are disabled. */
  offline: boolean;
  batch: BatchState | null;
  onStart: (rows: ModuleRow[]) => void;
  onCancel: () => void;
  onDismiss: () => void;
  /** Test seam: free bytes on the modules volume (null = unknown). Default: the main-process IPC. */
  getFreeBytes?: () => Promise<number | null>;
}

async function defaultFreeBytes(): Promise<number | null> {
  try {
    const free = await moduleAPI.getFreeSpace();
    return typeof free === 'number' ? free : null;
  } catch {
    return null;
  }
}

/**
 * Toolbar above the module table: "Install selected (N, size)", "Update all"
 * under the Updates filter, the overall "3 of 12" progress (polite live region)
 * and Cancel. A big batch, or one larger than the free disk space, asks first.
 */
export const BatchInstallBar: React.FC<BatchInstallBarProps> = ({
  selectedRows,
  updateRows,
  offline,
  batch,
  onStart,
  onCancel,
  onDismiss,
  getFreeBytes = defaultFreeBytes,
}) => {
  const td = useTd();
  const [pending, setPending] = useState<{ rows: ModuleRow[]; message: string } | null>(null);
  const checkingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const running = !!batch?.running;

  const begin = useCallback(
    async (rows: ModuleRow[]) => {
      if (rows.length === 0 || checkingRef.current) return;
      checkingRef.current = true;
      try {
        const total = totalDownloadBytes(rows);
        const free = await getFreeBytes();
        if (!mountedRef.current) return;
        const verdict = checkBatchSize(total, free);
        if (verdict === 'ok') {
          onStart(rows);
        } else if (verdict === 'exceeds-free-space') {
          setPending({
            rows,
            message: td(
              'moduleTable.batchConfirmNoSpace',
              'These {count} modules need {size} to download, but only {free} of disk space is free. The installs may fail. Continue anyway?',
              { count: rows.length, size: formatFileSize(total), free: formatFileSize(free ?? 0) }
            ),
          });
        } else {
          setPending({
            rows,
            message: td(
              'moduleTable.batchConfirmLarge',
              'These {count} modules total {size} to download. Continue?',
              { count: rows.length, size: formatFileSize(total) }
            ),
          });
        }
      } finally {
        checkingRef.current = false;
      }
    },
    [getFreeBytes, onStart, td]
  );

  const selectedSize = formatFileSize(totalDownloadBytes(selectedRows));
  const updateSize = formatFileSize(totalDownloadBytes(updateRows));

  const installReason = offline
    ? td('moduleTable.offlineInstallHint', 'Turn on network access to install from the store')
    : running
      ? td('moduleTable.batchReasonRunning', 'A batch is already running.')
      : selectedRows.length === 0
        ? td('moduleTable.batchReasonNone', 'Tick at least one module to install.')
        : '';
  const updateReason = offline
    ? td('moduleTable.offlineInstallHint', 'Turn on network access to install from the store')
    : running
      ? td('moduleTable.batchReasonRunning', 'A batch is already running.')
      : '';

  let progressText = '';
  if (batch) {
    const settled = batch.done + batch.failed + batch.cancelled;
    progressText = td('moduleTable.batchProgress', '{done} of {total} done', { done: batch.done, total: batch.total });
    if (batch.failed > 0) progressText += `, ${td('moduleTable.batchFailed', '{count} failed', { count: batch.failed })}`;
    if (batch.cancelled > 0) progressText += `, ${td('moduleTable.batchCancelled', '{count} cancelled', { count: batch.cancelled })}`;
    if (!batch.running && settled >= batch.total) {
      progressText = `${td('moduleTable.batchFinished', 'Finished.')} ${progressText}`;
    }
  }

  const btn =
    'px-3 py-1.5 text-sm font-medium rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div className="px-6 py-2 border-b border-border flex flex-wrap items-center gap-3" data-testid="module-batch-bar">
      <button
        type="button"
        data-testid="module-batch-install"
        onClick={() => void begin(selectedRows)}
        disabled={!!installReason}
        title={installReason || undefined}
        aria-describedby={installReason ? 'module-batch-install-reason' : undefined}
        className={`${btn} text-text-on-accent bg-accent hover:bg-accent-hover`}
      >
        {td('moduleTable.batchInstallSelected', 'Install selected ({count}, {size})', {
          count: selectedRows.length,
          size: selectedSize,
        })}
      </button>
      <span id="module-batch-install-reason" className="sr-only">
        {installReason}
      </span>
      {updateRows.length > 0 && (
        <>
          <button
            type="button"
            data-testid="module-batch-update-all"
            onClick={() => void begin(updateRows)}
            disabled={!!updateReason}
            title={updateReason || undefined}
            aria-describedby={updateReason ? 'module-batch-update-reason' : undefined}
            className={`${btn} text-text-on-accent bg-warning hover:bg-warning/90`}
          >
            {td('moduleTable.batchUpdateAll', 'Update all ({count}, {size})', {
              count: updateRows.length,
              size: updateSize,
            })}
          </button>
          <span id="module-batch-update-reason" className="sr-only">
            {updateReason}
          </span>
        </>
      )}
      {running && (
        <button
          type="button"
          data-testid="module-batch-cancel"
          onClick={onCancel}
          className={`${btn} text-text-primary border border-border hover:bg-background-hover`}
        >
          {td('moduleTable.batchCancel', 'Cancel remaining')}
        </button>
      )}
      <div role="status" aria-live="polite" data-testid="module-batch-progress" className="text-sm text-text-secondary">
        {progressText}
      </div>
      {batch && !batch.running && (
        <button
          type="button"
          data-testid="module-batch-dismiss"
          onClick={onDismiss}
          className={`${btn} text-text-secondary hover:bg-background-hover`}
        >
          {td('moduleTable.batchDismiss', 'Dismiss')}
        </button>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={td('moduleTable.batchConfirmTitle', 'Start these downloads?')}
        message={pending?.message ?? ''}
        confirmLabel={td('moduleTable.batchConfirmStart', 'Start downloads')}
        onConfirm={() => {
          const rows = pending?.rows ?? [];
          setPending(null);
          onStart(rows);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};

export default BatchInstallBar;
