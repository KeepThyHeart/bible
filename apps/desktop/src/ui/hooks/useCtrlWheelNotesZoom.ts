import { useEffect, useRef } from 'react';
import { useNotesZoomStore } from '../stores/useNotesZoomStore';

/** One notch per this many ms, so a trackpad pinch is not a runaway. */
const STEP_INTERVAL_MS = 60;

/**
 * Ctrl + mouse wheel over a notes view zooms the notes (viewing size only), not the window.
 * Native non-passive listener, as in useCtrlWheelBibleSize, so the page itself does not zoom.
 */
export function useCtrlWheelNotesZoom(containerRef: React.RefObject<HTMLElement | null>): void {
  const lastRef = useRef(-Infinity);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.defaultPrevented) return;
      e.preventDefault();
      if (e.deltaY === 0) return;
      const now = performance.now();
      if (now - lastRef.current < STEP_INTERVAL_MS) return;
      lastRef.current = now;
      useNotesZoomStore.getState().step(e.deltaY < 0 ? 1 : -1); // allow-getstate: event handler
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
}
