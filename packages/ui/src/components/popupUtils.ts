import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PopupDir } from '@bible/core/browser';

/** The visible viewport (excludes mobile browser chrome when `visualViewport` exists). */
export function getViewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  const vv = window.visualViewport;
  return { width: vv ? vv.width : window.innerWidth, height: vv ? vv.height : window.innerHeight };
}

/** The document's reading direction, for popups that were not given an explicit `dir`. */
export function documentDir(): PopupDir {
  if (typeof document === 'undefined') return 'ltr';
  return document.documentElement.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
}

/** Bumps a counter whenever the window resizes (or the visual viewport does), so positions recompute. */
export function useViewportTick(active: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    const bump = () => setTick((n) => n + 1);
    window.addEventListener('resize', bump);
    window.visualViewport?.addEventListener('resize', bump);
    return () => {
      window.removeEventListener('resize', bump);
      window.visualViewport?.removeEventListener('resize', bump);
    };
  }, [active]);
  return tick;
}

/**
 * Escape closes (WCAG 1.4.13 "dismissible"). Listens on `window` while `active`, so events dispatched on the
 * document or any element reach it. A layout effect, so it is live from the popup's first paint (Preact defers
 * ordinary effects by a frame, which would leave a visible popup deaf to Escape).
 */
export function useEscape(active: boolean, onEscape: (() => void) | undefined): void {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useLayoutEffect(() => {
    if (!active) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) ref.current?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active]);
}

/** Calls `onOutside` for a mouse/touch press that lands outside every element in `insideRefs`. */
export function useOutsidePress(
  active: boolean,
  insideRefs: Array<{ current: Element | null }>,
  onOutside: (() => void) | undefined,
): void {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  const refs = useRef(insideRefs);
  refs.current = insideRefs;
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e: Event) => {
      const target = e.target as Node | null;
      if (target && refs.current.some((r) => r.current?.contains(target))) return;
      cb.current?.();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [active]);
}

/**
 * Moves focus into `ref` when `active` turns on and restores it to the previously focused element
 * when it turns off (modal-ish surfaces: bottom sheet, pinned popovers).
 */
export function useFocusScope(active: boolean, ref: { current: HTMLElement | null }): void {
  useLayoutEffect(() => {
    if (!active) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [active, ref]);
}
