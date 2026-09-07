import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { UserCrossReferenceRepository } from '../Data/Repositories/UserCrossReferenceRepository';
import { UserCrossReference } from '../Data/Models/User/UserCrossReference';
import { UserTestHelper } from './helpers/UserTestHelper';

describe('UserCrossReferenceRepository', () => {
  let repo: UserCrossReferenceRepository;

  beforeAll(() => {
    UserTestHelper.initialize();
    repo = new UserCrossReferenceRepository(UserTestHelper.getProvider());
  });

  afterAll(() => {
    UserTestHelper.cleanup();
  });

  beforeEach(() => {
    UserTestHelper.clearData();
  });

  // ==========================================================================
  // Create Tests
  // ==========================================================================

  describe('create', () => {
    it('should create a cross-reference and assign an ID', () => {
      const xref = new UserCrossReference({
        fromVerseIdStart: 43003016, // John 3:16
        toVerseIdStart: 45008028   // Romans 8:28
      });

      const created = repo.create(xref);

      expect(created.userXrefId).toBeDefined();
      expect(created.userXrefId).toBeGreaterThan(0);
      expect(created.fromVerseIdStart).toBe(43003016);
      expect(created.toVerseIdStart).toBe(45008028);
    });

    it('should create a cross-reference with notes', () => {
      const xref = new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028,
        notes: 'Both speak of God\'s love and purpose'
      });

      const created = repo.create(xref);
      const fetched = repo.getById(created.userXrefId!);

      expect(fetched).toBeDefined();
      expect(fetched!.notes).toBe('Both speak of God\'s love and purpose');
    });

    it('should create a cross-reference with metadata', () => {
      const xref = new UserCrossReference({
        fromVerseIdStart: 1001001, // Genesis 1:1
        toVerseIdStart: 43001001, // John 1:1
        metadata: { category: 'creation', strength: 'strong' }
      });

      const created = repo.create(xref);
      const fetched = repo.getById(created.userXrefId!);

      expect(fetched!.metadata).toBeDefined();
      expect(fetched!.metadata!.category).toBe('creation');
      expect(fetched!.metadata!.strength).toBe('strong');
    });

    it('should create a cross-reference without notes or metadata', () => {
      const xref = new UserCrossReference({
        fromVerseIdStart: 19023001, // Psalm 23:1
        toVerseIdStart: 43010011   // John 10:11
      });

      const created = repo.create(xref);
      const fetched = repo.getById(created.userXrefId!);

      expect(fetched).toBeDefined();
      expect(fetched!.notes).toBeNull();
      expect(fetched!.metadata).toBeUndefined();
    });
  });

  // ==========================================================================
  // Get By ID Tests
  // ==========================================================================

  describe('getById', () => {
    it('should return a cross-reference by ID', () => {
      const created = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028
      }));

      const fetched = repo.getById(created.userXrefId!);

      expect(fetched).toBeDefined();
      expect(fetched!.userXrefId).toBe(created.userXrefId);
      expect(fetched!.fromVerseIdStart).toBe(43003016);
      expect(fetched!.toVerseIdStart).toBe(45008028);
    });

    it('should return undefined for non-existent ID', () => {
      const fetched = repo.getById(99999);
      expect(fetched).toBeUndefined();
    });
  });

  // ==========================================================================
  // Get For Verse (Bidirectional) Tests
  // ==========================================================================

  describe('getForVerse', () => {
    it('should return cross-references where verse is the source', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 45008028 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 62004008 }));

      const results = repo.getForVerse(43003016);
      expect(results).toHaveLength(2);
    });

    it('should return cross-references where verse is the target', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 45008028, toVerseIdStart: 43003016 }));

      const results = repo.getForVerse(43003016);
      expect(results).toHaveLength(1);
      expect(results[0].fromVerseIdStart).toBe(45008028);
    });

    it('should return both directions for a verse', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 45008028 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 62004008, toVerseIdStart: 43003016 }));

      const results = repo.getForVerse(43003016);
      expect(results).toHaveLength(2);
    });

    it('should return empty array for verse with no cross-references', () => {
      const results = repo.getForVerse(1001001);
      expect(results).toEqual([]);
    });

    it('should not return unrelated cross-references', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 45008028, toVerseIdStart: 62004008 }));

      const results = repo.getForVerse(43003016);
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Get From Verse Tests
  // ==========================================================================

  describe('getFromVerse', () => {
    it('should return only cross-references originating from the verse', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 45008028 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 62004008 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 45008028, toVerseIdStart: 43003016 }));

      const results = repo.getFromVerse(43003016);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.fromVerseIdStart === 43003016)).toBe(true);
    });

    it('should return empty array when no outgoing references', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 45008028, toVerseIdStart: 43003016 }));

      const results = repo.getFromVerse(43003016);
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Get To Verse Tests
  // ==========================================================================

  describe('getToVerse', () => {
    it('should return only cross-references pointing to the verse', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 45008028 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 62004008, toVerseIdStart: 45008028 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 45008028, toVerseIdStart: 43003016 }));

      const results = repo.getToVerse(45008028);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.toVerseIdStart === 45008028)).toBe(true);
    });

    it('should return empty array when no incoming references', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 45008028 }));

      const results = repo.getToVerse(43003016);
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Get All Tests
  // ==========================================================================

  describe('getAll', () => {
    it('should return all cross-references', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 45008028 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 1001001, toVerseIdStart: 43001001 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 19023001, toVerseIdStart: 43010011 }));

      const all = repo.getAll();
      expect(all).toHaveLength(3);
    });

    it('should return empty array when no cross-references exist', () => {
      const all = repo.getAll();
      expect(all).toEqual([]);
    });
  });

  // ==========================================================================
  // Update Tests
  // ==========================================================================

  describe('update', () => {
    it('should update cross-reference notes', () => {
      const xref = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028,
        notes: 'Original note'
      }));

      xref.notes = 'Updated note about God\'s love';
      repo.update(xref);

      const fetched = repo.getById(xref.userXrefId!);
      expect(fetched!.notes).toBe('Updated note about God\'s love');
    });

    it('should update verse IDs', () => {
      const xref = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028
      }));

      xref.setToRange(62004008); // 1 John 4:8
      repo.update(xref);

      const fetched = repo.getById(xref.userXrefId!);
      expect(fetched!.toVerseIdStart).toBe(62004008);
      // setToRange collapses the end onto the start for a single verse, so the
      // row stays valid; assigning toVerseIdStart alone would have left the
      // old end behind and tripped the CHECK.
      expect(fetched!.toVerseIdEnd).toBe(62004008);
    });

    it('should update a cross-reference to span a passage', () => {
      const xref = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028
      }));

      xref.setFromRange(40005003, 40005012); // Matthew 5:3-12
      repo.update(xref);

      const fetched = repo.getById(xref.userXrefId!);
      expect(fetched!.fromVerseIdStart).toBe(40005003);
      expect(fetched!.fromVerseIdEnd).toBe(40005012);
      expect(fetched!.isSingleVerseSource()).toBe(false);
    });

    it('should find a passage-spanning cross-reference by any verse inside it', () => {
      repo.create(new UserCrossReference({
        fromVerseIdStart: 40005003,
        fromVerseIdEnd: 40005012,
        toVerseIdStart: 19001001,
        toVerseIdEnd: 19001006
      }));

      // A verse in the middle of the source passage, not its first verse.
      const results = repo.getFromVerse(40005007);
      expect(results).toHaveLength(1);
      expect(results[0].toVerseIdEnd).toBe(19001006);

      // And the same from the target side.
      expect(repo.getToVerse(19001003)).toHaveLength(1);

      // A verse just outside the range must not match.
      expect(repo.getFromVerse(40005013)).toHaveLength(0);
    });

    it('should update metadata', () => {
      const xref = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028,
        metadata: { category: 'love' }
      }));

      xref.metadata = { category: 'salvation', confidence: 'high' };
      repo.update(xref);

      const fetched = repo.getById(xref.userXrefId!);
      expect(fetched!.metadata!.category).toBe('salvation');
      expect(fetched!.metadata!.confidence).toBe('high');
    });

    it('should throw when updating without ID', () => {
      const xref = new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028
      });

      expect(() => repo.update(xref)).toThrow('Cannot update cross-reference without ID');
    });
  });

  // ==========================================================================
  // Delete Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete an existing cross-reference', () => {
      const xref = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028
      }));

      const result = repo.delete(xref.userXrefId!);
      expect(result).toBe(true);

      const fetched = repo.getById(xref.userXrefId!);
      expect(fetched).toBeUndefined();
    });

    it('should return false when deleting non-existent cross-reference', () => {
      const result = repo.delete(99999);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Delete For Verse Tests
  // ==========================================================================

  describe('deleteForVerse', () => {
    it('should delete all cross-references from a verse', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 45008028 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 62004008 }));

      const count = repo.deleteForVerse(43003016);
      expect(count).toBe(2);

      const remaining = repo.getAll();
      expect(remaining).toHaveLength(0);
    });

    it('should delete all cross-references to a verse', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 45008028, toVerseIdStart: 43003016 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 62004008, toVerseIdStart: 43003016 }));

      const count = repo.deleteForVerse(43003016);
      expect(count).toBe(2);
    });

    it('should delete cross-references in both directions', () => {
      repo.create(new UserCrossReference({ fromVerseIdStart: 43003016, toVerseIdStart: 45008028 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 62004008, toVerseIdStart: 43003016 }));
      repo.create(new UserCrossReference({ fromVerseIdStart: 1001001, toVerseIdStart: 43001001 })); // unrelated

      const count = repo.deleteForVerse(43003016);
      expect(count).toBe(2);

      const remaining = repo.getAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].fromVerseIdStart).toBe(1001001);
    });

    it('should return 0 when no cross-references exist for the verse', () => {
      const count = repo.deleteForVerse(99099099);
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // Metadata Round-Trip Tests
  // ==========================================================================

  describe('metadata round-trip', () => {
    it('should round-trip complex metadata', () => {
      const xref = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028,
        metadata: {
          category: 'salvation',
          strength: 'strong',
          tags: ['love', 'sacrifice'],
          addedBy: 'user'
        }
      }));

      const fetched = repo.getById(xref.userXrefId!);
      expect(fetched!.metadata).toBeDefined();
      expect(fetched!.metadata!.category).toBe('salvation');
      expect(fetched!.metadata!.tags).toEqual(['love', 'sacrifice']);
    });

    it('should handle null metadata', () => {
      const xref = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028
      }));

      const fetched = repo.getById(xref.userXrefId!);
      expect(fetched!.metadata).toBeUndefined();
    });
  });

  // ==========================================================================
  // Notes Field Tests
  // ==========================================================================

  describe('notes field', () => {
    it('should store and retrieve notes with special characters', () => {
      const xref = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028,
        notes: 'God\'s love: "For God so loved..." - compare with Romans'
      }));

      const fetched = repo.getById(xref.userXrefId!);
      expect(fetched!.notes).toBe('God\'s love: "For God so loved..." - compare with Romans');
    });

    it('should allow clearing notes via update', () => {
      const xref = repo.create(new UserCrossReference({
        fromVerseIdStart: 43003016,
        toVerseIdStart: 45008028,
        notes: 'Some notes'
      }));

      xref.notes = undefined;
      repo.update(xref);

      const fetched = repo.getById(xref.userXrefId!);
      expect(fetched!.notes).toBeNull();
    });
  });
});
