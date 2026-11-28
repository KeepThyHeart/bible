import type { ReactNode } from 'react';
import { ProgressRing, type ProgressRingProps } from './ProgressRing';

/**
 * ProgressTile: a small card with a ProgressRing beside a title and a one-line status, for a row of
 * per-item progress (reading plans, memory sets). Markup (shared with DOM-built apps, see kth-classes.css):
 *
 *   li.kth-card.kth-progress-tile
 *     div.kth-progress-ring ...
 *     div.kth-progress-tile__body
 *       button.kth-link.kth-progress-tile__title | span.kth-progress-tile__title
 *       span.kth-progress-tile__status[data-tone]   (warning: a leading aria-hidden "⚠ ")
 *       div.kth-progress-tile__actions              (optional)
 *
 * Render tiles inside ProgressTiles (the ul).
 */
export type ProgressTileTone = 'muted' | 'warning' | 'success';

export interface ProgressTileProps {
  /** 0..100 (clamped by the ring). */
  value: number;
  /** Accessible name of the ring, e.g. "Gospels: progress". */
  ringLabel: string;
  /** Text in the ring. Default: the rounded value with "%". */
  valueText?: string;
  ringTone?: ProgressRingProps['tone'];
  ringSize?: ProgressRingProps['size'];
  /** The name. A string also becomes the hover title, since a long one is truncated. */
  title: ReactNode;
  /** When set, the title is a link-styled button that calls this. */
  onTitleClick?: () => void;
  status?: ReactNode;
  /** Default 'muted'. 'warning' adds a leading ⚠ (hidden from screen readers). */
  statusTone?: ProgressTileTone;
  /** Small buttons in a row under the status. */
  actions?: ReactNode;
  testId?: string;
  className?: string;
}

export function ProgressTile({
  value, ringLabel, valueText, ringTone, ringSize, title, onTitleClick, status, statusTone = 'muted', actions, testId, className,
}: ProgressTileProps) {
  const hover = typeof title === 'string' ? title : undefined;
  return (
    <li className={className ? `kth-card kth-progress-tile ${className}` : 'kth-card kth-progress-tile'} data-testid={testId}>
      <ProgressRing value={value} label={ringLabel} valueText={valueText} tone={ringTone} size={ringSize} />
      <div className="kth-progress-tile__body">
        {onTitleClick ? (
          <button type="button" className="kth-link kth-progress-tile__title" title={hover} onClick={onTitleClick}>{title}</button>
        ) : (
          <span className="kth-progress-tile__title" title={hover}>{title}</span>
        )}
        {status != null && status !== false ? (
          <span className="kth-progress-tile__status" data-tone={statusTone}>
            {statusTone === 'warning' ? <span aria-hidden="true">{'⚠ '}</span> : null}
            {status}
          </span>
        ) : null}
        {actions ? <div className="kth-progress-tile__actions">{actions}</div> : null}
      </div>
    </li>
  );
}

export interface ProgressTilesProps {
  /** Accessible name of the list, e.g. "Progress". */
  'aria-label': string;
  children: ReactNode;
  testId?: string;
  className?: string;
}

/** The ul that lays ProgressTile cards out in a wrapping row. */
export function ProgressTiles({ 'aria-label': ariaLabel, children, testId, className }: ProgressTilesProps) {
  return (
    <ul className={className ? `kth-progress-tiles ${className}` : 'kth-progress-tiles'} aria-label={ariaLabel} data-testid={testId}>
      {children}
    </ul>
  );
}
