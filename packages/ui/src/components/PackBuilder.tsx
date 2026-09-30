/**
 * PackBuilder: a fully controlled offline-pack picker (task 0075). Preset chips, rows grouped by `groups`,
 * a storage summary with a fit indicator, warnings, Start / Cancel and run progress. No state of its own and
 * no app imports; the app maps its pack planner and downloader state to props and handles the callbacks.
 * Every visible string comes from `labels`.
 */
export type PackBuilderStatus = 'absent' | 'installed' | 'update-available' | 'installing' | 'error';

export interface PackBuilderRow {
  key: string;
  title: string;
  detail?: string;
  /** Id of one of the `groups`. Rows with an unknown group are not shown. */
  group: string;
  sizeBytes: number;
  status: PackBuilderStatus;
  selected: boolean;
  disabled?: boolean;
  /** Already localized; shown when `disabled`. */
  disabledReason?: string;
  progress?: { loaded: number; total: number };
  /** Already localized. */
  error?: string;
}

export interface PackBuilderSummary {
  downloadBytes: number;
  newStoredBytes: number;
  freeBytes: number | null;
  fit: 'fits' | 'tight' | 'no' | 'unknown';
  shortfallBytes: number;
}

export type PackBuilderRunState = 'idle' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled';

export interface PackBuilderRun {
  state: PackBuilderRunState;
  done: number;
  total: number;
  loadedBytes: number;
  totalBytes: number;
}

export interface PackBuilderLabels {
  title: string;
  presetsHeading: string;
  groupsHeading: string;
  empty: string;
  statusAbsent: string;
  statusInstalled: string;
  statusUpdate: string;
  statusInstalling: string;
  statusError: string;
  start: string;
  cancel: string;
  /** `{size}` is replaced. */
  summaryDownload: string;
  /** `{size}` is replaced. */
  summaryStored: string;
  /** `{size}` is replaced. */
  summaryFree: string;
  summaryFreeUnknown: string;
  fitFits: string;
  fitTight: string;
  /** `{size}` (the shortfall) is replaced. */
  fitNo: string;
  fitUnknown: string;
  /** Accessible name of the storage bar. */
  storageBarLabel: string;
  /** Accessible name of the overall progress bar. */
  runProgressLabel: string;
  /** `{done}` and `{total}` are replaced. */
  runCount: string;
  /** `{loaded}` and `{total}` are replaced. */
  runBytes: string;
  runRunning: string;
  runDone: string;
  runPartial: string;
  runFailed: string;
  runCancelled: string;
}

export interface PackBuilderProps {
  groups: { id: string; label: string }[];
  rows: readonly PackBuilderRow[];
  presets: { id: string; label: string }[];
  onPreset: (id: string) => void;
  onToggle: (key: string, selected: boolean) => void;
  summary: PackBuilderSummary;
  warnings: string[];
  run?: PackBuilderRun;
  onStart: () => void;
  onCancel: () => void;
  labels: PackBuilderLabels;
  formatBytes: (n: number) => string;
}

function percentOf(loaded: number, total: number): number | undefined {
  if (!(total > 0)) return undefined;
  return Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)));
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? (values[k] as string) : m));
}

function Bar({ label, percent, tone }: { label: string; percent: number | undefined; tone?: string }) {
  const cls = tone ? `kth-pack-bar kth-pack-bar--${tone}` : 'kth-pack-bar';
  if (percent === undefined) {
    return <div className={`${cls} kth-pack-bar--indeterminate`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} />;
  }
  return (
    <div className={cls} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div className="kth-pack-bar__fill" style={{ inlineSize: `${percent}%` }} />
    </div>
  );
}

