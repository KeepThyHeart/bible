/**
 * Finding, scrolling to, and flashing the verse a link just landed on.
 *
 * Shared because two places scroll the Bible text and both had the same blind
 * spot. `useBibleScrolling` handles Standard and Reading modes; `StudyModeView`
 * runs its own effect because Study mode withholds its verses until the whole
 * chapter's study data lands, by which time the generic effect has already
 * fired against a ref that was still null.
 */

/**
 * The rendered row for a verse, inside one pane.
 *
 * Scoped to `container` on purpose: with two Bible panes open, a document-wide
 * lookup would find the other pane's copy of the same verse and scroll that.
 * Every verse row carries `data-verse-id` in all display modes, which is what
 * lets one lookup serve them all - `selectedVerseRef` is attached only to the
 * *selected* verse, and a preview deliberately does not move the selection.
 */
export function findVerseElement(
  container: HTMLElement | null,
  verseId: number,
): HTMLElement | null {
  if (!container) return null;
  return container.querySelector<HTMLElement>(`[data-verse-id="${verseId}"]`);
}

/**
 * Play the "you landed here" flash, restarting it if it is already running.
 *
 * A CSS animation fires when the class carrying it is applied, so following two
 * links to the same verse would animate once and then look inert. Removing the
 * class, reading `offsetWidth` to force the style recalculation, and re-adding
 * it is the standard way to re-arm one.
 */
export function restartArrivalFlash(verseEl: HTMLElement): void {
  verseEl.classList.remove('verse-flash');
  void verseEl.offsetWidth;
  verseEl.classList.add('verse-flash');
}
