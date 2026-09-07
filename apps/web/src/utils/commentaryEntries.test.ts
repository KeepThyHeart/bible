/**
 * Tests for the real commentary entry classification and filtering.
 *
 * This logic had no test of its own: both components that use it
 * (`CommentaryContent`, `MobileCommentary`) `vi.mock` the module away, and the
 * only other coverage was in `server/__tests__/api.test.ts`, which declared its
 * own copy of `isPassageEntry` — "Mirrors the client-side isPassageEntry logic
 * from CommentaryContent.tsx" — inside tests that were `it.skip`ped anyway
 * because the ExB module is not in the dev dataset. So the classification that
 * decides which commentary a reader sees under a verse was never exercised.
 */
import { describe, it, expect } from 'vitest';
import { isPassageEntry, filterCommentaryEntries } from './commentaryEntries';
import type { CommentaryEntryData } from '../types';

/** Exodus verse ids: 2ccc vvv → Exodus 32:1 is 2032001. */
const EXODUS_32_1 = 2032001;

let nextId = 1;
const entry = (
  start: number,
  end: number,
  entry_level: string = 'verse',
): CommentaryEntryData => ({
  entry_id: nextId++,
  verse_id_start: start,
  verse_id_end: end,
  entry_level,
  content: `entry ${start}-${end}`,
  word_count: 10,
});

describe('isPassageEntry', () => {
  it('classifies by entry_level', () => {
    expect(isPassageEntry(entry(EXODUS_32_1, EXODUS_32_1, 'passage'))).toBe(true);
    expect(isPassageEntry(entry(EXODUS_32_1, EXODUS_32_1, 'chapter'))).toBe(true);
    expect(isPassageEntry(entry(EXODUS_32_1, EXODUS_32_1, 'verse'))).toBe(false);
  });

  it('classifies a spanning range as a passage even when the level says verse', () => {
    // Exodus 32:1-35 in ExB arrives labelled 'verse' with a wider range; if this
    // returned false it would render as commentary on 32:1 alone.
    expect(isPassageEntry(entry(EXODUS_32_1, 2032035, 'verse'))).toBe(true);
  });

  it('treats a single-verse range as verse-level', () => {
    expect(isPassageEntry(entry(EXODUS_32_1, EXODUS_32_1))).toBe(false);
  });

  it('treats a missing or zero end as verse-level rather than a huge span', () => {
    expect(isPassageEntry({ ...entry(EXODUS_32_1, 0), verse_id_end: 0 })).toBe(false);
    expect(
      isPassageEntry({ ...entry(EXODUS_32_1, 0), verse_id_end: undefined as unknown as number }),
    ).toBe(false);
  });
});

describe('filterCommentaryEntries', () => {
  it('keeps only entries covering the highlighted verse', () => {
    const covering = entry(2032001, 2032035, 'passage');
    const exact = entry(EXODUS_32_1, EXODUS_32_1);
    const before = entry(2031001, 2031018, 'passage');
    const after = entry(2033001, 2033023, 'passage');

    const { verse, passage } = filterCommentaryEntries(
      [covering, exact, before, after],
      EXODUS_32_1,
    );

    expect(verse).toEqual([exact]);
    expect(passage).toEqual([covering]);
  });

  it('never puts a passage entry in the verse list', () => {
    // The bug this guards: a passage entry showing up as verse commentary makes
    // a chapter-length note look like a note on the one verse.
    const { verse, passage } = filterCommentaryEntries(
      [entry(2032001, 2032035, 'verse'), entry(EXODUS_32_1, EXODUS_32_1)],
      EXODUS_32_1,
    );

    expect(passage).toHaveLength(1);
    expect(verse).toHaveLength(1);
    expect(verse.every(e => !isPassageEntry(e))).toBe(true);
  });

  it('splits a verse into both a verse-level and a passage-level section', () => {
    // Exodus 1:7 has a 1:7 entry and a 1:7-22 entry; the reader should get both.
    const verseEntry = entry(2001007, 2001007);
    const passageEntry = entry(2001007, 2001022, 'passage');

    const result = filterCommentaryEntries([passageEntry, verseEntry], 2001007);

    expect(result.verse).toEqual([verseEntry]);
    expect(result.passage).toEqual([passageEntry]);
  });

  it('orders passage entries narrowest first', () => {
    const wide = entry(2032001, 2032035, 'passage');
    const narrow = entry(2032001, 2032006, 'passage');
    const medium = entry(2032001, 2032014, 'passage');

    const { passage } = filterCommentaryEntries([wide, narrow, medium], EXODUS_32_1);

    expect(passage.map(e => e.verse_id_end)).toEqual([2032006, 2032014, 2032035]);
  });

  it('matches an entry with no end only on its exact start verse', () => {
    const openEnded = { ...entry(EXODUS_32_1, 0), verse_id_end: 0 };

    expect(filterCommentaryEntries([openEnded], EXODUS_32_1).verse).toEqual([openEnded]);
    expect(filterCommentaryEntries([openEnded], 2032002).verse).toEqual([]);
  });

  it('falls back to chapter-level entries when no verse is highlighted', () => {
    const chapterEntry = entry(2032001, 2032035, 'chapter');
    const passageEntry = entry(2032001, 2032035, 'passage');
    const verseEntry = entry(EXODUS_32_1, EXODUS_32_1);

    for (const noVerse of [null, undefined, 0]) {
      const result = filterCommentaryEntries([chapterEntry, passageEntry, verseEntry], noVerse);
      expect(result.verse).toEqual([chapterEntry]);
      expect(result.passage).toEqual([]);
    }
  });

  it('returns empty lists rather than throwing on no entries', () => {
    expect(filterCommentaryEntries([], EXODUS_32_1)).toEqual({ verse: [], passage: [] });
  });
});
