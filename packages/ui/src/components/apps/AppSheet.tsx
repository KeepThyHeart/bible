import type { ReactNode } from 'react';
import { BottomSheet } from '../BottomSheet';
import type { BottomSheetLabels } from '../BottomSheet';
import { AppBadge } from './AppBadge';
import type { AppNavEntry } from './types';

export interface AppSheetProps {
  open: boolean;
  onClose: () => void;
  items: AppNavEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
  title: ReactNode;
  /** Labels of the underlying sheet (close button). */
  labels?: Partial<BottomSheetLabels>;
  portal?: boolean;
}

/** Phone app switcher: a bottom sheet of big rows. Selecting calls onSelect, then onClose. */
export function AppSheet(props: AppSheetProps) {
  const { open, onClose, items, activeId, onSelect, title, labels, portal } = props;
  return (
    <BottomSheet open={open} onClose={onClose} title={title} labels={labels} portal={portal} className="kth-app-sheet">
      <ul className="kth-app-sheet__list">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id}>
              <button
                type="button"
                className={active ? 'kth-app-sheet__row kth-app-sheet__row--active' : 'kth-app-sheet__row'}
                data-app-id={item.id}
                aria-current={active ? 'page' : undefined}
                aria-busy={item.busy ? 'true' : undefined}
                onClick={() => { onSelect(item.id); onClose(); }}
              >
                <span className="kth-app-sheet__icon" aria-hidden="true">{item.icon}</span>
                <span className="kth-app-sheet__title">{item.title}</span>
                {item.badge && <AppBadge badge={item.badge} className="kth-app-sheet__badge" />}
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
