import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Open modal containers, oldest first. Only the last one traps Tab, so a dialog opened over another is not fought by it. */
const openModals: HTMLElement[] = [];

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert],[hidden]') && el.getClientRects().length > 0,
  );
}

/**
 * Keyboard behaviour of a modal dialog (WCAG 2.4.3): focus moves into it when it
 * opens, Tab / Shift+Tab stay inside it, and focus returns to whatever opened it
 * when it closes. Escape is `useEscapeKey`'s job.
 *
 * `ref` is the dialog box (the element that carries `role="dialog"`). Like
 * `useEscapeKey`, the Tab listener lives for the component's whole life with the
 * state read from a ref, because Preact flushes effects on an animation frame.
 */
export function useModalFocus(isOpen: boolean, ref: RefObject<HTMLElement>): void {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // Captured while rendering: by the time an effect runs, a dialog's own autofocus may already have moved focus.
  if (isOpen && !wasOpen.current) {
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
  }

  useEffect(() => {
    const el = ref.current;
    if (isOpen && el) {
      openModals.push(el);
      if (!el.contains(document.activeElement)) {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
        el.focus({ preventScroll: true });
      }
      wasOpen.current = true;
      return () => {
        const i = openModals.indexOf(el);
        if (i >= 0) openModals.splice(i, 1);
      };
    }
    if (!isOpen && wasOpen.current) {
      wasOpen.current = false;
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
    }
    return undefined;
  }, [isOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const el = ref.current;
      if (!el || openModals[openModals.length - 1] !== el) return;
      const items = tabbables(el);
      if (items.length === 0) { e.preventDefault(); el.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!el.contains(active) || active === el) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
