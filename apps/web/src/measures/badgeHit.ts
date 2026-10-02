/**
 * Pointer geometry for the weights-and-measures popups (task 0069).
 *
 * A verse-level measure (no word to pin it to) is carried by the verse's last
 * word, which also draws a badge as CSS `::after` content. That word must not
 * steal clicks meant for the verse text, so a fallback-only word counts as a
 * measure hit only when the pointer is on the badge, that is, inside the
 * element's box but outside its text.
 */

/** True when (x, y) lies inside any client rect of the element's text contents. */
export function pointerInText(el: Element, x: number, y: number): boolean {
  const doc = el.ownerDocument;
  if (!doc || typeof doc.createRange !== 'function') return false;
  const range = doc.createRange();
  range.selectNodeContents(el);
  const list = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
  const rects = list ? Array.from(list) : [];
  range.detach?.();
  return rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
}

/** Minimal view of a chapter's index: which anchor kind an occurrence has. */
export interface AnchorKindSource {
  at(verseId: number, wordIndex: number): readonly string[];
  occurrence(id: string): { anchor: { target: { kind: string } } } | undefined;
}

/** True when every occurrence at the word is a verse-level fallback (none has a real token anchor). */
export function isFallbackOnlyWord(
  index: AnchorKindSource, occIds: readonly string[],
): boolean {
  return occIds.length > 0 && occIds.every((id) => index.occurrence(id)?.anchor.target.kind === 'verse');
}

/**
 * Whether a pointer event on a measure word should count as a measure hit:
 * always for words with a real anchored measure; for fallback-only words only
 * when the pointer is on the badge (outside the word's text).
 */
export function isMeasureHit(
  el: Element, index: AnchorKindSource, occIds: readonly string[], x: number, y: number,
): boolean {
  if (!isFallbackOnlyWord(index, occIds)) return true;
  return !pointerInText(el, x, y);
}

/** Interlinear original-language, transliteration and Strong's elements keep their own clicks. */
const INTERLINEAR_OWN_CLICK =
  '.verse__interlinear-original, .verse__interlinear-translit, .verse__strongs-link';

export function isInterlinearOriginalTarget(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.(INTERLINEAR_OWN_CLICK);
}
