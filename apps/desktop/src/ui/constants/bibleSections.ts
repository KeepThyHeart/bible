/**
 * Canonical-section -> theme token mapping, shared by every UI surface that
 * colour-codes the canon.
 *
 * This lived inside `BookChapterPicker.tsx` until the search distribution
 * sparkline needed the same hues. Two copies of a colour scheme drift, and the
 * whole value of the scheme is that a book is the *same* colour wherever the
 * user meets it - the picker and the sparkline have to agree or the colour
 * teaches nothing.
 *
 * The tokens are existing theme-defined hues (the `highlight-*` palette plus
 * the status colours), not new hardcoded colours, so section accents stay
 * correct under every installed theme - including ones added after this file
 * was written - without touching `themes.css`.
 *
 * Colour is never the only cue at either call site: the picker always renders
 * the book name, and the sparkline names every bar in its tooltip and
 * `aria-label`. This is a scanning aid layered on top of text, not a legend
 * the reader has to decode.
 */
import type React from 'react';
import type { BibleSectionKey } from '@bible/core/Services/BibleSections';
import { getBibleSection } from '@bible/core/Services/BibleSections';

export const SECTION_COLOR_TOKEN: Record<BibleSectionKey, string> = {
  pentateuch: 'warning',
  'ot-history': 'info',
  wisdom: 'danger',
  'major-prophets': 'highlight-purple',
  'minor-prophets': 'highlight-orange',
  gospels: 'success',
  acts: 'highlight-red',
  pauline: 'highlight-blue',
  general: 'highlight-yellow',
  revelation: 'highlight-green',
};

/** The theme token for a book number's canonical section. */
export function sectionColorToken(bookNumber: number): string {
  return SECTION_COLOR_TOKEN[getBibleSection(bookNumber)];
}

/**
 * A section-tinted background plus leading accent border, for a book button in
 * the passage picker's grid. Button text keeps its normal colour, so contrast
 * is never at risk.
 */
export function sectionButtonStyle(bookNumber: number): React.CSSProperties {
  const token = sectionColorToken(bookNumber);
  return {
    backgroundColor: `rgb(var(--theme-${token}-rgb) / 0.12)`,
    borderInlineStart: `3px solid rgb(var(--theme-${token}-rgb) / 0.6)`,
  };
}
