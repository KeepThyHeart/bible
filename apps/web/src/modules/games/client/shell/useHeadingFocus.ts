import { useEffect, useRef } from 'preact/hooks';

/**
 * Screen changes unmount the control that had focus, which drops it to <body>.
 * Put the returned ref on the new screen's heading (it needs tabindex="-1") and
 * focus lands there when the screen appears. Only when focus really was lost:
 * a screen that appears while focus sits somewhere deliberate (the app rail, a
 * dialog's opener) is left alone.
 */
export function useHeadingFocus<T extends HTMLElement = HTMLHeadingElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    ref.current?.focus({ preventScroll: true });
  }, []);
  return ref;
}
