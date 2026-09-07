import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { CrossReferenceRepository } from '../Data/Repositories/CrossReferenceRepository';
import { CrossReferenceGroup } from '../Data/Models/CrossReference/CrossReferenceGroup';
import { ModuleCrossRefEntry } from '../Data/Models/CrossReference/CrossReferenceEntry';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';

// ---------------------------------------------------------------------------
// Read-only SQLite provider for testing against real module databases
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Database path
// ---------------------------------------------------------------------------
const DB_PATH = path.resolve(__dirname, '../../../desktop/data/modules/xref_tsk.db');

describe.skipIf(!fs.existsSync(DB_PATH))('CrossReferenceRepository (xref_tsk.db)', () => {
  let provider: TestSqliteProvider;
  let repo: CrossReferenceRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(DB_PATH);
    repo = new CrossReferenceRepository(provider);
  });

  afterAll(() => {
    provider.close();
  });

  // ========================================================================
  // Module Info
  // ========================================================================

  describe('getModuleInfo', () => {
    it('should return module info', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      expect(info!.abbreviation).toBeDefined();
      expect(info!.fullName).toBeDefined();
      expect(typeof info!.abbreviation).toBe('string');
      expect(info!.fullName.length).toBeGreaterThan(0);
    });

    it('should have a language code', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      expect(info!.languageCode).toBeDefined();
    });

    it('should have moduleType set to cross_reference', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      expect(info!.moduleType).toBe('cross_reference');
    });
  });

  // ========================================================================
  // getGroupsForVerse
  // ========================================================================

  describe('getGroupsForVerse', () => {
    it('should return cross-reference groups for John 3:16 (43003016)', () => {
      const groups = repo.getGroupsForVerse(43003016);
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        expect(group).toBeInstanceOf(CrossReferenceGroup);
        expect(group.verseId).toBe(43003016);
        expect(group.groupId).toBeDefined();
      }
    });

    it('should return cross-reference groups for Genesis 1:1 (1001001)', () => {
      const groups = repo.getGroupsForVerse(1001001);
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        expect(group.verseId).toBe(1001001);
      }
    });

    it('should return cross-reference groups for Psalm 23:1 (19023001)', () => {
      const groups = repo.getGroupsForVerse(19023001);
      expect(groups.length).toBeGreaterThan(0);
    });

    it('should return groups ordered by sort_order', () => {
      const groups = repo.getGroupsForVerse(43003016);
      if (groups.length > 1) {
        for (let i = 1; i < groups.length; i++) {
          const prevOrder = groups[i - 1].sortOrder ?? 0;
          const currOrder = groups[i].sortOrder ?? 0;
          expect(currOrder).toBeGreaterThanOrEqual(prevOrder);
        }
      }
    });

    it('should return empty array for a non-existent verse', () => {
      const groups = repo.getGroupsForVerse(99099099);
      expect(groups).toEqual([]);
    });
  });

  // ========================================================================
  // getEntriesForGroup
  // ========================================================================

  describe('getEntriesForGroup', () => {
    it('should return entries for a specific group', () => {
      const groups = repo.getGroupsForVerse(43003016);
      expect(groups.length).toBeGreaterThan(0);

      const entries = repo.getEntriesForGroup(groups[0].groupId!);
      expect(entries.length).toBeGreaterThan(0);

      for (const entry of entries) {
        expect(entry).toBeInstanceOf(ModuleCrossRefEntry);
        expect(entry.groupId).toBe(groups[0].groupId);
        expect(entry.targetVerseId).toBeGreaterThan(0);
      }
    });

    it('should return entries with valid target verse IDs', () => {
      const groups = repo.getGroupsForVerse(1001001);
      expect(groups.length).toBeGreaterThan(0);

      const entries = repo.getEntriesForGroup(groups[0].groupId!);
      for (const entry of entries) {
        // Verse IDs should be in valid range (1001001 to 66022021)
        expect(entry.targetVerseId).toBeGreaterThanOrEqual(1001001);
        expect(entry.targetVerseId).toBeLessThanOrEqual(66022021);
      }
    });

    it('should return empty array for a non-existent group ID', () => {
      const entries = repo.getEntriesForGroup(999999999);
      expect(entries).toEqual([]);
    });
  });

  // ========================================================================
  // getGroupsWithEntries
  // ========================================================================

  describe('getGroupsWithEntries', () => {
    it('should return combined groups and entries for a verse', () => {
      const groupsWithEntries = repo.getGroupsWithEntries(43003016);
      expect(groupsWithEntries.length).toBeGreaterThan(0);

      for (const { group, entries } of groupsWithEntries) {
        expect(group).toBeInstanceOf(CrossReferenceGroup);
        expect(group.verseId).toBe(43003016);
        expect(entries.length).toBeGreaterThan(0);

        for (const entry of entries) {
          expect(entry).toBeInstanceOf(ModuleCrossRefEntry);
          expect(entry.groupId).toBe(group.groupId);
        }
      }
    });

    it('should return phrase-level groups for TSK', () => {
      // TSK typically has phrase-level cross-references
      const groupsWithEntries = repo.getGroupsWithEntries(43003016);
      const phraseGroups = groupsWithEntries.filter(gwe => gwe.group.isPhraseLevel());
      // TSK should have phrase-level grouping for most verses
      expect(phraseGroups.length).toBeGreaterThan(0);
    });

    it('should match separate getGroupsForVerse + getEntriesForGroup calls', () => {
      const verseId = 19023001; // Psalm 23:1
      const combined = repo.getGroupsWithEntries(verseId);
      const groups = repo.getGroupsForVerse(verseId);

      expect(combined.length).toBe(groups.length);

      for (let i = 0; i < combined.length; i++) {
        expect(combined[i].group.groupId).toBe(groups[i].groupId);
        const separateEntries = repo.getEntriesForGroup(groups[i].groupId!);
        expect(combined[i].entries.length).toBe(separateEntries.length);
      }
    });

    it('should return empty array for a verse with no cross-references', () => {
      const groupsWithEntries = repo.getGroupsWithEntries(99099099);
      expect(groupsWithEntries).toEqual([]);
    });
  });

  // ========================================================================
  // getReverseReferences
  // ========================================================================

  describe('getReverseReferences', () => {
    it('should find verses that reference a commonly cited verse', () => {
      // Pick a verse that is likely a cross-reference target
      // First, get entries for John 3:16 and use one of its targets
      const groupsWithEntries = repo.getGroupsWithEntries(43003016);
      expect(groupsWithEntries.length).toBeGreaterThan(0);

      const targetVerseId = groupsWithEntries[0].entries[0].targetVerseId;
      const reverseRefs = repo.getReverseReferences(targetVerseId);
      // The target verse should be referenced from at least one source
      expect(reverseRefs.length).toBeGreaterThan(0);

      for (const ref of reverseRefs) {
        expect(ref.sourceVerseId).toBeGreaterThan(0);
      }
    });

    it('should include John 3:16 as a source when checking its target', () => {
      const groupsWithEntries = repo.getGroupsWithEntries(43003016);
      expect(groupsWithEntries.length).toBeGreaterThan(0);

      const targetVerseId = groupsWithEntries[0].entries[0].targetVerseId;
      const reverseRefs = repo.getReverseReferences(targetVerseId);

      const hasJohn316AsSource = reverseRefs.some(r => r.sourceVerseId === 43003016);
      expect(hasJohn316AsSource).toBe(true);
    });

    it('should return empty array for a verse that is never a target', () => {
      // Use a very obscure verse ID that is unlikely to be a cross-reference target
      const reverseRefs = repo.getReverseReferences(99099099);
      expect(reverseRefs).toEqual([]);
    });

    it('should find sources whose target range contains the verse, not only ranges starting on it', () => {
      // A link's target is an inclusive range, and 11.6% of TSK's links span more
      // than one verse. Matching `verse_id_start` exactly made every verse sitting
      // *inside* a range invisible here - Prov 8:23 reported 12 sources, not 29.
      //
      // The ranged link is discovered from the module rather than hardcoded, so
      // this keeps testing the real behaviour if the module is ever regenerated.
      const ranged = provider.queryOne<{ verse_id_start: number; verse_id_end: number }>(
        `SELECT verse_id_start, verse_id_end FROM verse_link
          WHERE source_type = 'cross_reference_group' AND verse_id_end > verse_id_start
          LIMIT 1`
      );
      expect(ranged).toBeDefined();

      const insideRange = ranged!.verse_id_start + 1;
      expect(insideRange).toBeLessThanOrEqual(ranged!.verse_id_end);

      // Strictly more than the containing link alone: the point is that a verse
      // inside a range resolves at all, where it previously returned nothing.
      expect(repo.getReverseReferences(insideRange).length).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // getEntryCount
  // ========================================================================

  describe('getEntryCount', () => {
    it('should return a positive count for John 3:16', () => {
      const count = repo.getEntryCount(43003016);
      expect(count).toBeGreaterThan(0);
    });

    it('should return a positive count for Genesis 1:1', () => {
      const count = repo.getEntryCount(1001001);
      expect(count).toBeGreaterThan(0);
    });

    it('should match the total number of entries across all groups', () => {
      const verseId = 43003016;
      const count = repo.getEntryCount(verseId);
      const groupsWithEntries = repo.getGroupsWithEntries(verseId);
      const totalEntries = groupsWithEntries.reduce((sum, gwe) => sum + gwe.entries.length, 0);
      expect(count).toBe(totalEntries);
    });

    it('should return 0 for a non-existent verse', () => {
      const count = repo.getEntryCount(99099099);
      expect(count).toBe(0);
    });
  });

  // ========================================================================
  // CrossReferenceGroup model methods
  // ========================================================================

  describe('CrossReferenceGroup model methods', () => {
    it('isPhraseLevel should return true when phrase is set', () => {
      const groups = repo.getGroupsForVerse(43003016);
      const phraseGroup = groups.find(g => g.phrase !== undefined && g.phrase !== null);
      if (phraseGroup) {
        expect(phraseGroup.isPhraseLevel()).toBe(true);
      }
    });

    it('isPhraseLevel should return false when phrase is not set', () => {
      const group = new CrossReferenceGroup({ verseId: 1001001 });
      expect(group.isPhraseLevel()).toBe(false);
    });
  });

  // ========================================================================
  // ModuleCrossRefEntry model methods
  // ========================================================================

  describe('ModuleCrossRefEntry model methods', () => {
    it('isRange should detect verse range entries', () => {
      // Iterate through some entries to find a range
      const groups = repo.getGroupsForVerse(1001001);
      let foundRange = false;
      for (const group of groups) {
        const entries = repo.getEntriesForGroup(group.groupId!);
        for (const entry of entries) {
          if (entry.targetVerseEndId !== undefined) {
            expect(entry.isRange()).toBe(true);
            foundRange = true;
            break;
          }
        }
        if (foundRange) break;
      }
      // Not all verses will have range entries, so this is informational
    });

    it('isRange should return false for single-verse entries', () => {
      const entry = new ModuleCrossRefEntry({
        groupId: 1,
        targetVerseId: 1001001,
      });
      expect(entry.isRange()).toBe(false);
    });
  });
});
