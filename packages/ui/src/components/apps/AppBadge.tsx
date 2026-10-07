import type { AppNavBadge } from './types';

export interface AppBadgeProps {
  badge: AppNavBadge;
  className?: string;
}

/**
 * Dot / count / text pill. The visible value is hidden from assistive tech; the badge's `label` is
 * exposed through a visually hidden span, so a bare count is never the only information.
 */
export function AppBadge({ badge, className }: AppBadgeProps) {
  const cls = ['kth-app-badge', `kth-app-badge--${badge.kind}`, `kth-app-badge--${badge.tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} data-tone={badge.tone}>
      {badge.kind !== 'dot' && badge.value !== undefined && (
        <span className="kth-app-badge__value" aria-hidden="true">{badge.value}</span>
      )}
      <span className="kth-visually-hidden">{badge.label}</span>
    </span>
  );
}
