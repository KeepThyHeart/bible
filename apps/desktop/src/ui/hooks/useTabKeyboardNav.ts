import { useCallback, useRef } from 'react';

/**
 * Keyboard navigation hook for ARIA tab bars (role="tablist").
 *
 * Returns a ref for the tablist container and a key handler that implements
 * the WAI-ARIA authoring practices for tabs:
 *   - ArrowLeft / ArrowRight move focus between tabs (wrapping).
 *   - Home / End jump to the first / last tab.
 *   - Focus moves to the targeted tab button; the caller decides whether to
 *     also activate that tab (automatic vs. manual activation).
 *
 * Each tab button should expose `role="tab"` and be a direct focusable child
 * of the element this ref is attached to (or be discoverable via
 * `[role="tab"]` selector beneath it).
 */
export interface UseTabKeyboardNavOptions {
  /** Number of tabs. Needed so index math doesn't require DOM queries. */
  tabCount: number;
  /** Currently active tab index. */
  activeIndex: number;
  /**
   * Called when a new tab should be activated. If `manualActivation` is true,
   * pressing arrow keys only moves focus - callers must wire Enter/Space on
   * the tab button itself to activate. Default is automatic activation.
   */
  onActivate: (index: number) => void;
  /** If true, arrow-key focus movement does not auto-activate the tab. */
  manualActivation?: boolean;
}

export function useTabKeyboardNav(options: UseTabKeyboardNavOptions): {
  tablistRef: React.RefObject<HTMLDivElement>;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
} {
  const { tabCount, activeIndex, onActivate, manualActivation } = options;
  const tablistRef = useRef<HTMLDivElement>(null);

  const focusTabAt = useCallback((index: number) => {
    const container = tablistRef.current;
    if (!container) return;
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    const el = tabs[index];
    if (el) el.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (tabCount === 0) return;
      let nextIndex: number | null = null;
      switch (event.key) {
        case 'ArrowRight':
          nextIndex = (activeIndex + 1) % tabCount;
          break;
        case 'ArrowLeft':
          nextIndex = (activeIndex - 1 + tabCount) % tabCount;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = tabCount - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      if (nextIndex === null) return;
      if (!manualActivation) {
        onActivate(nextIndex);
      }
      focusTabAt(nextIndex);
    },
    [activeIndex, tabCount, onActivate, manualActivation, focusTabAt],
  );

  return { tablistRef, onKeyDown };
}
