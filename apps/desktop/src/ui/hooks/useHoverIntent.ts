import { useCallback, useEffect, useRef } from 'react';

export interface UseHoverIntentOptions<T> {
  /** Delay before `onShow` fires after a hover starts. Default 300ms - matches web's popup delay. */
  showDelay?: number;
  /** Delay before `onHide` fires after a hover ends, giving the pointer time to reach the popup. Default 200ms. */
  hideDelay?: number;
  onShow: (value: T) => void;
  onHide: () => void;
}

export interface UseHoverIntentResult<T> {
  /** Call on hover start (e.g. `onMouseEnter`) with the value to show once the delay elapses. */
  scheduleShow: (value: T) => void;
  /** Call on hover end (e.g. `onMouseLeave`) to hide after `hideDelay`. */
  scheduleHide: () => void;
  /** Call when the pointer enters the popup itself, to cancel a pending hide. */
  cancelHide: () => void;
  /** Cancel any pending show/hide and hide immediately (e.g. click-outside, explicit close). */
  hideNow: () => void;
}

/**
 * Shared show/hide timeout logic for hover-triggered popups, used by
 * `InterlinearDisplay`'s `StackedLayout` and `InlineLayout` and by
 * `useScriptureTooltip`. Keeping it in one place avoids each of them keeping
 * its own `hoverTimeoutRef`/`closeTimeoutRef` pair and near-identical
 * handlers.
 *
 * Behavior: hovering schedules `onShow` after `showDelay`; leaving before
 * that fires cancels it. Leaving after it has shown schedules `onHide` after
 * `hideDelay`, which re-entering (e.g. onto the popup itself, via
 * `cancelHide`) cancels - so the user can move the pointer onto the tooltip
 * without it disappearing mid-transit.
 */
export function useHoverIntent<T>(options: UseHoverIntentOptions<T>): UseHoverIntentResult<T> {
  const { showDelay = 300, hideDelay = 200, onShow, onHide } = options;
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShowTimeout = () => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
  };
  const clearHideTimeout = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const scheduleShow = useCallback((value: T) => {
    clearHideTimeout();
    clearShowTimeout();
    showTimeoutRef.current = setTimeout(() => {
      showTimeoutRef.current = null;
      onShow(value);
    }, showDelay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onShow, showDelay]);

  const scheduleHide = useCallback(() => {
    clearShowTimeout();
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      hideTimeoutRef.current = null;
      onHide();
    }, hideDelay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHide, hideDelay]);

  const cancelHide = useCallback(() => {
    clearHideTimeout();
  }, []);

  const hideNow = useCallback(() => {
    clearShowTimeout();
    clearHideTimeout();
    onHide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onHide]);

  useEffect(() => {
    return () => {
      clearShowTimeout();
      clearHideTimeout();
    };
  }, []);

  return { scheduleShow, scheduleHide, cancelHide, hideNow };
}
