import type { ICommentaryDataProvider } from '../providers/interfaces';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { commentaryStore } from './commentaryStore';
import type { ChapterOverviewData } from '../types';

/**
 * The speculative chapter prefetch used to pull every active commentary's full
 * text on every chapter navigation. Measured against the shipped modules, one
 * chapter of Matthew Henry is ~2 MB and Luther ~845 KB, so a reader tapping
 * through chapters on a phone was downloading megabytes of commentary they had
 * not opened. These tests pin the budget that stops that, and — just as
 * importantly — that the cheap modules are still prefetched.
 *
 * Word counts below are the real ones for John 3.
 */

const BOOK = 43;
const CHAPTER = 3;

/** Build a chapter overview whose per-module word totals are exactly `totals`. */
function overviewWith(totals: Record<string, number>): ChapterOverviewData {
  const modules: [string, string][] = Object.keys(totals).map(abbr => [abbr, abbr]);
  const entries = Object.entries(totals).map(([abbr, wordCount], i) => ({
    moduleIdx: modules.findIndex(m => m[0] === abbr),
    startVerse: i + 1,
    endVerse: i + 1,
    level: 'v',
    wordCount,
  }));
  return { book: BOOK, chapter: CHAPTER, modules, entries };
}

function seedOverview(totals: Record<string, number>): void {
  commentaryStore.chapterOverviewCache.set(`${BOOK}-${CHAPTER}`, overviewWith(totals));
}

/** John 3, as the shipped modules actually measure. */
const JOHN_3 = {
  TSK: 894,
  Wesley: 1348,
  Clarke: 7333,
  Barnes: 10438,
  SYNTHESIS: 21502,
  Luther: 144306,
  MHC: 327153,
};

/**
 * Inject a stub commentary provider.
 *
 * `provider` is private on `CommentaryStore`, and these tests want it without
 * `init()`'s session restore and tab seeding — so the modifier has to be
 * stepped past. Confined to this one commented helper rather than repeated at
 * every call site; TypeScript only began flagging it when test files entered
 * the type-check.
 */
function setProvider(stub: Partial<ICommentaryDataProvider>): void {
  (commentaryStore as unknown as { provider: ICommentaryDataProvider }).provider =
    stub as ICommentaryDataProvider;
}

describe('commentary prefetch budget', () => {
  beforeEach(() => {
    commentaryStore.chapterOverviewCache.clear();
    commentaryStore.entriesByTab.clear();
  });

  describe('affordablePrefetchModules', () => {
    it('excludes the modules that made chapter navigation expensive', () => {
      seedOverview(JOHN_3);

      const chosen = commentaryStore.affordablePrefetchModules(BOOK, CHAPTER);

      expect(chosen).not.toContain('MHC');
      expect(chosen).not.toContain('Luther');
    });

    it('still prefetches the cheap tail', () => {
      seedOverview(JOHN_3);

      const chosen = commentaryStore.affordablePrefetchModules(BOOK, CHAPTER);

      expect(chosen).toEqual(expect.arrayContaining(['TSK', 'Wesley', 'Clarke', 'Barnes', 'SYNTHESIS']));
    });

    it('returns null when there is no overview to judge by', () => {
      // Offline, or the overview request failed. Guessing is what we are trying
      // to avoid, so the caller must be able to tell "cheap" from "unknown".
      expect(commentaryStore.affordablePrefetchModules(BOOK, CHAPTER)).toBeNull();
    });

    it('spends the budget cheapest-first so it buys the most modules', () => {
      // One module just under the per-module cap would eat most of the budget
      // if taken first; the cheap ones must win the race.
      seedOverview({ Big: 24_000, Small1: 1_000, Small2: 1_000, Small3: 1_000 });

      const chosen = commentaryStore.affordablePrefetchModules(BOOK, CHAPTER)!;

      expect(chosen.slice(0, 3)).toEqual(expect.arrayContaining(['Small1', 'Small2', 'Small3']));
    });

    it('drops a single module that exceeds the per-module cap even when the budget is empty', () => {
      seedOverview({ Huge: 300_000 });

      expect(commentaryStore.affordablePrefetchModules(BOOK, CHAPTER)).toEqual([]);
    });

    it('stops once the total budget is spent', () => {
      // Six modules at 20k each = 120k, double the 60k budget.
      seedOverview({ A: 20_000, B: 20_000, C: 20_000, D: 20_000, E: 20_000, F: 20_000 });

      const chosen = commentaryStore.affordablePrefetchModules(BOOK, CHAPTER)!;

      expect(chosen.length).toBe(3);
    });
  });

  describe('isCheapEnoughToWarm', () => {
    it('declines a large module', () => {
      seedOverview(JOHN_3);
      expect(commentaryStore.isCheapEnoughToWarm('MHC', BOOK, CHAPTER)).toBe(false);
    });

    it('allows a small module', () => {
      seedOverview(JOHN_3);
      expect(commentaryStore.isCheapEnoughToWarm('Barnes', BOOK, CHAPTER)).toBe(true);
    });

    it('declines when the size is unknown', () => {
      expect(commentaryStore.isCheapEnoughToWarm('Barnes', BOOK, CHAPTER)).toBe(false);
    });

    it('declines a module with no content in this chapter', () => {
      seedOverview(JOHN_3);
      expect(commentaryStore.isCheapEnoughToWarm('NotHere', BOOK, CHAPTER)).toBe(false);
    });
  });

  describe('prefetchAllEntries', () => {
    function providerReturning(overview: ChapterOverviewData) {
      return {
        getChapterOverview: vi.fn().mockResolvedValue(overview),
        getAllCommentary: vi.fn().mockResolvedValue({ modules: {} }),
      };
    }

    beforeEach(() => {
      // Reset the once-per-chapter guard.
      (commentaryStore as unknown as { _prefetchKey: string })._prefetchKey = '';
      (commentaryStore as unknown as { _chapterOverviewKey: string })._chapterOverviewKey = '';
    });

    it('asks the server only for the affordable modules', async () => {
      const provider = providerReturning(overviewWith(JOHN_3));
      setProvider(provider);

      await commentaryStore.prefetchAllEntries(BOOK, CHAPTER);

      expect(provider.getAllCommentary).toHaveBeenCalledTimes(1);
      const requested = provider.getAllCommentary.mock.calls[0][2] as string[];
      expect(requested).not.toContain('MHC');
      expect(requested).toContain('Barnes');
    });

    it('makes no bulk request at all when nothing is affordable', async () => {
      const provider = providerReturning(overviewWith({ MHC: 327_153 }));
      setProvider(provider);

      await commentaryStore.prefetchAllEntries(BOOK, CHAPTER);

      expect(provider.getAllCommentary).not.toHaveBeenCalled();
    });

    it('makes no bulk request when the overview is unavailable', async () => {
      const provider = {
        getChapterOverview: vi.fn().mockRejectedValue(new Error('offline')),
        getAllCommentary: vi.fn().mockResolvedValue({ modules: {} }),
      };
      setProvider(provider);

      await commentaryStore.prefetchAllEntries(BOOK, CHAPTER);

      expect(provider.getAllCommentary).not.toHaveBeenCalled();
    });
  });
});
