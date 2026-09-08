import React from 'react';

/**
 * The Bible pane's toolbar shape, extracted so the other reading panes can wear
 * it too.
 *
 * Every pane had grown its own toolbar. The Bible pane's is a full-height band
 * of flush cells separated by 2px borders, with `overflow-hidden` so the row
 * never spills out of a narrow pane; Books and Dictionary each had a `flex`
 * strip of rounded hover pills, with a hand-rolled "Aa" box for text settings -
 * five copies of that one button across the app, three different shapes for
 * "go to the previous thing". Same gestures, different furniture, so moving
 * between panes meant re-learning where the controls were and what they looked
 * like.
 *
 * Deliberately not a general design system: the props here are exactly what the
 * reading panes need, and anything more specific (a version selector, a display
 * mode switch) stays in the pane that owns it.
 */

export interface PaneToolbarProps {
  /** Names the toolbar for assistive tech, e.g. "Dictionary pane controls". */
  ariaLabel: string;
  /** Cells pinned to the leading edge - navigation, history. */
  children: React.ReactNode;
  /** Cells pinned to the trailing edge - settings. Omit for a single group. */
  trailing?: React.ReactNode;
  testId?: string;
}

export const PaneToolbar: React.FC<PaneToolbarProps> = ({
  ariaLabel,
  children,
  trailing,
  testId,
}) => (
  <div
    className="flex items-stretch justify-between border-b border-border flex-shrink-0 min-w-0 overflow-hidden"
    style={{ background: 'var(--theme-bg-secondary)', padding: 0 }}
    role="toolbar"
    aria-label={ariaLabel}
    data-testid={testId}
  >
    <div className="flex items-stretch min-w-0 overflow-hidden flex-shrink">{children}</div>
    {trailing && <div className="flex items-stretch flex-shrink-0">{trailing}</div>}
  </div>
);

export interface PaneToolbarButtonProps {
  onClick: () => void;
  /** Both the tooltip and the accessible name - these controls are icon-only. */
  label: string;
  disabled?: boolean;
  /**
   * Which side carries the divider. `end` is the default because the leading
   * group reads left-to-right; the trailing group wants `start`.
   */
  divider?: 'start' | 'end' | 'none';
  /** A thicker rule marks the end of a group of related cells. */
  strongDivider?: boolean;
  testId?: string;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'menu' | 'dialog' | 'true';
  onMouseDown?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}

/**
 * One flush cell in a `PaneToolbar`.
 *
 * `borderRadius: 0` and the full-height padding are what make the band read as
 * one control strip rather than a row of loose buttons - the difference the
 * Bible pane has and the others did not.
 */
export const PaneToolbarButton: React.FC<PaneToolbarButtonProps> = ({
  onClick,
  label,
  disabled = false,
  divider = 'end',
  strongDivider = false,
  testId,
  onMouseDown,
  children,
  ...rest
}) => {
  const rule = `${strongDivider ? 2 : 1}px solid var(--theme-border-primary)`;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
      className="flex items-center px-2.5 hover:bg-background-active disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      style={{
        borderInlineEnd: divider === 'end' ? rule : undefined,
        borderInlineStart: divider === 'start' ? rule : undefined,
        borderRadius: 0,
      }}
      title={label}
      aria-label={label}
      data-testid={testId}
      aria-expanded={rest['aria-expanded']}
      aria-haspopup={rest['aria-haspopup']}
    >
      {children}
    </button>
  );
};

/*
  The icon set the toolbars share. Inline SVG rather than an icon font or a
  dependency: there are six of them, they never change, and the Bible pane drew
  them this way already - these are lifted from it verbatim so the panes match
  pixel for pixel rather than approximately.
*/

const iconProps = {
  className: 'w-4 h-4',
  'aria-hidden': true as const,
  focusable: 'false' as const,
  fill: 'none',
  stroke: 'currentColor',
  viewBox: '0 0 24 24',
};

const strokeProps = {
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 2,
};

/** The Bible pane's Back arrow: an undo-shaped hook, not a plain chevron. */
export const BackIcon: React.FC = () => (
  <svg {...iconProps}>
    <path {...strokeProps} d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
  </svg>
);

/** Back mirrored, for panes that offer an explicit Forward. */
export const ForwardIcon: React.FC = () => (
  <svg {...iconProps}>
    <path {...strokeProps} d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
  </svg>
);

/** A clock: "where have I been", the trail menu. */
export const HistoryIcon: React.FC = () => (
  <svg {...iconProps}>
    <path {...strokeProps} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

/** Previous item in a sequence - a chapter, a book section. */
export const ChevronStartIcon: React.FC = () => (
  <svg {...iconProps}>
    <path {...strokeProps} d="M15 19l-7-7 7-7" />
  </svg>
);

/** Next item in a sequence. */
export const ChevronEndIcon: React.FC = () => (
  <svg {...iconProps}>
    <path {...strokeProps} d="M9 5l7 7-7 7" />
  </svg>
);

/** Up to the parent section. */
export const ChevronUpIcon: React.FC = () => (
  <svg {...iconProps}>
    <path {...strokeProps} d="M5 15l7-7 7 7" />
  </svg>
);
