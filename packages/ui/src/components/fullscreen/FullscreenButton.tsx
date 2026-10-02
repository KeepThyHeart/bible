/** The full-screen control every view shows: same icon button, tooltip and labels, at the end of the view's toolbar. */
export interface FullscreenButtonLabels {
  enter: string;
  exit: string;
}

export const DEFAULT_FULLSCREEN_BUTTON_LABELS: FullscreenButtonLabels = { enter: 'Full screen', exit: 'Exit full screen' };

export interface FullscreenButtonProps {
  full: boolean;
  onToggle: () => void;
  labels?: Partial<FullscreenButtonLabels>;
  className?: string;
}

export function FullscreenButton({ full, onToggle, labels, className }: FullscreenButtonProps) {
  const l = { ...DEFAULT_FULLSCREEN_BUTTON_LABELS, ...labels };
  const text = full ? l.exit : l.enter;
  return (
    <button
      type="button"
      className={className ? `kth-btn kth-btn--sm kth-fullscreen-toggle ${className}` : 'kth-btn kth-btn--sm kth-fullscreen-toggle'}
      aria-label={text}
      title={text}
      data-fullscreen={full ? 'on' : 'off'}
      onClick={onToggle}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {full
          ? <path d="M6 1.5v3.5a1 1 0 0 1-1 1H1.5M10 1.5v3.5a1 1 0 0 0 1 1h3.5M6 14.5V11a1 1 0 0 0-1-1H1.5M10 14.5V11a1 1 0 0 1 1-1h3.5" />
          : <path d="M1.5 5.5v-3a1 1 0 0 1 1-1h3M10.5 1.5h3a1 1 0 0 1 1 1v3M14.5 10.5v3a1 1 0 0 1-1 1h-3M5.5 14.5h-3a1 1 0 0 1-1-1v-3" />}
      </svg>
    </button>
  );
}
