import { DEFAULT_SYNC_STATUS_LABELS } from './labels';
import type { SyncStatusBadgeProps } from './types';
import { fill, formatDateTime } from './util';

const STATE_KEY = {
  'signed-out': 'signedOut', locked: 'locked', idle: 'idle', syncing: 'syncing', offline: 'offline', error: 'error',
} as const;

export function SyncStatusBadge({ status, onClick, labels }: SyncStatusBadgeProps) {
  const l = { ...DEFAULT_SYNC_STATUS_LABELS, ...labels };
  const text = l[STATE_KEY[status.state]];
  const pending = status.state !== 'signed-out' && status.pending > 0 ? fill(l.pending, { n: status.pending }) : null;
  const last = status.lastSyncedAt ? fill(l.lastSynced, { time: formatDateTime(status.lastSyncedAt) }) : undefined;
  const cls = `kth-account__badge kth-account__badge--${status.state}`;
  const body = (
    <>
      <span className={`kth-account__badge-dot kth-account__badge-dot--${status.state}`} aria-hidden="true" />
      <span>{text}</span>
      {pending ? <span className="kth-account__badge-pending">{pending}</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} title={last} onClick={onClick}>{body}</button>
  ) : (
    <span className={cls} title={last} role="status">{body}</span>
  );
}
