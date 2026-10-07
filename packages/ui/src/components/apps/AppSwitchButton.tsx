import type { ReactNode } from 'react';
import { AppBadge } from './AppBadge';
import type { AppNavBadge } from './types';

export interface AppSwitchButtonProps {
  title: string;
  icon: ReactNode;
  /** Aggregate badge across the other apps. */
  badge?: AppNavBadge;
  onClick: () => void;
  className?: string;
}

/** The single compact button an app puts in its own header to open the switcher. */
export function AppSwitchButton({ title, icon, badge, onClick, className }: AppSwitchButtonProps) {
  return (
    <button
      type="button"
      className={className ? `kth-app-switch ${className}` : 'kth-app-switch'}
      title={title}
      onClick={onClick}
    >
      <span className="kth-app-switch__icon" aria-hidden="true">{icon}</span>
      <span className="kth-visually-hidden">{title}</span>
      {badge && <AppBadge badge={badge} className="kth-app-switch__badge" />}
    </button>
  );
}
