/**
 * A text selection on the viewer, as a highlight range snapped to whole words.
 *
 * On a desktop the phrase gesture is the browser's own: double-click and drag
 * (which already snaps to words), or an ordinary drag-select. Either way what
 * arrives is a DOM `Range` whose ends can sit anywhere -- mid-word, in the
 * trailing space after a word, on a verse number, or on an element boundary
 * between two spans. This turns that into the first and last *words* whose
 * visible text the selection actually touches.
 *
 * "Touches" is strict: a selection that ends exactly where a word begins (or
 * starts in the space after one) does not include it. That is what makes a
 * drag that stops in the gap between two words select the words it crossed,
 * rather than one more at either end.
 */

import type { HighlightRange } from '../protocol';
import { rangeBetween, readWordAddress, type WordAddress } from './words';

/** The first and last non-whitespace positions of an element's text, as boundary points. */
function visibleTextBounds(el: Element): { start: [Node, number]; end: [Node, number] } | null {
  let start: [Node, number] | null = null;
  let end: [Node, number] | null = null;
  const visit = (node: Node): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = node.textContent ?? '';
      const first = text.search(/\S/);
      if (first === -1) return;
      if (!start) start = [node, first];
      end = [node, text.replace(/\s+$/, '').length];
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(el);
  return start && end ? { start, end } : null;
}

/** Whether `range` overlaps the visible text of `el` by at least one character. */
function touchesVisibleText(range: Range, el: Element): boolean {
  const bounds = visibleTextBounds(el);
  if (!bounds) return false;
  const doc = el.ownerDocument;
  const word = doc.createRange();
  word.setStart(bounds.start[0], bounds.start[1]);
  word.setEnd(bounds.end[0], bounds.end[1]);
  // range.start < word.end  &&  range.end > word.start
  return range.compareBoundaryPoints(Range.END_TO_START, word) < 0
    && range.compareBoundaryPoints(Range.START_TO_END, word) > 0;
}

/**
 * The words a selection covers within `root`, first and last, or null when it
 * covers none (collapsed, outside the passage, or only verse numbers).
 */
export function selectedWords(range: Range, root: Element): { first: WordAddress; last: WordAddress } | null {
  if (range.collapsed) return null;
  let first: WordAddress | null = null;
  let last: WordAddress | null = null;
  // Document order, so the first and last hits are the ends. Once a run of
  // hits has started, the first element the range does not reach at all ends
  // it -- everything after is further down the page.
  for (const el of Array.from(root.querySelectorAll('[data-word-index]'))) {
    if (!range.intersectsNode(el)) {
      if (first) break;
      continue;
    }
    if (!touchesVisibleText(range, el)) continue;
    const word = readWordAddress(el);
    if (!word) continue;
    first ??= word;
    last = word;
  }
  return first && last ? { first, last } : null;
}

/** `selectedWords`, as the range to send. */
export function selectionToHighlight(range: Range, root: Element): HighlightRange | null {
  const words = selectedWords(range, root);
  return words ? rangeBetween(words.first, words.last) : null;
}
