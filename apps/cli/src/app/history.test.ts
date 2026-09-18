/**
 * The session history rules the human asked to be ported exactly from the
 * desktop app (0001-bible-cli thread, question 8). Each test names the rule
 * from the spec it is checking.
 */
import { describe, expect, test } from 'bun:test';

import {
  addHistoryEntry,
  arrayIndexToDisplayIndex,
  currentEntry,
  displayIndexToArrayIndex,
  displayOrder,
  emptyHistory,
  navigateToIndex,
  type HistoryEntry,
  type HistorySlot,
} from './history';

function entry(bookNumber: number, chapter: number, verse = 1): HistoryEntry {
  return { verseId: bookNumber * 1_000_000 + chapter * 1_000 + verse, bookNumber, chapter, bookName: `Book${bookNumber}` };
}

describe('addHistoryEntry', () => {
  test('a jump appends a line', () => {
    const slot = addHistoryEntry(emptyHistory(10), entry(43, 1));
    const next = addHistoryEntry(slot, entry(45, 8));
    expect(next.entries.map((e) => e.chapter)).toEqual([1, 8]);
    expect(next.index).toBe(1);
  });

  test('each chapter is recorded only once — revisiting moves it to the top', () => {
    let slot = emptyHistory(10);
    slot = addHistoryEntry(slot, entry(43, 1));
    slot = addHistoryEntry(slot, entry(45, 8));
    slot = addHistoryEntry(slot, entry(43, 1)); // revisit John 1
    expect(slot.entries.map((e) => e.chapter)).toEqual([8, 1]);
    expect(slot.index).toBe(1);
  });

  test('updating the verse within the current chapter updates that entry in place', () => {
    let slot = emptyHistory(10);
    slot = addHistoryEntry(slot, entry(43, 3, 1));
    slot = addHistoryEntry(slot, entry(43, 3, 16)); // moved the cursor, same chapter
    expect(slot.entries).toHaveLength(1);
    expect(currentEntry(slot)?.verseId).toBe(entry(43, 3, 16).verseId);
  });

  test('paging (replace) overwrites the current entry rather than adding one', () => {
    let slot = emptyHistory(10);
    slot = addHistoryEntry(slot, entry(43, 1));
    slot = addHistoryEntry(slot, entry(43, 2), { replace: true });
    slot = addHistoryEntry(slot, entry(43, 3), { replace: true });
    expect(slot.entries.map((e) => e.chapter)).toEqual([3]);
  });

  test('capped at maxSize, keeping the most recent entries', () => {
    let slot = emptyHistory(3);
    for (let chapter = 1; chapter <= 5; chapter += 1) {
      slot = addHistoryEntry(slot, entry(43, chapter));
    }
    expect(slot.entries.map((e) => e.chapter)).toEqual([3, 4, 5]);
    expect(slot.index).toBe(2);
  });

  test('a jump made after picking an older line drops the newer lines', () => {
    let slot = emptyHistory(10);
    slot = addHistoryEntry(slot, entry(1, 1));
    slot = addHistoryEntry(slot, entry(2, 1));
    slot = addHistoryEntry(slot, entry(3, 1));
    const picked = navigateToIndex(slot, 0)!; // back to the first entry
    slot = picked.slot;
    slot = addHistoryEntry(slot, entry(9, 1)); // a fresh jump from there
    expect(slot.entries.map((e) => e.bookNumber)).toEqual([1, 9]);
  });
});

describe('navigateToIndex', () => {
  test('moves the marker without reordering the entries', () => {
    let slot = emptyHistory(10);
    slot = addHistoryEntry(slot, entry(1, 1));
    slot = addHistoryEntry(slot, entry(2, 1));
    const result = navigateToIndex(slot, 0)!;
    expect(result.entry.bookNumber).toBe(1);
    expect(result.slot.entries.map((e) => e.bookNumber)).toEqual([1, 2]);
    expect(result.slot.index).toBe(0);
  });

  test('out of range is undefined', () => {
    const slot = addHistoryEntry(emptyHistory(10), entry(1, 1));
    expect(navigateToIndex(slot, 5)).toBeUndefined();
    expect(navigateToIndex(slot, -1)).toBeUndefined();
  });
});

describe('display order', () => {
  test('newest first, and the row numbers map back to the right entry', () => {
    let slot: HistorySlot = emptyHistory(10);
    slot = addHistoryEntry(slot, entry(1, 1));
    slot = addHistoryEntry(slot, entry(2, 1));
    slot = addHistoryEntry(slot, entry(3, 1));

    expect(displayOrder(slot).map((e) => e.bookNumber)).toEqual([3, 2, 1]);
    // Row 1 (newest) is array index 2; row 3 (oldest) is array index 0.
    expect(displayIndexToArrayIndex(slot, 1)).toBe(2);
    expect(displayIndexToArrayIndex(slot, 3)).toBe(0);
    expect(arrayIndexToDisplayIndex(slot, 2)).toBe(1);
  });
});
