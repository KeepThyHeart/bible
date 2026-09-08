/**
 * Pure navigation-history helpers operating on Zustand state.
 *
 * These functions compute the next `{ history, historyIndex }` tuple directly
 * from the store's current values, so navigation history lives in exactly one
 * place (the Zustand panel state) rather than in a side-channel controller
 * instance that has to be kept in sync and torn down separately.
 *
 * Semantics match `VerseNavigationController` exactly (see tests in
 * `packages/core/src/Controllers/VerseNavigationController.test.ts`):
 *  - `addEntry` truncates forward history, de-duplicates by (book, chapter),
 *    appends, then caps at `maxHistorySize` keeping the most recent entries.
 *  - `goBack` / `goForward` only move the cursor; they do not mutate history.
 *  - `saveScrollPosition` updates the current entry in place.
 */

import type { HistoryEntry } from '../types';

export const DEFAULT_MAX_HISTORY_SIZE = 10;

export interface NavigationSlot {
  history: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;
}

export function canGoBack(slot: NavigationSlot): boolean {
  return slot.historyIndex > 0;
}

export function canGoForward(slot: NavigationSlot): boolean {
  return slot.historyIndex < slot.history.length - 1;
}

export function getCurrentEntry(slot: NavigationSlot): HistoryEntry | null {
  if (slot.historyIndex < 0 || slot.historyIndex >= slot.history.length) return null;
  return slot.history[slot.historyIndex] ?? null;
}

/**
 * Append an entry, truncating forward history, deduping by chapter, and
 * capping at `maxHistorySize`. Returns a new slot (pure function).
 *
 * `replace` drops the entry the cursor is standing on first, so a *sequential*
 * move - next/previous chapter - modifies where the reader is instead of
 * leaving a breadcrumb for every chapter they paged through. Only a true jump
 * (a reference, a search result, a cross-reference, a history pick) appends.
 * Entries other than the current one are untouched, so replacing never
 * discards another chapter's remembered verse.
 */
export function addHistoryEntry(
  slot: NavigationSlot,
  entry: HistoryEntry,
  options?: { replace?: boolean },
): NavigationSlot {
  // Truncate any forward entries past the current cursor
  let truncated = slot.history.slice(0, slot.historyIndex + 1);

  // The entry being replaced is being *moved*, not kept.
  if (options?.replace && truncated.length > 0) truncated.pop();

  // Each (book, chapter) appears at most once - remove existing matches
  truncated = truncated.filter(
    h => !(h.bookNumber === entry.bookNumber && h.chapter === entry.chapter)
  );

  truncated.push(entry);

  // Cap at max size, keeping the most recent entries
  const capped = truncated.slice(-slot.maxHistorySize);
  return {
    history: capped,
    historyIndex: capped.length - 1,
    maxHistorySize: slot.maxHistorySize,
  };
}

/** Move the cursor back one step. Returns new slot + the entry to navigate to, or null. */
export function goBack(slot: NavigationSlot): { slot: NavigationSlot; entry: HistoryEntry } | null {
  if (!canGoBack(slot)) return null;
  const newIndex = slot.historyIndex - 1;
  const entry = slot.history[newIndex];
  if (!entry) return null;
  return { slot: { ...slot, historyIndex: newIndex }, entry };
}

/** Move the cursor forward one step. Returns new slot + the entry to navigate to, or null. */
export function goForward(slot: NavigationSlot): { slot: NavigationSlot; entry: HistoryEntry } | null {
  if (!canGoForward(slot)) return null;
  const newIndex = slot.historyIndex + 1;
  const entry = slot.history[newIndex];
  if (!entry) return null;
  return { slot: { ...slot, historyIndex: newIndex }, entry };
}

/** Jump to a specific history index. Returns new slot + entry, or null if out of range. */
export function navigateToIndex(
  slot: NavigationSlot,
  index: number
): { slot: NavigationSlot; entry: HistoryEntry } | null {
  if (index < 0 || index >= slot.history.length) return null;
  const entry = slot.history[index];
  if (!entry) return null;
  return { slot: { ...slot, historyIndex: index }, entry };
}

/** Update the scroll position on the current entry. Returns new slot. */
export function saveScrollPositionAt(slot: NavigationSlot, scrollTop: number): NavigationSlot {
  if (slot.historyIndex < 0 || slot.historyIndex >= slot.history.length) return slot;
  const newHistory = slot.history.slice();
  const current = newHistory[slot.historyIndex];
  if (!current) return slot;
  newHistory[slot.historyIndex] = { ...current, scrollTop };
  return { ...slot, history: newHistory };
}
