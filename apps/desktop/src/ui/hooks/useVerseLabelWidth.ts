import { useLayoutEffect } from 'react';
import type { VerseLabelMode } from '../stores/usePreferencesStore';

/** The CSS variable `verseGutterClass` sizes a reference-style label column from. */
export const VERSE_LABEL_WIDTH_VAR = '--verse-label-width';

/**
 * Size the verse-label column to the widest label on screen, for the reference styles
 * (`3:16`, `Jn 3:16`).
 *
 * Those labels are left-aligned, and a fixed gutter wide enough for the longest book abbreviation in
 * any locale left a wide empty channel beside short ones. Every label is measured instead (they are
 * marked `data-verse-label`), and the widest, in px, is published on the container as
 * `--verse-label-width`, so every row in the chapter still starts its text at the same edge. The
 * labels' font, size and the locale's abbreviations all change the width, so it is measured rather
 * than estimated from the character count.
 *
 * Runs after every render (cheap: one layout read for a chapter's labels, and the variable is only
 * written when it changes), plus once when web fonts finish loading. Number mode keeps its fixed,
 * right-aligned gutter and is not measured.
 */
export function useVerseLabelWidth(
  containerRef: React.RefObject<HTMLElement | null>,
  mode: VerseLabelMode,
): void {
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || mode === 'number') return undefined;
    const measure = () => {
      let widest = 0;
      el.querySelectorAll<HTMLElement>('[data-verse-label]').forEach((label) => {
        widest = Math.max(widest, label.getBoundingClientRect().width);
      });
      if (widest === 0) return;
      const value = `${Math.ceil(widest)}px`;
      if (el.style.getPropertyValue(VERSE_LABEL_WIDTH_VAR) !== value) {
        el.style.setProperty(VERSE_LABEL_WIDTH_VAR, value);
      }
    };
    measure();
    let cancelled = false;
    // A web font that finishes loading after the first paint changes every label's width.
    document.fonts?.ready.then(() => {
      if (!cancelled) measure();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  });
}
