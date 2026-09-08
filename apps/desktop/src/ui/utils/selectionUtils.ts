/**
 * Selection utilities for expanding text selection to word boundaries
 */

/**
 * Expand the current selection to word boundaries
 * Ensures that the first and last words are fully selected
 * Preserves selection direction (forward or backward)
 */
export function expandSelectionToWordBoundaries(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return;
  }

  const range = selection.getRangeAt(0);

  // Detect if selection is backward (user selected right-to-left or bottom-to-top)
  // Compare anchor and focus positions to determine direction.
  // `comparePoint` throws when the anchor is not in the range's tree (a stale
  // node, a different root); a direction we cannot determine is treated as
  // forward rather than aborting the whole expansion.
  let isBackward = false;
  try {
    isBackward = !!(selection.anchorNode && selection.focusNode && (
      (selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset) ||
      (selection.anchorNode !== selection.focusNode &&
       range.comparePoint(selection.anchorNode, selection.anchorOffset) > 0)
    ));
  } catch {
    isBackward = false;
  }

  // Get the start and end containers
  let startContainer = range.startContainer;
  let startOffset = range.startOffset;
  let endContainer = range.endContainer;
  let endOffset = range.endOffset;

  // Expand start to word boundary
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer.textContent || '';

    // Move backward to find start of word
    while (startOffset > 0 && !/\s/.test(text[startOffset - 1])) {
      startOffset--;
    }
  }

  // Expand end to word boundary
  if (endContainer.nodeType === Node.TEXT_NODE) {
    const text = endContainer.textContent || '';

    // Move forward to find end of word (stop at whitespace or trailing punctuation)
    // This ensures natural word breaks - punctuation like commas, periods, colons
    // following a word don't get included in the selection
    while (endOffset < text.length && !/[\s,.:;!?'")\]]/.test(text[endOffset])) {
      endOffset++;
    }
  }

  // Apply the expanded selection while preserving direction
  try {
    if (isBackward) {
      // Backward selection: anchor at end, focus at start
      selection.setBaseAndExtent(endContainer, endOffset, startContainer, startOffset);
    } else {
      // Forward selection: anchor at start, focus at end
      selection.setBaseAndExtent(startContainer, startOffset, endContainer, endOffset);
    }
  } catch (error) {
    // Fallback for browsers that don't support setBaseAndExtent
    console.warn('setBaseAndExtent failed, using fallback method:', error);
    try {
      const newRange = document.createRange();
      newRange.setStart(startContainer, startOffset);
      newRange.setEnd(endContainer, endOffset);
      selection.removeAllRanges();
      selection.addRange(newRange);
    } catch (fallbackError) {
      console.error('Failed to expand selection to word boundaries:', fallbackError);
    }
  }
}

/*
  Scheduling belongs to `useBibleSelection`, which knows whether a button is
  still down; this module stays a pure operation on the current selection.
  Scheduling `expandSelectionToWordBoundaries` on a bare `setTimeout` here
  instead, with nothing to stop the timer landing in the middle of the
  *next* gesture, is how a double-click-then-drag ends up re-anchored and
  blown out to the whole block.
*/

/**
 * True when the user currently has a non-empty text selection.
 *
 * Verse rows are click-to-select, but the same rows are also the drag target
 * for highlighting and underlining. A drag across the text ends with a
 * `mouseup` followed by a `click` on the row, so without this guard every
 * highlight drag would also re-select the verse - and, worse, the selection
 * re-render can tear down the range the floating highlight toolbar is about to
 * act on. A click that merely *ends* a text selection therefore does nothing;
 * a plain click (collapsed selection) selects the verse.
 *
 * Lives here rather than in a view component so every verse renderer applies
 * exactly the same rule - Standard, Reading, Study and Parallel modes alike.
 */
export function isTextSelectionActive(): boolean {
  if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim().length > 0;
}
