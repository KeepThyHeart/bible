/**
 * Framework-free hover-intent controller for hover-triggered popups.
 *
 * Hovering schedules `onShow` after `showDelay`; leaving before it fires cancels it.
 * Leaving after it has shown schedules `onHide` after `hideDelay`, which re-entering
 * (onto the popup itself, via `cancelHide`) cancels, so the pointer can travel to the
 * popup and stay there (WCAG 1.4.13 "hoverable" and "persistent").
 *
 * Timers are injectable for tests.
 */

export interface HoverIntentOptions<T> {
  /** Default 300ms. */
  showDelay?: number;
  /** Default 200ms. */
  hideDelay?: number;
  onShow: (value: T) => void;
  onHide: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface HoverIntent<T> {
  /** Hover (or focus) began on a trigger: show `value` once the delay elapses. */
  scheduleShow(value: T): void;
  /** Hover (or focus) ended: hide after `hideDelay`. */
  scheduleHide(): void;
  /** The pointer entered the popup itself: cancel a pending hide. */
  cancelHide(): void;
  /** Cancel everything pending and hide immediately (Escape, outside click, explicit close). */
  hideNow(): void;
  /** Cancel everything pending without calling `onHide` (unmount). */
  dispose(): void;
  /** True while a show or hide is pending. */
  isPending(): boolean;
}

export const DEFAULT_SHOW_DELAY = 300;
export const DEFAULT_HIDE_DELAY = 200;

export function createHoverIntent<T>(options: HoverIntentOptions<T>): HoverIntent<T> {
  const showDelay = options.showDelay ?? DEFAULT_SHOW_DELAY;
  const hideDelay = options.hideDelay ?? DEFAULT_HIDE_DELAY;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let showHandle: unknown = null;
  let hideHandle: unknown = null;

  const clearShow = () => {
    if (showHandle !== null) { clearTimer(showHandle); showHandle = null; }
  };
  const clearHide = () => {
    if (hideHandle !== null) { clearTimer(hideHandle); hideHandle = null; }
  };

  return {
    scheduleShow(value) {
      clearHide();
      clearShow();
      showHandle = setTimer(() => { showHandle = null; options.onShow(value); }, showDelay);
    },
    scheduleHide() {
      clearShow();
      clearHide();
      hideHandle = setTimer(() => { hideHandle = null; options.onHide(); }, hideDelay);
    },
    cancelHide: clearHide,
    hideNow() {
      clearShow();
      clearHide();
      options.onHide();
    },
    dispose() {
      clearShow();
      clearHide();
    },
    isPending: () => showHandle !== null || hideHandle !== null,
  };
}
