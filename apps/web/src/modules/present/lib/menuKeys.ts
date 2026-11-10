import { useEffect } from 'preact/hooks';

/**
 * Shared keyboard behaviour of the Presenter's menu buttons (WAI-ARIA menu button):
 * Up/Down/Home/End move between the enabled items, Escape closes and hands focus
 * back to the button that opened the menu. Opening one menu closes the others.
 */

const ITEMS = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

export function menuItems(menu: ParentNode | null | undefined): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(ITEMS)) : [];
}

/** Focus the first enabled item of `menu` (when a menu opens). */
export function focusFirstMenuItem(menu: ParentNode | null | undefined): void {
  menuItems(menu)[0]?.focus();
}

/**
 * Keydown handler for a menu container. `onEscape` closes the menu and refocuses its button.
 * Returns true when it handled the key.
 */
export function handleMenuKey(event: KeyboardEvent, menu: ParentNode | null | undefined, onEscape: () => void): boolean {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onEscape();
    return true;
  }
  const items = menuItems(menu);
  if (items.length === 0) return false;
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next = -1;
  if (event.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length;
  else if (event.key === 'ArrowUp') next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  if (next < 0) return false;
  event.preventDefault();
  items[next].focus();
  return true;
}

const OPENED = 'present-menu-opened';

/** While `open`, announce it; any other menu that is open closes itself. `id` is unique per menu. */
export function useExclusiveMenu(id: string, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return undefined;
    window.dispatchEvent(new CustomEvent(OPENED, { detail: id }));
    const onOther = (event: Event): void => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    window.addEventListener(OPENED, onOther);
    return () => window.removeEventListener(OPENED, onOther);
  }, [open, id]);
}
