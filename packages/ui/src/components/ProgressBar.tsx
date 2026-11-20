export interface ProgressBarProps {
  /** 0..100 (clamped). */
  value: number;
  /** Accessible name. */
  label: string;
  /** Text shown after the bar, e.g. "12%". */
  valueText?: string;
  tone?: 'accent' | 'success';
  className?: string;
}

/** A thin progress bar with an optional value text. */
export function ProgressBar(props: ProgressBarProps) {
  const { value, label, valueText, tone = 'accent', className } = props;
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  const root = className ? `kth-progress ${className}` : 'kth-progress';
  return (
    <div className={root}>
      <div className="kth-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        <div
          className={tone === 'success' ? 'kth-progress__fill kth-progress__fill--success' : 'kth-progress__fill'}
          style={{ inlineSize: `${pct}%` }}
        />
      </div>
      {valueText ? <span className="kth-progress__value">{valueText}</span> : null}
    </div>
  );
}
