/**
 * ProgressRing: one percentage as a small ring (a thin arc on a gray track) with the value in the middle.
 * A meter, not a chart: one value, one hue, no hover layer. The value and any text beside it stay in text colours.
 */
export interface ProgressRingProps {
  /** 0..100 (clamped). */
  value: number;
  /** Accessible name, e.g. "Gospels: progress". */
  label: string;
  /** Text in the middle, e.g. "42%". Default: the rounded value with "%". */
  valueText?: string;
  /** 'sm' about 2.75rem, 'md' about 3.5rem across. Default 'md'. */
  size?: 'sm' | 'md';
  tone?: 'accent' | 'success';
  className?: string;
}

const R = 15.5; // in a 36-unit view box, leaving room for the stroke
const C = 2 * Math.PI * R;

export function ProgressRing({ value, label, valueText, size = 'md', tone = 'accent', className }: ProgressRingProps) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  const text = valueText ?? `${Math.round(pct)}%`;
  const root = className ? `kth-progress-ring ${className}` : 'kth-progress-ring';
  return (
    <div
      className={root}
      data-size={size}
      data-tone={tone}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={text}
      aria-label={label}
    >
      <svg className="kth-progress-ring__svg" viewBox="0 0 36 36" aria-hidden="true" focusable="false">
        <circle className="kth-progress-ring__track" cx="18" cy="18" r={R} />
        {pct > 0 ? (
          <circle
            className="kth-progress-ring__fill"
            cx="18"
            cy="18"
            r={R}
            strokeDasharray={`${(pct / 100) * C} ${C}`}
            transform="rotate(-90 18 18)"
          />
        ) : null}
      </svg>
      <span className="kth-progress-ring__value" aria-hidden="true">{text}</span>
    </div>
  );
}
