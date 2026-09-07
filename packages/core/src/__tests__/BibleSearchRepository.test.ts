import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MainTestHelper } from './helpers/MainTestHelper';
import { BibleSearchRepository } from '../Data/Repositories/BibleSearchRepository';
import { BibleSearchVersePosition } from '../Data/Models/Main/BibleSearchVersePosition';
import { SavedSearch } from '../Data/Models/Main/SavedSearch';

describe('BibleSearchRepository', () => {
  let repo: BibleSearchRepository;

  beforeAll(() => {
    MainTestHelper.initializeWithFullSchema();
    repo = new BibleSearchRepository(MainTestHelper.getProvider());
  });

  afterAll(() => {
    MainTestHelper.cleanup();
  });

  beforeEach(() => {
    MainTestHelper.clearData();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  const DOC = 'kjv';
  const DIV_GEN = '1';   // Genesis = book 1
  const DIV_EXO = '2';   // Exodus = book 2

  const GENESIS_TEXT =
    'In the beginning God created the heavens and the earth. And the earth was without form and void.';

  function genesisPositions(): BibleSearchVersePosition[] {
    return [
      new BibleSearchVersePosition({
        type: 'bible', document: DOC, division: DIV_GEN,
        verseId: 1001001, startIndex: 0, endIndex: 56,
      }),
      new BibleSearchVersePosition({
        type: 'bible', document: DOC, division: DIV_GEN,
        verseId: 1001002, startIndex: 56, endIndex: 95,
      }),
    ];
  }

  function buildGenesisIndex(): void {
    repo.buildBookIndex(DOC, DIV_GEN, GENESIS_TEXT, genesisPositions());
  }

  function createSavedSearch(overrides: Partial<{
    name: string;
    query: string;
    searchType: SavedSearch['searchType'];
    scope: SavedSearch['scope'];
    options: SavedSearch['options'];
    lastUsed: string;
    useCount: number;
    metadata: Record<string, unknown>;
  }> = {}): SavedSearch {
    return new SavedSearch({
      name: overrides.name ?? 'Test Search',
      query: overrides.query ?? 'beginning',
      searchType: overrides.searchType ?? 'multi-word',
      scope: overrides.scope ?? { scope: 'currentModule' },
      options: overrides.options ?? {},
      lastUsed: overrides.lastUsed,
      useCount: overrides.useCount,
      metadata: overrides.metadata,
    });
  }

  // ==========================================================================
  // Index Management
  // ==========================================================================

  describe('Index Management', () => {
    it('should report book as not indexed before any indexing', () => {
      expect(repo.isBookIndexed(DOC, DIV_GEN)).toBe(false);
    });

    it('should return undefined for getIndexMetadata on non-existent entry', () => {
      expect(repo.getIndexMetadata(DOC, DIV_GEN)).toBeUndefined();
    });

    it('should build a book index with metadata, FTS content, and verse positions', () => {
      buildGenesisIndex();

      expect(repo.isBookIndexed(DOC, DIV_GEN)).toBe(true);

      const meta = repo.getIndexMetadata(DOC, DIV_GEN);
      expect(meta).toBeDefined();
      expect(meta!.document).toBe(DOC);
      expect(meta!.division).toBe(DIV_GEN);
      expect(meta!.isIndexed).toBe(true);
      expect(meta!.lastIndexed).toBeDefined();
    });

    it('should store verse positions via buildBookIndex', () => {
      buildGenesisIndex();

      const pos = repo.getVersePosition(DOC, DIV_GEN, 1001001);
      expect(pos).toBeDefined();
      expect(pos!.startIndex).toBe(0);
      expect(pos!.endIndex).toBe(56);
    });

    it('should clear a book index (mark as not indexed) without deleting data', () => {
      buildGenesisIndex();
      repo.clearBookIndex(DOC, DIV_GEN);

      expect(repo.isBookIndexed(DOC, DIV_GEN)).toBe(false);

      // Metadata row still exists
      const meta = repo.getIndexMetadata(DOC, DIV_GEN);
      expect(meta).toBeDefined();
      expect(meta!.isIndexed).toBe(false);

      // Verse positions still exist
      const pos = repo.getVersePosition(DOC, DIV_GEN, 1001001);
      expect(pos).toBeDefined();
    });

    it('should delete a book index completely (metadata + FTS + positions)', () => {
      buildGenesisIndex();
      repo.deleteBookIndex(DOC, DIV_GEN);

      expect(repo.isBookIndexed(DOC, DIV_GEN)).toBe(false);
      expect(repo.getIndexMetadata(DOC, DIV_GEN)).toBeUndefined();
      expect(repo.getVersePosition(DOC, DIV_GEN, 1001001)).toBeUndefined();
    });

    it('should return unindexed books for a document', () => {
      buildGenesisIndex();
      repo.clearBookIndex(DOC, DIV_GEN);

      // Build and keep Exodus indexed
      const exoText = 'Now these are the names of the children of Israel.';
      const exoPositions = [
        new BibleSearchVersePosition({
          type: 'bible', document: DOC, division: DIV_EXO,
          verseId: 2001001, startIndex: 0, endIndex: 51,
        }),
      ];
      repo.buildBookIndex(DOC, DIV_EXO, exoText, exoPositions);

      const unindexed = repo.getUnindexedBooks(DOC);
      expect(unindexed.length).toBe(1);
      expect(unindexed[0].division).toBe(DIV_GEN);
    });

    it('should return indexed books for a document', () => {
      buildGenesisIndex();

      const exoText = 'Now these are the names.';
      const exoPositions = [
        new BibleSearchVersePosition({
          type: 'bible', document: DOC, division: DIV_EXO,
          verseId: 2001001, startIndex: 0, endIndex: 24,
        }),
      ];
      repo.buildBookIndex(DOC, DIV_EXO, exoText, exoPositions);

      const indexed = repo.getIndexedBooks(DOC);
      expect(indexed.length).toBe(2);
      expect(indexed.map(b => b.division)).toContain(DIV_GEN);
      expect(indexed.map(b => b.division)).toContain(DIV_EXO);
    });

    it('should rebuild index for already-indexed book (update path)', () => {
      buildGenesisIndex();

      const newText = 'In the beginning God created all things.';
      const newPositions = [
        new BibleSearchVersePosition({
          type: 'bible', document: DOC, division: DIV_GEN,
          verseId: 1001001, startIndex: 0, endIndex: 40,
        }),
      ];

      // Rebuild should not throw; it updates existing metadata
      repo.buildBookIndex(DOC, DIV_GEN, newText, newPositions);

      expect(repo.isBookIndexed(DOC, DIV_GEN)).toBe(true);
      const meta = repo.getIndexMetadata(DOC, DIV_GEN);
      expect(meta).toBeDefined();
      expect(meta!.isIndexed).toBe(true);
    });
  });

  // ==========================================================================
  // Verse Position Mapping
  // ==========================================================================

  describe('Verse Position Mapping', () => {
    beforeEach(() => {
      buildGenesisIndex();
    });

    it('should find verse ID at a position within the first verse', () => {
      const verseId = repo.getVerseIdAtPosition(DOC, DIV_GEN, 10);
      expect(verseId).toBe(1001001);
    });

    it('should find verse ID at a position within the second verse', () => {
      const verseId = repo.getVerseIdAtPosition(DOC, DIV_GEN, 60);
      expect(verseId).toBe(1001002);
    });

    it('should return undefined for position beyond all verses', () => {
      const verseId = repo.getVerseIdAtPosition(DOC, DIV_GEN, 9999);
      expect(verseId).toBeUndefined();
    });

    it('should find verse at exact start boundary', () => {
      const verseId = repo.getVerseIdAtPosition(DOC, DIV_GEN, 0);
      expect(verseId).toBe(1001001);
    });

    it('should find verse at boundary between verses (startIndex of second)', () => {
      // Position 56 is the start of verse 2
      const verseId = repo.getVerseIdAtPosition(DOC, DIV_GEN, 56);
      expect(verseId).toBe(1001002);
    });

    it('should get verse position by verseId', () => {
      const pos = repo.getVersePosition(DOC, DIV_GEN, 1001002);
      expect(pos).toBeDefined();
      expect(pos!.verseId).toBe(1001002);
      expect(pos!.startIndex).toBe(56);
      expect(pos!.endIndex).toBe(95);
    });

    it('should return undefined for non-existent verseId', () => {
      const pos = repo.getVersePosition(DOC, DIV_GEN, 9999999);
      expect(pos).toBeUndefined();
    });

    it('should get verses overlapping a character range', () => {
      // Range 50-70 overlaps both verse 1 (0-56) and verse 2 (56-95)
      const verses = repo.getVersesInRange(DOC, DIV_GEN, 50, 70);
      expect(verses.length).toBe(2);
      expect(verses[0].verseId).toBe(1001001);
      expect(verses[1].verseId).toBe(1001002);
    });

    it('should return empty array for range outside all verses', () => {
      const verses = repo.getVersesInRange(DOC, DIV_GEN, 200, 300);
      expect(verses.length).toBe(0);
    });

    it('should batch insert verse positions independently', () => {
      // Insert positions for Exodus separately
      const positions = [
        new BibleSearchVersePosition({
          type: 'bible', document: DOC, division: DIV_EXO,
          verseId: 2001001, startIndex: 0, endIndex: 30,
        }),
        new BibleSearchVersePosition({
          type: 'bible', document: DOC, division: DIV_EXO,
          verseId: 2001002, startIndex: 30, endIndex: 60,
        }),
      ];
      repo.batchInsertVersePositions(positions);

      const pos1 = repo.getVersePosition(DOC, DIV_EXO, 2001001);
      expect(pos1).toBeDefined();
      expect(pos1!.startIndex).toBe(0);

      const pos2 = repo.getVersePosition(DOC, DIV_EXO, 2001002);
      expect(pos2).toBeDefined();
      expect(pos2!.startIndex).toBe(30);
    });
  });

  // ==========================================================================
  // Saved Searches
  // ==========================================================================

  describe('Saved Searches', () => {
    it('should save a search and return it with searchId and createdDate', () => {
      const search = createSavedSearch({ name: 'Find love', query: 'love' });
      const saved = repo.saveSearch(search);

      expect(saved.searchId).toBeDefined();
      expect(saved.searchId).toBeGreaterThan(0);
      expect(saved.name).toBe('Find love');
      expect(saved.query).toBe('love');
      expect(saved.createdDate).toBeDefined();
      expect(saved.useCount).toBe(0);
    });

    it('should retrieve all saved searches ordered by name', () => {
      repo.saveSearch(createSavedSearch({ name: 'Zebra' }));
      repo.saveSearch(createSavedSearch({ name: 'Apple' }));
      repo.saveSearch(createSavedSearch({ name: 'Mango' }));

      const all = repo.getSavedSearches();
      expect(all.length).toBe(3);
      expect(all[0].name).toBe('Apple');
      expect(all[1].name).toBe('Mango');
      expect(all[2].name).toBe('Zebra');
    });

    it('should retrieve a saved search by ID', () => {
      const saved = repo.saveSearch(createSavedSearch({ name: 'By ID test' }));
      const found = repo.getSavedSearch(saved.searchId!);

      expect(found).toBeDefined();
      expect(found!.name).toBe('By ID test');
      expect(found!.searchType).toBe('multi-word');
    });

    it('should return undefined for non-existent search ID', () => {
      const found = repo.getSavedSearch(99999);
      expect(found).toBeUndefined();
    });

    it('should update a saved search', () => {
      const saved = repo.saveSearch(createSavedSearch({ name: 'Original' }));
      saved.name = 'Updated';
      saved.query = 'new query';
      saved.lastUsed = new Date().toISOString();
      saved.useCount = 5;

      repo.updateSavedSearch(saved);

      const found = repo.getSavedSearch(saved.searchId!);
      expect(found!.name).toBe('Updated');
      expect(found!.query).toBe('new query');
      expect(found!.useCount).toBe(5);
      expect(found!.lastUsed).toBeDefined();
    });

    it('should delete a saved search and return true', () => {
      const saved = repo.saveSearch(createSavedSearch());
      const deleted = repo.deleteSavedSearch(saved.searchId!);

      expect(deleted).toBe(true);
      expect(repo.getSavedSearch(saved.searchId!)).toBeUndefined();
    });

    it('should return false when deleting non-existent search', () => {
      const deleted = repo.deleteSavedSearch(99999);
      expect(deleted).toBe(false);
    });

    it('should get recent saved searches ordered by last_used DESC (only non-null)', () => {
      const s1 = repo.saveSearch(createSavedSearch({ name: 'Old' }));
      s1.lastUsed = '2025-01-01T00:00:00.000Z';
      repo.updateSavedSearch(s1);

      const s2 = repo.saveSearch(createSavedSearch({ name: 'New' }));
      s2.lastUsed = '2025-06-01T00:00:00.000Z';
      repo.updateSavedSearch(s2);

      // s3 has no lastUsed - should NOT appear
      repo.saveSearch(createSavedSearch({ name: 'Never Used' }));

      const recent = repo.getRecentSavedSearches(10);
      expect(recent.length).toBe(2);
      expect(recent[0].name).toBe('New');
      expect(recent[1].name).toBe('Old');
    });

    it('should respect limit on getRecentSavedSearches', () => {
      for (let i = 0; i < 5; i++) {
        const s = repo.saveSearch(createSavedSearch({ name: `S${i}` }));
        s.lastUsed = `2025-0${i + 1}-01T00:00:00.000Z`;
        repo.updateSavedSearch(s);
      }

      const recent = repo.getRecentSavedSearches(2);
      expect(recent.length).toBe(2);
    });

    it('should get popular saved searches ordered by use_count DESC', () => {
      const s1 = repo.saveSearch(createSavedSearch({ name: 'Low' }));
      s1.useCount = 3;
      repo.updateSavedSearch(s1);

      const s2 = repo.saveSearch(createSavedSearch({ name: 'High' }));
      s2.useCount = 100;
      repo.updateSavedSearch(s2);

      const s3 = repo.saveSearch(createSavedSearch({ name: 'Mid' }));
      s3.useCount = 20;
      repo.updateSavedSearch(s3);

      const popular = repo.getPopularSavedSearches(10);
      expect(popular.length).toBe(3);
      expect(popular[0].name).toBe('High');
      expect(popular[1].name).toBe('Mid');
      expect(popular[2].name).toBe('Low');
    });

    it('should round-trip scope and options JSON correctly', () => {
      const search = createSavedSearch({
        name: 'Complex scope',
        searchType: 'proximity',
        scope: {
          scope: 'range',
          modules: ['kjv', 'esv'],
          range: { startBook: 1, endBook: 5, predefinedRange: 'Pentateuch' },
        },
        options: {
          caseSensitive: true,
          wholeWord: true,
          proximityDistance: 5,
          maxResults: 50,
          includeContext: true,
        },
      });

      const saved = repo.saveSearch(search);
      const found = repo.getSavedSearch(saved.searchId!);

      expect(found!.scope.scope).toBe('range');
      expect(found!.scope.modules).toEqual(['kjv', 'esv']);
      expect(found!.scope.range!.predefinedRange).toBe('Pentateuch');
      expect(found!.options.caseSensitive).toBe(true);
      expect(found!.options.proximityDistance).toBe(5);
      expect(found!.options.maxResults).toBe(50);
    });

    it('should preserve metadata JSON on update', () => {
      const saved = repo.saveSearch(createSavedSearch({ name: 'With meta' }));
      saved.metadata = { color: 'blue', pinned: true };
      repo.updateSavedSearch(saved);

      const found = repo.getSavedSearch(saved.searchId!);
      expect(found!.metadata).toBeDefined();
      expect(found!.metadata!.color).toBe('blue');
      expect(found!.metadata!.pinned).toBe(true);
    });
  });


  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle getVersesInRange with exact verse boundaries', () => {
      buildGenesisIndex();
      // Range exactly matching verse 1: [0, 56)
      const verses = repo.getVersesInRange(DOC, DIV_GEN, 0, 56);
      expect(verses.length).toBe(1);
      expect(verses[0].verseId).toBe(1001001);
    });

    it('should not find verses for a different document', () => {
      buildGenesisIndex();
      const pos = repo.getVersePosition('esv', DIV_GEN, 1001001);
      expect(pos).toBeUndefined();
    });

    it('should isolate indexes between different documents', () => {
      buildGenesisIndex();

      // Build the same division for a different document
      const esvText = 'In the beginning, God created the heavens and the earth.';
      const esvPositions = [
        new BibleSearchVersePosition({
          type: 'bible', document: 'esv', division: DIV_GEN,
          verseId: 1001001, startIndex: 0, endIndex: 56,
        }),
      ];
      repo.buildBookIndex('esv', DIV_GEN, esvText, esvPositions);

      // Both should be independently indexed
      expect(repo.isBookIndexed(DOC, DIV_GEN)).toBe(true);
      expect(repo.isBookIndexed('esv', DIV_GEN)).toBe(true);

      // Deleting one should not affect the other
      repo.deleteBookIndex('esv', DIV_GEN);
      expect(repo.isBookIndexed(DOC, DIV_GEN)).toBe(true);
      expect(repo.isBookIndexed('esv', DIV_GEN)).toBe(false);
    });

    it('should handle empty saved search list gracefully', () => {
      expect(repo.getSavedSearches()).toEqual([]);
      expect(repo.getRecentSavedSearches()).toEqual([]);
      expect(repo.getPopularSavedSearches()).toEqual([]);
    });
  });
});
