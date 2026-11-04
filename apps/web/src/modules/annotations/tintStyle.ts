/**
 * Highlight tints come from core's `HIGHLIGHT_COLOR_HEX` (the one palette shared with desktop and the colour
 * swatch), not from hardcoded copies in the stylesheet: the module injects one small `<style>` while active.
 */
import { HIGHLIGHT_COLOR_HEX, HIGHLIGHT_COLOR_NAMES } from '@bible/core/browser';

export const TINT_STYLE_ID = 'kth-annot-tints';

export function tintCss(): string {
  const rules = HIGHLIGHT_COLOR_NAMES.map((n) => `.verse.kth-annot-hl--${n}{--kth-annot-tint:${HIGHLIGHT_COLOR_HEX[n]}}`);
  return `.verse.kth-annot-hl{--kth-annot-tint:${HIGHLIGHT_COLOR_HEX.yellow}}${rules.join('')}`;
}

/** Add the tint rules; returns the disposer. */
export function installTintStyle(doc: Document = document): () => void {
  doc.getElementById(TINT_STYLE_ID)?.remove();
  const el = doc.createElement('style');
  el.id = TINT_STYLE_ID;
  el.textContent = tintCss();
  doc.head.appendChild(el);
  return () => el.remove();
}
