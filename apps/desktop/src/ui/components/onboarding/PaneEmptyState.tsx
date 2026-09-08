import React from 'react';

/**
 * A single call-to-action inside a pane empty state.
 *
 * `label` is already-resolved display text - every call site resolves it
 * through `tf()` so the whole sentence stays one catalog message.
 */
export interface PaneEmptyStateAction {
  label: string;
  onClick: () => void;
  /** Renders as the filled primary button. Exactly one action should set it. */
  primary?: boolean;
  /** Optional test hook. */
  testId?: string;
}

export interface PaneEmptyStateProps {
  /**
   * Decorative glyph. Purely ornamental - it is hidden from assistive tech, so
   * it must never be the only carrier of meaning.
   */
  icon?: string;
  /** Short headline naming what this pane holds. One complete phrase. */
  title: string;
  /**
   * One or two complete sentences explaining what the pane is for and why the
   * user might want it. Written for someone who has never used Bible software.
   */
  description: string;
  /** Optional third line: a concrete example, kept visually quieter. */
  hint?: string;
  /** Zero or more actions. The first primary one gets the filled treatment. */
  actions?: PaneEmptyStateAction[];
  /** Test hook for the container. */
  testId?: string;
}

/**
 * The empty state a pane shows when it holds nothing yet.
 *
 * This is the load-bearing piece of onboarding: it teaches at the exact moment
 * of confusion, is free for users who already know, and never has to be
 * dismissed.
 *
 * Layout rules: logical properties only (`ps`/`pe`/`ms`/`me`/`text-start`), and
 * colours come from semantic theme tokens so light, dark and sepia all work.
 */
const PaneEmptyState: React.FC<PaneEmptyStateProps> = ({
  icon,
  title,
  description,
  hint,
  actions,
  testId,
}) => (
  <div
    className="flex flex-col items-center justify-center h-full w-full px-lg py-xl text-center"
    data-testid={testId ?? 'pane-empty-state'}
  >
    <div className="max-w-md flex flex-col items-center">
      {icon && (
        <span aria-hidden="true" className="text-4xl mb-md leading-none select-none">
          {icon}
        </span>
      )}

      <h2 className="text-lg font-semibold text-text-heading mb-sm">{title}</h2>

      <p className="text-sm text-text-secondary leading-relaxed mb-md">{description}</p>

      {hint && <p className="text-xs text-text-muted leading-relaxed mb-md">{hint}</p>}

      {actions && actions.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-sm">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              data-testid={action.testId}
              className={
                action.primary
                  ? 'px-lg py-sm rounded bg-accent text-text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 transition-colors'
                  : 'px-lg py-sm rounded bg-control text-control-text border border-border hover:bg-control-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 transition-colors'
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
);

export default PaneEmptyState;
