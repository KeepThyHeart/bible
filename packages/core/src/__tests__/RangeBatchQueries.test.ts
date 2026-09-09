/**
 * The bulk RANGE queries that let `VerseLinksService.getBatchVerseLinks` answer
 * a whole chapter without asking each module once per verse.
 *
 * Each of these has a single-verse counterpart, and the batch version is only
 * safe if it reproduces that counterpart EXACTLY. A widened predicate that
 * quietly changes which entries match would
 * show up as commentaries appearing or vanishing under a verse - the kind of
 * difference nobody attributes to a performance change. So the assertions here
 * are equivalence assertions against the real shipped modules, not fixtures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { CommentaryRepository } from '../Data/Repositories/CommentaryRepository';
import { CrossReferenceRepository } from '../Data/Repositories/CrossReferenceRepository';
import { VerseIdHelper } from '../Data/Core/Types';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';
import type { ISql, SqlParameter, SqlResult } from '../Data/Core/ISql';
import { TEST_MODULES_DIR, testDataAvailable } from './helpers/testData';

/**
 * A provider that counts the statements a repository issues.
 *
 * Kept local rather than added to the shared helper: only these tests care,
 * and only about the SHAPE of the access (one statement for a chapter, not one
 * per verse), which is precisely the property the equivalence tests below
 * cannot see.
 */
class CountingSqlProvider implements ISql {
  queries = 0;
  constructor(private inner: TestSqliteProvider) {}
  queryOne<T = unknown>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T | undefined {
    this.queries++;
    return this.inner.queryOne<T>(sql, params);
  }
  queryAll<T = unknown>(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): T[] {
    this.queries++;
    return this.inner.queryAll<T>(sql, params);
  }
  execute(sql: string, params?: SqlParameter[] | { [key: string]: SqlParameter }): SqlResult {
    this.queries++;
    return this.inner.execute(sql, params);
  }
  transaction<T>(fn: () => T): T {
    return this.inner.transaction(fn);
  }
  close(): void {
    this.inner.close();
  }
  isOpen(): boolean {
    return this.inner.isOpen();
  }
  getDatabasePath(): string {
    return this.inner.getDatabasePath();
  }
}

const MODULES_DIR = path.join(TEST_MODULES_DIR, 'modules');
const BARNES = path.join(MODULES_DIR, 'commentary_barnes.db');
const TSK = path.join(MODULES_DIR, 'xref_tsk.db');

/** John 3 - a chapter with dense commentary and dense cross-references. */
const BOOK = 43;
const CHAPTER = 3;
const CHAPTER_START = VerseIdHelper.calculate(BOOK, CHAPTER, 1);
const CHAPTER_END = VerseIdHelper.calculate(BOOK, CHAPTER, 999);
const VERSES = Array.from({ length: 36 }, (_, i) => VerseIdHelper.calculate(BOOK, CHAPTER, i + 1));

