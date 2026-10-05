import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AppBadge } from './AppBadge';
import type { AppNavEntry } from './types';

export interface AppRailLabels {
  railLabel: string;
}

export const DEFAULT_APP_RAIL_LABELS: AppRailLabels = { railLabel: 'Apps' };

export interface AppRailProps {
  items: AppNavEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Fires on hover and focus, so the host can warm the app's code. */
  onPrefetch?: (id: string) => void;
  labels?: Partial<AppRailLabels>;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}

export function appTooltip(item: AppNavEntry): string {
  return item.shortcutHint ? `${item.title} (${item.shortcutHint})` : item.title;
}

/**
 * Icon rail of apps. One tab stop (roving tabindex); Arrow keys along the orientation, Home and End
 * move focus; Enter/Space activate. The active app carries aria-current="page" and a marker bar.
 */
export function AppRail(props: AppRailProps) {
  const { items, activeId, onSelect, onPrefetch, orientation = 'vertical', className } = props;
  const l = { ...DEFAULT_APP_RAIL_LABELS, ...props.labels };
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabId = items.some((i) => i.id === focusId)
    ? focusId
    : (items.find((i) => i.id === activeId) ?? items[0])?.id;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-app-id]'));
    const cur = buttons.findIndex((b) => b === document.activeElement);
    if (buttons.length === 0 || cur < 0) return;
    const rtl = typeof getComputedStyle === 'function' && getComputedStyle(e.currentTarget).direction === 'rtl';
    const prev = orientation === 'vertical' ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft';
    const next = orientation === 'vertical' ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight';
    let to = -1;
    if (e.key === next) to = (cur + 1) % buttons.length;
    else if (e.key === prev) to = (cur - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = buttons.length - 1;
    if (to < 0) return;
    e.preventDefault();
    buttons[to].focus();
  };

  const cls = ['kth-app-rail', `kth-app-rail--${orientation}`, className].filter(Boolean).join(' ');
  return (
    <nav className={cls} aria-label={l.railLabel} onKeyDown={onKeyDown}>
      <ul className="kth-app-rail__list">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id} className="kth-app-rail__item">
              <button
                type="button"
                className={active ? 'kth-app-rail__btn kth-app-rail__btn--active' : 'kth-app-rail__btn'}
                data-app-id={item.id}
                title={appTooltip(item)}
                aria-current={active ? 'page' : undefined}
                aria-busy={item.busy ? 'true' : undefined}
                tabIndex={item.id === tabId ? 0 : -1}
                onClick={() => onSelect(item.id)}
                onMouseEnter={() => onPrefetch?.(item.id)}
                onFocus={() => { setFocusId(item.id); onPrefetch?.(item.id); }}
              >
                <span className="kth-app-rail__marker" aria-hidden="true" />
                <span className="kth-app-rail__icon" aria-hidden="true">{item.icon}</span>
                <span className="kth-visually-hidden">{item.title}</span>
                {item.badge && <AppBadge badge={item.badge} className="kth-app-rail__badge" />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
