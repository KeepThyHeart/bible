import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { InstallJob } from '../../stores/module/moduleAPI';
import { ProgressRing } from '../shared/ProgressRing';
import { useTd } from './moduleManagerI18n';
import { formatFileSize } from './ModuleRow';

export interface InstallProgressCellProps {
  job: InstallJob;
  /** Display name, for accessible labels. */
  name: string;
  abbreviation: string;
  onCancel: (jobId: number) => void;
  onRetry: (jobId: number) => void;
  onDismiss: (jobId: number) => void;
}

const STAGE_LABELS: Record<InstallJob['stage'], { key: string; fallback: string }> = {
  queued: { key: 'installProgress.stage.queued', fallback: 'Waiting to start' },
  downloading: { key: 'installProgress.stage.downloading', fallback: 'Downloading' },
  verifying: { key: 'installProgress.stage.verifying', fallback: 'Checking the download' },
  installing: { key: 'installProgress.stage.installing', fallback: 'Installing' },
  done: { key: 'installProgress.stage.done', fallback: 'Installed' },
  failed: { key: 'installProgress.stage.failed', fallback: 'Failed' },
  cancelled: { key: 'installProgress.stage.cancelled', fallback: 'Cancelled' },
};

/**
 * The quiet install indicator that lives in a module's own row: a small
 * progress circle (click it for stage, percent, bytes and Cancel), or, when the
 * install failed, the error text with a Retry button.
 */
export const InstallProgressCell: React.FC<InstallProgressCellProps> = ({
  job,
  name,
  abbreviation,
  onCancel,
  onRetry,
  onDismiss,
}) => {
  const td = useTd();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  // The popover is portalled to <body> so the table's scroll container cannot clip it.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const width = 260;
    setPos({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const stage = STAGE_LABELS[job.stage];
  const stageText = td(stage.key, stage.fallback);
  const failed = job.stage === 'failed';
  const canCancel = job.stage === 'queued' || job.stage === 'downloading';
  const percentText = typeof job.percent === 'number' ? `${job.percent}%` : '';

  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={td('installProgress.detailsAria', 'Install details for {name}', { name })}
          data-testid={`install-popover-${abbreviation}`}
          style={{ position: 'fixed', top: pos?.top ?? 0, left: pos?.left ?? 0, width: 260, zIndex: 10000 }}
          className="rounded border border-border bg-surface p-3 text-xs shadow-lg"
          onClick={stop}
        >
          <div className="mb-1 text-sm font-medium text-text-heading break-words">{name}</div>
          <dl className="space-y-0.5 text-text-secondary">
            <div className="flex justify-between gap-2">
              <dt>{td('installProgress.stage', 'Stage')}</dt>
              <dd data-testid="install-popover-stage">{stageText}</dd>
            </div>
            {!failed && (
              <div className="flex justify-between gap-2">
                <dt>{td('installProgress.progress', 'Progress')}</dt>
                <dd data-testid="install-popover-percent">{percentText || '—'}</dd>
              </div>
            )}
            {job.bytesDone > 0 && (
              <div className="flex justify-between gap-2">
                <dt>{td('installProgress.bytes', 'Downloaded')}</dt>
                <dd data-testid="install-popover-bytes">
                  {formatFileSize(job.bytesDone)}
                  {job.bytesTotal ? ` / ${formatFileSize(job.bytesTotal)}` : ''}
                </dd>
              </div>
            )}
            {job.stage === 'downloading' && job.speedBps ? (
              <div className="flex justify-between gap-2">
                <dt>{td('installProgress.speed', 'Speed')}</dt>
                <dd>{formatFileSize(job.speedBps)}/s</dd>
              </div>
            ) : null}
          </dl>
          {failed && job.error && (
            <p className="mt-2 break-words text-danger" role="alert" data-testid="install-popover-error">
              {job.error}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            {failed ? (
              <>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5 text-text-primary hover:bg-surface-hover"
                  onClick={() => {
                    setOpen(false);
                    onDismiss(job.jobId);
                  }}
                >
                  {td('installProgress.dismiss', 'Dismiss')}
                </button>
                <button
                  type="button"
                  className="rounded bg-accent px-2 py-0.5 text-text-on-accent hover:bg-accent-hover"
                  onClick={() => {
                    setOpen(false);
                    onRetry(job.jobId);
                  }}
                >
                  {td('installProgress.retry', 'Retry')}
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="install-popover-cancel"
                disabled={!canCancel}
                title={canCancel ? undefined : td('installProgress.cannotCancel', 'Almost done; this step cannot be cancelled')}
                className="rounded border border-border px-2 py-0.5 text-text-primary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setOpen(false);
                  onCancel(job.jobId);
                }}
              >
                {td('installProgress.cancel', 'Cancel')}
              </button>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  if (job.stage === 'done') {
    return <span className="text-success-text">{td('moduleCard.installed', 'Installed')}</span>;
  }

  if (failed) {
    const short = job.error && job.error.length > 40 ? `${job.error.slice(0, 40)}…` : (job.error ?? '');
    return (
      <span className="inline-flex items-center gap-2" data-testid={`module-row-install-${abbreviation}-failed`}>
        <button
          ref={anchorRef}
          type="button"
          onClick={(e) => {
            stop(e);
            setOpen((v) => !v);
          }}
          title={job.error}
          aria-label={td('installProgress.failedAria', 'Install of {name} failed: {error}', { name, error: job.error ?? '' })}
          className="max-w-[16rem] truncate text-xs text-danger hover:underline"
        >
          ✕ {short || td('installProgress.failed', 'Install failed')}
        </button>
        <button
          type="button"
          data-testid={`module-row-retry-${abbreviation}`}
          onClick={(e) => {
            stop(e);
            onRetry(job.jobId);
          }}
          className="rounded bg-accent px-2 py-0.5 text-xs font-medium text-text-on-accent transition-colors hover:bg-accent-hover"
        >
          {td('installProgress.retry', 'Retry')}
        </button>
        {popover}
      </span>
    );
  }

  const ariaLabel =
    typeof job.percent === 'number'
      ? td('installProgress.ringAriaPercent', '{stage} {name}: {percent}%', { stage: stageText, name, percent: job.percent })
      : td('installProgress.ringAria', '{stage} {name}', { stage: stageText, name });

  return (
    <span className="inline-flex items-center" data-testid={`module-row-install-progress-${abbreviation}`}>
      <button
        ref={anchorRef}
        type="button"
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={`${stageText}${percentText ? ` ${percentText}` : ''}`}
        data-testid={`module-row-install-ring-${abbreviation}`}
        className="inline-flex items-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ProgressRing size="small" percent={job.stage === 'downloading' ? job.percent : undefined} ariaLabel={ariaLabel} />
      </button>
      {popover}
    </span>
  );
};

export default InstallProgressCell;
