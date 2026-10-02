/**
 * AssetList: a fully controlled list of downloadable assets (voices, modules, packs) with size, progress and
 * Download / Update / Retry / Cancel / Remove actions, plus an "on this device" total. No state of its own; the
 * app maps its asset manager state to rows and handles the callbacks (task 0090).
 */
export type AssetListStatus = 'available' | 'queued' | 'downloading' | 'installed' | 'update-available' | 'error';

export interface AssetListRow {
  id: string;
  title: string;
  /** Plain text, e.g. "Voice · CC-BY-4.0 · unverified". */
  detail?: string;
  status: AssetListStatus;
  sizeBytes: number;
  storedBytes: number;
  progress?: { loaded: number; total: number };
  /** Already localized. */
  error?: string;
  /** Default: status is available, update-available or error. */
  canInstall?: boolean;
  /** Default: status is installed or update-available. */
  canRemove?: boolean;
}

export interface AssetListLabels {
  download: string;
  update: string;
  retry: string;
  cancel: string;
  remove: string;
  queued: string;
  /** `{percent}` is replaced. */
  downloading: string;
  installed: string;
  /** `{size}` is replaced. */
  total: string;
  empty: string;
}

export const DEFAULT_ASSET_LIST_LABELS: AssetListLabels = {
  download: 'Download',
  update: 'Update',
  retry: 'Retry',
  cancel: 'Cancel',
  remove: 'Remove',
  queued: 'Queued',
  downloading: '{percent}%',
  installed: 'Installed',
  total: 'On this device: {size}',
  empty: 'Nothing to download.',
};

export interface AssetListProps {
  rows: readonly AssetListRow[];
  /** Total shown in the footer; default the sum of the rows' `storedBytes`. */
  storedBytes?: number;
  labels?: Partial<AssetListLabels>;
  formatBytes?: (n: number) => string;
  onInstall?: (id: string) => void;
  onCancel?: (id: string) => void;
  onRemove?: (id: string) => void;
}

const UNITS = ['KB', 'MB', 'GB'];

function defaultFormatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 1024) return `${Math.max(0, Math.round(n || 0))} B`;
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${UNITS[i]}`;
}

function percentOf(p: { loaded: number; total: number } | undefined): number | undefined {
  if (!p || !(p.total > 0)) return undefined;
  return Math.max(0, Math.min(100, Math.floor((p.loaded / p.total) * 100)));
}

export function AssetList({ rows, storedBytes, labels, formatBytes = defaultFormatBytes, onInstall, onCancel, onRemove }: AssetListProps) {
  const l: AssetListLabels = { ...DEFAULT_ASSET_LIST_LABELS, ...labels };
  const total = storedBytes ?? rows.reduce((sum, r) => sum + (r.storedBytes || 0), 0);

  if (rows.length === 0) return <p className="kth-asset-list__empty">{l.empty}</p>;

  return (
    <div className="kth-asset-list-wrap">
      <ul className="kth-asset-list">
        {rows.map((r) => {
          const canInstall = r.canInstall ?? (r.status === 'available' || r.status === 'update-available' || r.status === 'error');
          const canRemove = r.canRemove ?? (r.status === 'installed' || r.status === 'update-available');
          const busy = r.status === 'queued' || r.status === 'downloading';
          const pct = percentOf(r.progress);
          const installLabel = r.status === 'error' ? l.retry : r.status === 'update-available' ? l.update : l.download;
          const name = `${installLabel}: ${r.title}`;
          return (
            <li key={r.id} className="kth-asset-list__row">
              <div className="kth-asset-list__info">
                <span className="kth-asset-list__title">{r.title}</span>
                {r.detail ? <span className="kth-asset-list__detail">{r.detail}</span> : null}
                <span className="kth-asset-list__meta">{formatBytes(r.sizeBytes)}</span>
                {r.status === 'installed' ? <span className="kth-asset-list__status">{l.installed}</span> : null}
                {r.status === 'queued' ? <span className="kth-asset-list__status">{l.queued}</span> : null}
                {r.status === 'downloading' ? (
                  <span className="kth-asset-list__status">{pct === undefined ? '…' : l.downloading.replace('{percent}', String(pct))}</span>
                ) : null}
                {r.status === 'downloading' ? (
                  <progress
                    className="kth-asset-list__progress"
                    aria-label={r.title}
                    max={100}
                    {...(pct === undefined ? {} : { value: pct })}
                  />
                ) : null}
                {r.error ? <span className="kth-asset-list__error">{r.error}</span> : null}
              </div>
              <div className="kth-asset-list__actions">
                {canInstall && !busy ? (
                  <button type="button" className="kth-btn kth-btn--sm" aria-label={name} onClick={() => onInstall?.(r.id)}>
                    {installLabel}
                  </button>
                ) : null}
                {busy ? (
                  <button type="button" className="kth-btn kth-btn--sm" aria-label={`${l.cancel}: ${r.title}`} onClick={() => onCancel?.(r.id)}>
                    {l.cancel}
                  </button>
                ) : null}
                {canRemove && !busy ? (
                  <button
                    type="button"
                    className="kth-btn kth-btn--sm kth-btn--danger"
                    aria-label={`${l.remove}: ${r.title}`}
                    onClick={() => onRemove?.(r.id)}
                  >
                    {l.remove}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="kth-asset-list__total">{l.total.replace('{size}', formatBytes(total))}</p>
    </div>
  );
}
