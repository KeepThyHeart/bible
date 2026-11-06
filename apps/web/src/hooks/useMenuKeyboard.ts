import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

type Where = 'first' | 'last';

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

function items(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(el => !(el as HTMLButtonElement).disabled) : [];
}

/**
 * WAI-ARIA menu-button keyboard behaviour for a trigger button plus its popup `role="menu"`:
 * Enter/Space/ArrowDown on the trigger opens the menu and focuses the checked (else first) item, ArrowUp opens
 * on the last; Up/Down/Home/End move between items; Escape closes and returns focus to the trigger; Tab closes.
 * Spread `onTriggerKeyDown` on the trigger and `onMenuKeyDown` on the menu element.
 */
export function useMenuKeyboard(
  open: boolean,
  setOpen: (open: boolean) => void,
  triggerRef: RefObject<HTMLElement>,
  menuRef: RefObject<HTMLElement>,
) {
  const pending = useRef<Where | null>(null);

  const focusItem = (where: Where) => {
    const list = items(menuRef.current);
    if (list.length === 0) return false;
    const checked = list.find(el => el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-current') === 'true');
    const target = where === 'last' ? list[list.length - 1] : (checked ?? list[0]);
    target.focus({ preventScroll: false });
    return true;
  };

  useEffect(() => {
    if (!open) { pending.current = null; return; }
    if (pending.current) {
      const where = pending.current;
      pending.current = null;
      focusItem(where);
    }
  }, [open]);

  const onTriggerKeyDown = (e: KeyboardEvent) => {
    let where: Where | null = null;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') where = 'first';
    else if (e.key === 'ArrowUp') where = 'last';
    if (!where) return;
    e.preventDefault();
    if (open) {
      focusItem(where);
    } else {
      pending.current = where;
      setOpen(true);
    }
  };

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const list = items(menuRef.current);
    const idx = list.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowDown': next = idx < 0 ? 0 : (idx + 1) % list.length; break;
      case 'ArrowUp': next = idx <= 0 ? list.length - 1 : idx - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = list.length - 1; break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
        return;
      case 'Tab':
        // Hand focus back to the trigger so the browser's Tab continues from it, not from <body>.
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
        return;
      default: return;
    }
    if (next === null || list.length === 0) return;
    e.preventDefault();
    list[next].focus();
  };

  return { onTriggerKeyDown, onMenuKeyDown };
}
