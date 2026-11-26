import type { ReactNode } from 'react';
import { AppBadge } from './AppBadge';
import type { AppNavBadge } from './types';

/** The most urgent badge among the apps other than the one on screen. */
export function aggregateBadge(
  entries: readonly { id: string; badge?: AppNavBadge }[],
  activeId: string | null,
): AppNavBadge | undefined {
  const rank = { attention: 2, live: 1, neutral: 0 } as const;
  let best: AppNavBadge | undefined;
  for (const e of entries) {
    if (e.id === activeId || !e.badge) continue;
    if (!best || rank[e.badge.tone] > rank[best.tone]) best = e.badge;
  }
  return best;
}

export interface AppSwitchButtonProps {
  title: string;
  icon: ReactNode;
  /** Aggregate badge across the other apps. */
  badge?: AppNavBadge;
  onClick: () => void;
  className?: string;
  /** Show a small chevron after the icon, hinting that the button opens a menu. */
  caret?: boolean;
}

/** The single compact button an app puts in its own header to open the switcher. */
export function AppSwitchButton({ title, icon, badge, onClick, className, caret }: AppSwitchButtonProps) {
  return (
    <button
      type="button"
      className={className ? `kth-app-switch ${className}` : 'kth-app-switch'}
      title={title}
      onClick={onClick}
    >
      <span className="kth-app-switch__icon" aria-hidden="true">{icon}</span>
      {caret && <span className="kth-app-switch__caret" aria-hidden="true">{'\u25BE'}</span>}
      <span className="kth-visually-hidden">{title}</span>
      {badge && <AppBadge badge={badge} className="kth-app-switch__badge" />}
    </button>
  );
}