describe.skipIf(!testDataAvailable('CommentaryRepository range batches (Barnes)', BARNES))('CommentaryRepository range batches (Barnes)', () => {
  let provider: TestSqliteProvider;
  let repo: CommentaryRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(BARNES);
    repo = new CommentaryRepository(provider);
  });
  afterAll(() => provider.close());

  it('getBestEntryAnchorsForRange reproduces getBestEntryForVerse for every verse', () => {
    const anchors = repo.getBestEntryAnchorsForRange(CHAPTER_START, CHAPTER_END);

    for (const verseId of VERSES) {
      // The per-verse answer, reconstructed the way the service does it: the
      // FIRST anchor in verse_id_start order whose range covers the verse.
      const fromRange = anchors.find(
        a => a.verseIdStart <= verseId && (a.verseIdEnd === undefined || a.verseIdEnd >= verseId)
      );
      const fromPerVerse = repo.getBestEntryForVerse(verseId);

      expect(fromRange?.entryId).toBe(fromPerVerse?.entryId);
      expect(fromRange?.verseIdStart).toBe(fromPerVerse?.verseIdStart);
      expect(fromRange?.entryLevel).toBe(fromPerVerse?.entryLevel);
    }
  });

  it('getVerseMentionRowsForRange reproduces getVerseMentions for every verse', () => {
    const rows = repo.getVerseMentionRowsForRange(CHAPTER_START, CHAPTER_END);

    for (const verseId of VERSES) {
      const covering = rows.filter(
        r => r.linkVerseIdStart <= verseId && r.linkVerseIdEnd >= verseId && r.entryVerseIdStart !== verseId
      );
      const counts = new Map<number, number>();
      for (const r of covering) counts.set(r.entryId, (counts.get(r.entryId) ?? 0) + 1);

      const perVerse = repo.getVerseMentions(verseId);
      expect([...counts.keys()].sort((a, b) => a - b)).toEqual(
        perVerse.map(m => m.entryId).sort((a, b) => a - b)
      );
      for (const mention of perVerse) {
        expect(counts.get(mention.entryId)).toBe(mention.count);
      }
    }
  });

  it('reads a whole chapter of anchors in one query, not one per verse', () => {
    // The point of the method: 36 verses, one statement. (A regression to a
    // per-verse loop would still pass the equivalence tests above.)
    const counting = new CountingSqlProvider(new TestSqliteProvider(BARNES));
    try {
      new CommentaryRepository(counting).getBestEntryAnchorsForRange(CHAPTER_START, CHAPTER_END);
      expect(counting.queries).toBe(1);
    } finally {
      counting.close();
    }
  });
});

describe.skipIf(!testDataAvailable('CrossReferenceRepository range batches (TSK)', TSK))('CrossReferenceRepository range batches (TSK)', () => {
  let provider: TestSqliteProvider;
  let repo: CrossReferenceRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(TSK);
    repo = new CrossReferenceRepository(provider);
  });
  afterAll(() => provider.close());

  it('getReverseReferencesForRange reproduces getReverseReferences for every verse', () => {
    const rows = repo.getReverseReferencesForRange(CHAPTER_START, CHAPTER_END);

    for (const verseId of VERSES) {
      const fromRange = rows
        .filter(r => r.targetVerseIdStart <= verseId && r.targetVerseIdEnd >= verseId)
        .map(r => r.sourceVerseId)
        .sort((a, b) => a - b);
      const perVerse = repo
        .getReverseReferences(verseId)
        .map(r => r.sourceVerseId)
        .sort((a, b) => a - b);

      expect(fromRange).toEqual(perVerse);
    }
  });

  it('finds the citing verses Study mode shows for John 3:16', () => {
    // A non-empty sanity floor, so an accidentally-empty result cannot pass the
    // equivalence test above by matching an equally empty per-verse result.
    const rows = repo.getReverseReferencesForRange(CHAPTER_START, CHAPTER_END);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('groups a chapter in two statements, where per-verse cost 36 rounds', () => {
    const counting = new CountingSqlProvider(new TestSqliteProvider(TSK));
    try {
      const batched = new CrossReferenceRepository(counting);
      // Warm the one-time compat probes (schema anchor, unified-links check,
      // max link span). They are cached for the life of the repository - a
      // read-only module cannot change under it - so they are not part of the
      // per-chapter cost this test is about.
      batched.getGroupsWithEntriesForRange(CHAPTER_START, CHAPTER_END);

      const before = counting.queries;
      batched.getGroupsWithEntriesForRange(CHAPTER_START, CHAPTER_END);
      const rangeCost = counting.queries - before;

      const perVerseBefore = counting.queries;
      for (const verseId of VERSES) batched.getGroupsWithEntries(verseId);
      const perVerseCost = counting.queries - perVerseBefore;

      // Groups, then their entries - two statements for the whole chapter.
      expect(rangeCost).toBe(2);
      // The shape this replaced: one statement per verse plus one per group.
      expect(perVerseCost).toBeGreaterThan(VERSES.length);
    } finally {
      counting.close();
    }
  });
});