export function PackBuilder({
  groups,
  rows,
  presets,
  onPreset,
  onToggle,
  summary,
  warnings,
  run,
  onStart,
  onCancel,
  labels: l,
  formatBytes,
}: PackBuilderProps) {
  const running = run?.state === 'running';
  const anySelected = rows.some((r) => r.selected && !r.disabled);
  const startDisabled = running || summary.fit === 'no' || !anySelected;

  const statusText: Record<PackBuilderStatus, string> = {
    absent: l.statusAbsent,
    installed: l.statusInstalled,
    'update-available': l.statusUpdate,
    installing: l.statusInstalling,
    error: l.statusError,
  };

  const fitText =
    summary.fit === 'fits'
      ? l.fitFits
      : summary.fit === 'tight'
        ? l.fitTight
        : summary.fit === 'no'
          ? fill(l.fitNo, { size: formatBytes(summary.shortfallBytes) })
          : l.fitUnknown;

  const free = summary.freeBytes;
  const storagePct = free !== null && free > 0 ? Math.min(100, Math.floor((summary.newStoredBytes / free) * 100)) : free === 0 ? 100 : undefined;

  const runResult =
    run?.state === 'done'
      ? l.runDone
      : run?.state === 'partial'
        ? l.runPartial
        : run?.state === 'failed'
          ? l.runFailed
          : run?.state === 'cancelled'
            ? l.runCancelled
            : '';

  const visibleGroups = groups.filter((g) => rows.some((r) => r.group === g.id));

  return (
    <section className="kth-pack-builder" aria-label={l.title}>
      <h2 className="kth-pack-builder__title">{l.title}</h2>

      {presets.length > 0 ? (
        <div className="kth-pack-builder__presets" role="group" aria-label={l.presetsHeading}>
          <span className="kth-pack-builder__heading">{l.presetsHeading}</span>
          {presets.map((p) => (
            <button key={p.id} type="button" className="kth-pack-chip" disabled={running} onClick={() => onPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      ) : null}

      {visibleGroups.length === 0 ? <p className="kth-pack-builder__empty">{l.empty}</p> : null}

      {visibleGroups.map((g) => (
        <fieldset key={g.id} className="kth-pack-group">
          <legend className="kth-pack-group__label">{g.label}</legend>
          <ul className="kth-pack-list">
            {rows
              .filter((r) => r.group === g.id)
              .map((r) => {
                const inputId = `kth-pack-${r.key}`;
                const installed = r.status === 'installed';
                const pct = r.progress ? percentOf(r.progress.loaded, r.progress.total) : undefined;
                return (
                  <li key={r.key} className={`kth-pack-row kth-pack-row--${r.status}`}>
                    <input
                      id={inputId}
                      type="checkbox"
                      className="kth-pack-row__check"
                      checked={r.selected || (installed && !r.disabled)}
                      disabled={r.disabled || running || (installed && !r.selected)}
                      onChange={(e) => onToggle(r.key, e.currentTarget.checked)}
                    />
                    <label htmlFor={inputId} className="kth-pack-row__info">
                      <span className="kth-pack-row__title">{r.title}</span>
                      {r.detail ? <span className="kth-pack-row__detail">{r.detail}</span> : null}
                    </label>
                    <span className="kth-pack-row__size">{formatBytes(r.sizeBytes)}</span>
                    <span className={`kth-pack-badge kth-pack-badge--${r.status}`}>{statusText[r.status]}</span>
                    {r.disabled && r.disabledReason ? <span className="kth-pack-row__reason">{r.disabledReason}</span> : null}
                    {r.status === 'installing' ? <Bar label={r.title} percent={pct} /> : null}
                    {r.error ? <span className="kth-pack-row__error">{r.error}</span> : null}
                  </li>
                );
              })}
          </ul>
        </fieldset>
      ))}

      <div className="kth-pack-summary">
        <span className="kth-pack-summary__item">{fill(l.summaryDownload, { size: formatBytes(summary.downloadBytes) })}</span>
        <span className="kth-pack-summary__item">{fill(l.summaryStored, { size: formatBytes(summary.newStoredBytes) })}</span>
        <span className="kth-pack-summary__item">
          {free === null ? l.summaryFreeUnknown : fill(l.summaryFree, { size: formatBytes(free) })}
        </span>
        {storagePct !== undefined ? (
          <div
            className={`kth-pack-bar kth-pack-bar--${summary.fit}`}
            role="progressbar"
            aria-label={l.storageBarLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={storagePct}
          >
            <div className="kth-pack-bar__fill" style={{ inlineSize: `${storagePct}%` }} />
          </div>
        ) : null}
        <span className={`kth-pack-summary__fit kth-pack-summary__fit--${summary.fit}`}>{fitText}</span>
      </div>

      {warnings.length > 0 ? (
        <ul className="kth-pack-warnings" role="status">
          {warnings.map((w, i) => (
            <li key={i} className="kth-pack-warnings__item">
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="kth-pack-actions">
        <button type="button" className="kth-btn kth-btn--primary" disabled={startDisabled} onClick={onStart}>
          {l.start}
        </button>
        {running ? (
          <button type="button" className="kth-btn" onClick={onCancel}>
            {l.cancel}
          </button>
        ) : null}
      </div>

      {run && run.state !== 'idle' ? (
        <div className="kth-pack-run" role="status" aria-live="polite">
          {running ? (
            <>
              <span className="kth-pack-run__text">{l.runRunning}</span>
              <Bar label={l.runProgressLabel} percent={percentOf(run.loadedBytes, run.totalBytes) ?? percentOf(run.done, run.total)} />
              <span className="kth-pack-run__count">{fill(l.runCount, { done: String(run.done), total: String(run.total) })}</span>
              <span className="kth-pack-run__bytes">
                {fill(l.runBytes, { loaded: formatBytes(run.loadedBytes), total: formatBytes(run.totalBytes) })}
              </span>
            </>
          ) : (
            <span className={`kth-pack-run__result kth-pack-run__result--${run.state}`}>{runResult}</span>
          )}
        </div>
      ) : null}
    </section>
  );
}
