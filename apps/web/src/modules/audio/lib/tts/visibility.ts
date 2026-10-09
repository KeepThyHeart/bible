/**
 * "Is the page in the background?" as a seam.
 *
 * A hidden tab throttles timers and suspends work, so on-device speech has to
 * synthesize the rest of the chapter while it still can. The look-ahead queue
 * asks this interface rather than `document` so tests can flip it by hand.
 */

export interface PageVisibility {
  isHidden(): boolean;
  /** Called whenever visibility changes. Returns the unsubscribe function. */
  subscribe(cb: () => void): () => void;
}

export function documentVisibility(): PageVisibility {
  if (typeof document === 'undefined') {
    return { isHidden: () => false, subscribe: () => () => {} };
  }
  return {
    isHidden: () => document.visibilityState === 'hidden',
    subscribe(cb) {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
  };
}
