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

/** Opener of each open modal, so a dialog opened from inside another can fall back to that one's opener. */
const modalOpener = new WeakMap<HTMLElement, HTMLElement | null>();
/** Opener element (inside a parent dialog) to the parent dialog's own opener. */
const fallbackOf = new WeakMap<HTMLElement, HTMLElement>();

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
  // Captured once per opening: a re-render before the effect runs sees focus already moved and must not overwrite it.
  const captured = useRef(false);
  if (!isOpen && !wasOpen.current) captured.current = false;
  if (isOpen && !wasOpen.current && !captured.current) {
    captured.current = true;
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
    // The parent dialog already unmounted (it closed in the render before ours), so focus is on BODY:
    // the parent's own opener is the best place to come back to.
    if (!opener.current && openModals.length) opener.current = modalOpener.get(openModals[openModals.length - 1]) ?? null;
    // Opened from inside another open dialog: if that opener is gone when we close, return to the parent's opener.
    if (opener.current) {
      const parent = openModals.find((m) => m.contains(opener.current));
      const up = parent ? modalOpener.get(parent) : null;
      if (up) fallbackOf.set(opener.current, up);
    }
  }

  useEffect(() => {
    const el = ref.current;
    if (isOpen && el) {
      openModals.push(el);
      modalOpener.set(el, opener.current);
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
      restore();
    }
    return undefined;
  }, [isOpen]);

  function restore() {
    let back = opener.current;
    opener.current = null;
    captured.current = false;
    while (back && !back.isConnected) back = fallbackOf.get(back) ?? null;
    // Another dialog already holds focus (one closing as the next opens): leave it be.
    if (openModals.some((m) => m.contains(document.activeElement))) return;
    back?.focus({ preventScroll: true });
  }

  // The dialog component unmounted while open (mounted only when shown): hand focus back too.
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => () => {
    if (wasOpen.current) { wasOpen.current = false; restoreRef.current(); }
  }, []);

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
