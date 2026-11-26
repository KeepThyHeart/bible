import { useEffect, useRef } from 'react';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useTextSettingsStore } from '../stores/useTextSettingsStore';

/** Same range as the Typography slider. */
export const BIBLE_FONT_MIN = 12;
export const BIBLE_FONT_MAX = 48;
/** One notch per this many ms, so a trackpad pinch (a burst of ctrl+wheel events) is not a runaway. */
const STEP_INTERVAL_MS = 60;

/**
 * Ctrl + mouse wheel over the Bible text changes the Bible text size (not the window zoom).
 *
 * Wheel up grows, wheel down shrinks, one point per notch, within 12-48. The listener is native and
 * non-passive because React's synthetic wheel handlers are passive: without `preventDefault()` Chromium
 * would zoom the whole page as well.
 *
 * Which setting changes: Preferences > Typography's Bible size, so every non-customized pane follows. If the
 * Bible pane has already been customized in Preferences > Fonts, that override wins on screen, so the
 * override is changed instead (it is already detached, so nothing new is detached).
 */
export function stepBibleFontSize(direction: 1 | -1): void {
  const text = useTextSettingsStore.getState(); // allow-getstate: event handler - reads the live size, no subscription
  const current = text.getSettings('bible').fontSize;
  const next = Math.min(BIBLE_FONT_MAX, Math.max(BIBLE_FONT_MIN, Math.round(current) + direction));
  if (next === current) return;
  if (text.customized.bible) text.updateSettings('bible', { fontSize: next });
  else usePreferencesStore.getState().setTypography({ bibleFontSize: next }); // allow-getstate: event handler
}

export function useCtrlWheelBibleSize(containerRef: React.RefObject<HTMLElement | null>): void {
  const lastRef = useRef(-Infinity);
  // No dependency list: the container can mount after the first render (loading states), so the ref is
  // read after every commit. Re-attaching a listener is cheap; the throttle clock lives in a ref.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY === 0) return;
      const now = performance.now();
      if (now - lastRef.current < STEP_INTERVAL_MS) return;
      lastRef.current = now;
      stepBibleFontSize(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
}
