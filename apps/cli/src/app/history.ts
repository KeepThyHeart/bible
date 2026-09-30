/**
 * Session navigation history — the `h` screen.
 *
 * Ported closely from the desktop app's
 * `apps/desktop/src/ui/stores/bible/internals/navigationHistory.ts`, so the
 * CLI follows the same carefully worked-out rules as the desktop and web apps.
 * The only differences from that source are cosmetic: no `scrollTop` (the CLI
 * has no scroll position worth remembering across a jump), and no
 * `goBack`/`goForward` (there is no back key; `h` then a number is the only way
 * to move the cursor).
 *
 * Semantics:
 *  - {@link addHistoryEntry} truncates forward history (a jump made after
 *    picking an older line drops the newer lines), de-duplicates by
 *    (book, chapter) — each chapter appears once — appends, then caps at
 *    `maxSize`, keeping the most recent entries.
 *  - `replace: true` is for paging (`n`/`p`, and the chapter step a verse
 *    move rolls into at a chapter boundary): the entry the cursor is
 *    standing on is dropped first, so paging through five chapters leaves
 *    one line rather than five.
 *  - Revisiting a chapter already in the history moves its line to the top
 *    instead of adding a second one; moving the cursor within the chapter
 *    that is already the newest entry is the same operation and so updates
 *    that entry in place rather than growing the list.
 *  - {@link navigateToIndex} only moves the cursor; it never mutates the
 *    entries, which is what makes "picking a line move the marker without
 *    reordering" true.
 */

/** Cap on remembered chapters (10, the desktop's number). */
export const HISTORY_MAX_ENTRIES = 10;

export interface HistoryEntry {
  /** The verse navigated to, so picking this entry lands on the right verse. */
  readonly verseId: number;
  readonly bookNumber: number;
  readonly chapter: number;
  readonly bookName: string;
}

export interface HistorySlot {
  /** Chronological order, oldest first. Display reverses this (newest first). */
  readonly entries: readonly HistoryEntry[];
  /** Index into `entries` of where the cursor is. Always `entries.length - 1`
   * after {@link addHistoryEntry}; only {@link navigateToIndex} can move it
   * elsewhere. */
  readonly index: number;
  readonly maxSize: number;
}

export function emptyHistory(maxSize: number = HISTORY_MAX_ENTRIES): HistorySlot {
  return { entries: [], index: -1, maxSize };
}

/**
 * Append an entry, truncating forward history, deduping by chapter, and
 * capping at `maxSize`. Returns a new slot (pure function).
 *
 * `replace` drops the entry the cursor is standing on first, so a *sequential*
 * move — next/previous chapter — modifies where the reader is instead of
 * leaving a breadcrumb for every chapter paged through. Only a true jump (a
 * typed reference, a history pick) appends.
 */
export function addHistoryEntry(
  slot: HistorySlot,
  entry: HistoryEntry,
  options?: { readonly replace?: boolean },
): HistorySlot {
  // Truncate any forward entries past the current cursor.
  let truncated = slot.entries.slice(0, slot.index + 1);

  // The entry being replaced is being *moved*, not kept.
  if (options?.replace === true && truncated.length > 0) truncated = truncated.slice(0, -1);

  // Each (book, chapter) appears at most once — remove any existing match.
  truncated = truncated.filter(
    (h) => !(h.bookNumber === entry.bookNumber && h.chapter === entry.chapter),
  );

  truncated = [...truncated, entry];

  // Cap at max size, keeping the most recent entries.
  const capped = truncated.slice(-slot.maxSize);
  return { entries: capped, index: capped.length - 1, maxSize: slot.maxSize };
}

/**
 * Jump the cursor to a specific entry, by array index (chronological, not
 * display order). Returns `undefined` when out of range. Never mutates the
 * entries — "picking a line moves the marker without reordering".
 */
export function navigateToIndex(
  slot: HistorySlot,
  index: number,
): { readonly slot: HistorySlot; readonly entry: HistoryEntry } | undefined {
  const entry = slot.entries[index];
  if (index < 0 || index >= slot.entries.length || entry === undefined) return undefined;
  return { slot: { ...slot, index }, entry };
}

/**
 * Entries in the order the `h` screen shows them: newest first. Row `1` (the
 * first element) is {@link displayIndexToArrayIndex}'s inverse of `0`.
 */
export function displayOrder(slot: HistorySlot): readonly HistoryEntry[] {
  return [...slot.entries].reverse();
}

/** Row number (as typed by the user, 1-based, newest first) to array index. */
export function displayIndexToArrayIndex(slot: HistorySlot, displayNumber: number): number {
  return slot.entries.length - displayNumber;
}

/** Array index to the row number the `h` screen displays for it. */
export function arrayIndexToDisplayIndex(slot: HistorySlot, arrayIndex: number): number {
  return slot.entries.length - arrayIndex;
}
