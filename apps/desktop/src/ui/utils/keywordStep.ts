/**
 * Stepping through keyword-mark occurrences (task 0065): scroll the verse/word into view and flash it, the same
 * way find-in-chapter scrolls to its current match (`scrollIntoView({ block: 'center' })` on the rendered word).
 */
import type { KeywordOccurrence } from './keywordLegendModel';

/** CSS class added for a moment to the word (or verse) stepped to. See highlights.css `.keyword-step-flash`. */
export const KEYWORD_FLASH_CLASS = 'keyword-step-flash';
const FLASH_MS = 1400;

/**
 * Scroll to an occurrence inside `root` and flash it. Returns false when neither the word nor its verse is
 * rendered (for example a verse outside the visible chapter).
 */
export function scrollToOccurrence(root: ParentNode, occ: KeywordOccurrence): boolean {
  const verse = root.querySelector<HTMLElement>(`[data-verse-id="${occ.verseId}"]`);
  const word = verse?.querySelector<HTMLElement>(`.word[data-word-index="${occ.start}"]`)
    ?? root.querySelector<HTMLElement>(`[data-verse-id="${occ.verseId}"] .word[data-word-index="${occ.start}"]`);
  const target = word ?? verse;
  if (!target) return false;
  target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  target.classList.add(KEYWORD_FLASH_CLASS);
  window.setTimeout(() => target.classList.remove(KEYWORD_FLASH_CLASS), FLASH_MS);
  return true;
}

/** Next index in `dir`, wrapping. `current` is -1 when not stepped yet. */
export function stepIndex(current: number, total: number, dir: 'next' | 'prev'): number {
  if (total <= 0) return -1;
  if (dir === 'next') return current + 1 >= total ? 0 : current + 1;
  return current <= 0 ? total - 1 : current - 1;
}
