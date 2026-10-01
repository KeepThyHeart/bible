import { useEffect, useRef } from 'preact/hooks';
import { anchorAtPointer } from '@bible/core/browser';
import type { LocaleDirection } from '@bible/core/browser';

/**
 * Hook that adjusts a fixed-position element to stay within the viewport.
 * Mirrors the positioning logic used in the desktop app's VersePreviewTooltip.
 *
 * @param position - Initial desired position (top/left from trigger element)
 * @param deps - Additional dependencies to trigger recalculation
 * @param dir - UI direction. When given, the element is anchored with
 *   `inset-inline-start` (opens away from the pointer in reading direction)
 *   instead of a physical `left`.
 * @returns A ref to attach to the positioned element
 */
export function useViewportPosition<T extends HTMLElement>(
  position: { top: number; left: number } | null,
  deps: unknown[] = [],
  dir?: LocaleDirection,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!ref.current || !position) return;

    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 16;

    if (dir) {
      const { insetInlineStart } = anchorAtPointer(position.left, rect.width, viewportWidth, dir, padding);
      let top = position.top;
      if (top + rect.height > viewportHeight - padding) top = position.top - rect.height - 8;
      el.style.left = '';
      el.style.top = `${Math.max(padding, top)}px`;
      el.style.insetInlineStart = `${insetInlineStart}px`;
      return;
    }

    let adjustedLeft = position.left;
    let adjustedTop = position.top;

    // Horizontal: if overflowing right, shift left
    if (adjustedLeft + rect.width > viewportWidth - padding) {
      adjustedLeft = Math.max(padding, viewportWidth - rect.width - padding);
    }

    // Vertical: if overflowing bottom, flip above the trigger
    // The trigger is roughly at (position.top - 4) since we typically offset by +4
    if (adjustedTop + rect.height > viewportHeight - padding) {
      // Position above: go up by element height + small gap from where trigger bottom was
      adjustedTop = position.top - rect.height - 8;
    }

    // Ensure not off the top or left edges
    adjustedTop = Math.max(padding, adjustedTop);
    adjustedLeft = Math.max(padding, adjustedLeft);

    el.style.top = `${adjustedTop}px`;
    el.style.left = `${adjustedLeft}px`;
  }, [position, dir, ...deps]);

  return ref;
}
