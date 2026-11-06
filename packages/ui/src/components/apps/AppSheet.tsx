import { useLayoutEffect, useRef } from 'react';
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

const LIVE_REGION = '[aria-live]:not([aria-live="off"]),[role="status"],[role="alert"],[role="log"]';

let nextSheetId = 0;

/** Make everything outside the element `id` inert (live regions stay announced), restoring only what this call set. */
function inertBehind(id: string): () => void {
  const dialog = document.getElementById(id);
  const done = new Set<Element>();
  const inertify = (el: Element) => {
    if (el.matches('script,style,link,template,meta') || el.hasAttribute('inert') || el.matches(LIVE_REGION)) return;
    if (el.querySelector(LIVE_REGION)) { Array.from(el.children).forEach(inertify); return; }
    el.setAttribute('inert', '');
    done.add(el);
  };
  let node: Element | null = dialog;
  while (node && node !== document.body && node.parentElement) {
    const parent: Element = node.parentElement;
    for (const sib of Array.from(parent.children)) if (sib !== node) inertify(sib);
    node = parent;
  }
  return () => done.forEach((el) => el.removeAttribute('inert'));
}

/** Phone app switcher: a bottom sheet of big rows. Selecting calls onSelect, then onClose. */
export function AppSheet(props: AppSheetProps) {
  const { open, onClose, items, activeId, onSelect, title, labels, portal } = props;
  const sheetId = useRef<string | null>(null);
  if (sheetId.current === null) sheetId.current = `kth_app_sheet_${++nextSheetId}`;
  const id = sheetId.current;
  // The sheet is aria-modal: keep the page behind it out of the tab order and the accessibility tree too.
  // The opener (the "Switch app" button) is inert while the sheet is open, so the sheet's own focus restore
  // cannot land on it. Lift the inertness first, then return focus to the opener ourselves.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
  }
  useLayoutEffect(() => {
    wasOpen.current = open;
    if (!open) return undefined;
    const undo = inertBehind(id);
    return () => {
      undo();
      const o = opener.current;
      opener.current = null;
      if (o && o.isConnected) o.focus({ preventScroll: true });
    };
  }, [open, id]);
  return (
    <BottomSheet open={open} onClose={onClose} title={title} labels={labels} portal={portal} id={id} className="kth-app-sheet">
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
