import { useEffect, useRef } from 'react';
import { createHoverIntent } from '@bible/core/browser';
import type { HoverIntent } from '@bible/core/browser';

export interface UseHoverIntentOptions<T> {
  /** Default 300ms. */
  showDelay?: number;
  /** Default 200ms. */
  hideDelay?: number;
  onShow: (value: T) => void;
  onHide: () => void;
}

/**
 * React binding for `createHoverIntent` (`@bible/core/browser`). The returned controller is stable for the
 * component's lifetime; `onShow`/`onHide` always call the latest closures; pending timers are cleared on unmount.
 * Delays are read when the hook first runs.
 */
export function useHoverIntent<T>(options: UseHoverIntentOptions<T>): HoverIntent<T> {
  const latest = useRef(options);
  latest.current = options;
  const ref = useRef<HoverIntent<T> | null>(null);
  if (ref.current === null) {
    ref.current = createHoverIntent<T>({
      showDelay: options.showDelay,
      hideDelay: options.hideDelay,
      onShow: (value) => latest.current.onShow(value),
      onHide: () => latest.current.onHide(),
    });
  }
  useEffect(() => () => ref.current?.dispose(), []);
  return ref.current;
}
