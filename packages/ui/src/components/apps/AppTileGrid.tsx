import { AppBadge } from './AppBadge';
import { appTooltip } from './AppRail';
import type { AppNavEntry } from './types';

export interface AppTileGridLabels {
  gridLabel: string;
}

export const DEFAULT_APP_TILE_GRID_LABELS: AppTileGridLabels = { gridLabel: 'Apps' };

export interface AppTileGridProps {
  items: AppNavEntry[];
  onSelect: (id: string) => void;
  onPrefetch?: (id: string) => void;
  labels?: Partial<AppTileGridLabels>;
  className?: string;
}

/** Large tiles (icon, title, badge) for a home screen or new tab. Plain tab order. */
export function AppTileGrid(props: AppTileGridProps) {
  const { items, onSelect, onPrefetch, className } = props;
  const l = { ...DEFAULT_APP_TILE_GRID_LABELS, ...props.labels };
  return (
    <ul className={className ? `kth-app-grid ${className}` : 'kth-app-grid'} aria-label={l.gridLabel}>
      {items.map((item) => (
        <li key={item.id} className="kth-app-grid__cell">
          <button
            type="button"
            className="kth-app-grid__tile"
            data-app-id={item.id}
            title={appTooltip(item)}
            aria-busy={item.busy ? 'true' : undefined}
            onClick={() => onSelect(item.id)}
            onMouseEnter={() => onPrefetch?.(item.id)}
            onFocus={() => onPrefetch?.(item.id)}
          >
            <span className="kth-app-grid__icon" aria-hidden="true">{item.icon}</span>
            <span className="kth-app-grid__title">{item.title}</span>
            {item.badge && <AppBadge badge={item.badge} className="kth-app-grid__badge" />}
          </button>
        </li>
      ))}
    </ul>
  );
}
