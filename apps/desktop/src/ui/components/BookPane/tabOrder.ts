import type { PaneTabRef } from '../../stores/useBookStore';

/**
 * Ordering model for the Books pane's unified tab strip.
 *
 * The pane shows books and dictionaries in one row, but their content lives in
 * two independent stores with two independent index spaces. Concatenating them
 * (`[...bookTabs, ...dictTabs]`) groups the strip by type, so opening
 * Book A -> Dictionary X -> Book B displays A, B, X - the pane rearranging tabs
 * the user has just placed. Dragging has the same split-brain problem if the
 * reorder fires only when source *and* destination are both books: a dictionary
 * tab lifts under the cursor and snaps back.
 *
 * So the strip gets its own ordered list of `{type, abbreviation}` refs, stored
 * on the book panel state (`BookPanelState.tabOrder`). Two rules keep it honest
 * without every module-opening code path having to know about it:
 *
 *   1. refs for modules that are no longer open are dropped;
 *   2. open modules with no ref yet are appended.
 *
 * That makes the list self-healing - a dictionary opened by a Strong's-number
 * click, a session restore, or a detached window all land at the end, which is
 * where a newly opened tab belongs anyway - and leaves explicit maintenance for
 * exactly one gesture: drag-reorder.
 */

/** Stable identity for a strip entry. Type is part of it: a book and a dictionary may share an abbreviation. */
export function tabRefKey(ref: PaneTabRef): string {
  return `${ref.type}:${ref.abbreviation}`;
}

/**
 * Reconcile a stored strip order against what is actually open.
 *
 * Pure and idempotent: feeding its own output back in returns an equal list,
 * which is what lets the pane render from it every frame and persist it only
 * when it differs.
 */
export function mergeTabOrder(
  order: readonly PaneTabRef[],
  bookAbbreviations: readonly string[],
  dictionaryAbbreviations: readonly string[],
): PaneTabRef[] {
  const open = new Set<string>();
  for (const abbreviation of bookAbbreviations) open.add(`book:${abbreviation}`);
  for (const abbreviation of dictionaryAbbreviations) open.add(`dictionary:${abbreviation}`);

  const placed = new Set<string>();
  const merged: PaneTabRef[] = [];

  for (const ref of order) {
    const key = tabRefKey(ref);
    // Drops closed tabs, and de-duplicates a stored order that somehow lists
    // the same module twice - neither should ever produce a phantom tab.
    if (!open.has(key) || placed.has(key)) continue;
    placed.add(key);
    merged.push({ type: ref.type, abbreviation: ref.abbreviation });
  }

  // Anything open but unplaced is new. Books before dictionaries only matters
  // when several appear in the same commit (a session restore); one-at-a-time
  // opening records each tab before the next arrives, which is the real case.
  for (const abbreviation of bookAbbreviations) {
    const key = `book:${abbreviation}`;
    if (placed.has(key)) continue;
    placed.add(key);
    merged.push({ type: 'book', abbreviation });
  }
  for (const abbreviation of dictionaryAbbreviations) {
    const key = `dictionary:${abbreviation}`;
    if (placed.has(key)) continue;
    placed.add(key);
    merged.push({ type: 'dictionary', abbreviation });
  }

  return merged;
}

/** Whether two strip orders describe the same tabs in the same positions. */
export function sameTabOrder(a: readonly PaneTabRef[], b: readonly PaneTabRef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((ref, index) => {
    const other = b[index];
    return other !== undefined && other.type === ref.type && other.abbreviation === ref.abbreviation;
  });
}

/**
 * Move one entry of the strip to another position.
 *
 * Returns the original list untouched for an out-of-range or no-op move, so
 * callers can compare by identity to decide whether anything needs persisting.
 */
export function moveTab(
  order: readonly PaneTabRef[],
  sourceIndex: number,
  destinationIndex: number,
): PaneTabRef[] {
  if (
    sourceIndex === destinationIndex ||
    sourceIndex < 0 || sourceIndex >= order.length ||
    destinationIndex < 0 || destinationIndex >= order.length
  ) {
    return order.slice();
  }

  const next = order.slice();
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(destinationIndex, 0, moved);
  return next;
}

/**
 * Where a module sits among the entries of its own type.
 *
 * A drag is expressed in strip positions, but each content store only
 * understands positions within its own tab array - this is the translation.
 * Returns -1 when the module is not in the strip.
 */
export function indexWithinType(order: readonly PaneTabRef[], ref: PaneTabRef): number {
  let index = -1;
  for (const candidate of order) {
    if (candidate.type !== ref.type) continue;
    index += 1;
    if (candidate.abbreviation === ref.abbreviation) return index;
  }
  return -1;
}
