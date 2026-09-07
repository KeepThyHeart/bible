import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { UserTextMarkupRepository } from '../Data/Repositories/UserTextMarkupRepository';
import { UserTextMarkup } from '../Data/Models/User/UserTextMarkup';
import { HIGHLIGHT_COLOR_HEX } from '../Data/Core/Colors';
import { UserTestHelper } from './helpers/UserTestHelper';

describe('UserTextMarkupRepository', () => {
  let repo: UserTextMarkupRepository;

  beforeAll(() => {
    UserTestHelper.initialize();
    repo = new UserTextMarkupRepository(UserTestHelper.getProvider());
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
    it('should create a markup and assign an ID', async () => {
      const markup = new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      });

      const created = await repo.create(markup);

      expect(created.markupId).toBeDefined();
      expect(created.markupId).toBeGreaterThan(0);
      expect(created.moduleId).toBe(1);
      expect(created.verseIdStart).toBe(43003016);
      expect(created.color).toBe('yellow');
    });

    it('should create a markup with all fields', async () => {
      // Create a real note first so the FK constraint is satisfied
      const provider = UserTestHelper.getProvider();
      provider.execute(
        `INSERT INTO user_note (content, note_type) VALUES ('test note', 'verse_note')`
      );
      const noteRow = provider.queryOne<{ note_id: number }>('SELECT last_insert_rowid() as note_id');
      const noteId = noteRow!.note_id;

      const markup = new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        verseIdEnd: 43003018,
        textStart: 0,
        textEnd: 5,
        color: 'green',
        noteId,
        metadata: { markupType: 'highlight', version: 1 }
      });

      const created = await repo.create(markup);
      const fetched = await repo.getById(created.markupId!);

      expect(fetched).not.toBeNull();
      expect(fetched!.moduleId).toBe(1);
      expect(fetched!.verseIdStart).toBe(43003016);
      expect(fetched!.verseIdEnd).toBe(43003018);
      expect(fetched!.textStart).toBe(0);
      expect(fetched!.textEnd).toBe(5);
      // colour storage moved from the six literal palette names to hex
      // #RRGGBB (matching collection.color). Writes normalise, so a palette name
      // supplied by the caller comes back as its canonical hex; getColorName()
      // resolves it back to the swatch.
      expect(fetched!.color).toBe(HIGHLIGHT_COLOR_HEX.green.toUpperCase());
      expect(fetched!.getColorName()).toBe('green');
      expect(fetched!.noteId).toBe(noteId);
      expect(fetched!.metadata).toBeDefined();
      expect(fetched!.metadata!.markupType).toBe('highlight');
    });

    it('should create multiple markups on the same verse', async () => {
      await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      }));
      await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'blue'
      }));

      const results = await repo.getForVerse(43003016, 1);
      expect(results).toHaveLength(2);
    });

    it('should create markups with different colors', async () => {
      const colors = ['yellow', 'green', 'blue', 'red', 'purple', 'orange'] as const;

      for (const color of colors) {
        await repo.create(new UserTextMarkup({
          moduleId: 1,
          verseIdStart: 43003016 + colors.indexOf(color),
          color
        }));
      }

      const all = await repo.getForModule(1);
      expect(all).toHaveLength(6);
    });
  });

  // ==========================================================================
  // Get By ID Tests
  // ==========================================================================

  describe('getById', () => {
    it('should return a markup by ID', async () => {
      const created = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      }));

      const fetched = await repo.getById(created.markupId!);

      expect(fetched).not.toBeNull();
      expect(fetched!.markupId).toBe(created.markupId);
    });

    it('should return null for non-existent ID', async () => {
      const fetched = await repo.getById(99999);
      expect(fetched).toBeNull();
    });
  });

  // ==========================================================================
  // Update Tests
  // ==========================================================================

  describe('update', () => {
    it('should update markup color', async () => {
      const markup = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      }));

      markup.color = 'red';
      await repo.update(markup);

      const fetched = await repo.getById(markup.markupId!);
      // writes normalise palette names to canonical hex.
      expect(fetched!.color).toBe(HIGHLIGHT_COLOR_HEX.red.toUpperCase());
      expect(fetched!.getColorName()).toBe('red');
    });

    it('should store a custom hex colour verbatim', async () => {
      const markup = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: '#123456'
      }));

      const fetched = await repo.getById(markup.markupId!);
      expect(fetched!.color).toBe('#123456');
      // Not a palette swatch, so no name resolves.
      expect(fetched!.getColorName()).toBeUndefined();
    });

    it('should update verse range', async () => {
      const markup = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      }));

      markup.verseIdEnd = 43003018;
      await repo.update(markup);

      const fetched = await repo.getById(markup.markupId!);
      expect(fetched!.verseIdEnd).toBe(43003018);
    });

    it('should update metadata', async () => {
      const markup = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      }));

      markup.metadata = { markupType: 'underline', underlineStyle: 'wavy' };
      await repo.update(markup);

      const fetched = await repo.getById(markup.markupId!);
      expect(fetched!.metadata!.markupType).toBe('underline');
      expect(fetched!.metadata!.underlineStyle).toBe('wavy');
    });

    it('should throw when updating without ID', async () => {
      const markup = new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      });

      await expect(repo.update(markup)).rejects.toThrow('Cannot update markup without ID');
    });
  });

  // ==========================================================================
  // Delete Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete a markup by ID', async () => {
      const markup = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      }));

      await repo.delete(markup.markupId!);

      const fetched = await repo.getById(markup.markupId!);
      expect(fetched).toBeNull();
    });
  });

  // ==========================================================================
  // Get For Verse (Range-Aware) Tests
  // ==========================================================================

  describe('getForVerse', () => {
    it('should return single-verse markups matching the verse', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003017, color: 'blue' }));

      const results = await repo.getForVerse(43003016, 1);
      expect(results).toHaveLength(1);
      expect(results[0].verseIdStart).toBe(43003016);
    });

    it('should return multi-verse markups that contain the verse', async () => {
      await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003014,
        verseIdEnd: 43003018,
        color: 'green'
      }));

      const results = await repo.getForVerse(43003016, 1);
      expect(results).toHaveLength(1);
    });

    it('should scope results by moduleId', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 2, verseIdStart: 43003016, color: 'blue' }));

      const results = await repo.getForVerse(43003016, 1);
      expect(results).toHaveLength(1);
      expect(results[0].moduleId).toBe(1);
    });

    it('should return empty array for verse with no markups', async () => {
      const results = await repo.getForVerse(1001001, 1);
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Get For Verse Range Tests
  // ==========================================================================

  describe('getForVerseRange', () => {
    it('should return markups within a verse range', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003014, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'blue' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003020, color: 'red' }));

      const results = await repo.getForVerseRange(43003015, 43003018, 1);
      // R-1: single-verse markups now store end = start, so overlap is exact.
      //   43003014: end(14) >= 15? no  => excluded (v. 14 is NOT in 15..18)
      //   43003016: end(16) >= 15 and start(16) <= 18 => included
      //   43003020: start(20) <= 18? no => excluded
      //
      // Before R-1 these rows had a NULL end, and the `verse_id_end IS NULL` arm
      // of the query matched unconditionally - so v. 14 was wrongly returned for
      // a query of 15..18. Materialising the end is what makes overlap exact.
      expect(results).toHaveLength(1);
      expect(results[0].verseIdStart).toBe(43003016);
    });

    it('should return multi-verse markups that overlap the range', async () => {
      await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003010,
        verseIdEnd: 43003020,
        color: 'green'
      }));

      const results = await repo.getForVerseRange(43003015, 43003018, 1);
      expect(results).toHaveLength(1);
    });

    it('should scope by moduleId', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 2, verseIdStart: 43003016, color: 'blue' }));

      const results = await repo.getForVerseRange(43003015, 43003018, 1);
      expect(results).toHaveLength(1);
      expect(results[0].moduleId).toBe(1);
    });
  });

  // ==========================================================================
  // Get For Module Tests
  // ==========================================================================

  describe('getForModule', () => {
    it('should return all markups for a module', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 45008028, color: 'blue' }));
      await repo.create(new UserTextMarkup({ moduleId: 2, verseIdStart: 43003016, color: 'red' }));

      const results = await repo.getForModule(1);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.moduleId === 1)).toBe(true);
    });

    it('should return empty array for module with no markups', async () => {
      const results = await repo.getForModule(999);
      expect(results).toEqual([]);
    });

    it('should return markups ordered by verse_id_start', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 45008028, color: 'blue' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 1001001, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'red' }));

      const results = await repo.getForModule(1);
      expect(results[0].verseIdStart).toBe(1001001);
      expect(results[1].verseIdStart).toBe(43003016);
      expect(results[2].verseIdStart).toBe(45008028);
    });
  });

  // ==========================================================================
  // Get By Color Tests
  // ==========================================================================

  describe('getByColor', () => {
    it('should return markups filtered by color across all modules', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 2, verseIdStart: 45008028, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 1001001, color: 'blue' }));

      const results = await repo.getByColor('yellow');
      expect(results).toHaveLength(2);
      // stored as canonical hex; getColorName() maps back to the swatch.
      expect(results.every(r => r.getColorName() === 'yellow')).toBe(true);
      expect(results.every(r => r.color === HIGHLIGHT_COLOR_HEX.yellow.toUpperCase())).toBe(true);
    });

    it('should match legacy palette-name rows written before the hex migration', async () => {
      // User databases may hold literal colour names.
      // Insert one directly, bypassing the normalising write path.
      const sql = UserTestHelper.getProvider();
      sql.execute(
        `INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (?, ?, ?, ?)`,
        [1, 43003016, 43003016, 'yellow']
      );
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 45008028, color: 'yellow' }));

      const results = await repo.getByColor('yellow');

      // Both the legacy-name row and the hex row must come back.
      expect(results).toHaveLength(2);
      expect(results.every(r => r.getColorHex() === HIGHLIGHT_COLOR_HEX.yellow.toUpperCase())).toBe(true);
      expect(results.every(r => r.getColorName() === 'yellow')).toBe(true);
    });

    it('should match legacy palette-name rows when queried by the equivalent hex', async () => {
      // Callers that normalise at a trust boundary (e.g. the desktop IPC layer)
      // pass hex, so the legacy name must be derived from the resolved colour
      // rather than from the raw argument.
      const sql = UserTestHelper.getProvider();
      sql.execute(
        `INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (?, ?, ?, ?)`,
        [1, 43003016, 43003016, 'yellow']
      );
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 45008028, color: 'yellow' }));

      const results = await repo.getByColor(HIGHLIGHT_COLOR_HEX.yellow.toUpperCase());

      expect(results).toHaveLength(2);
      expect(results.every(r => r.getColorName() === 'yellow')).toBe(true);
    });

    it('should return nothing for a custom colour that matches no rows', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));

      // A custom hex has no palette name; the legacy-name branch must not
      // degenerate into matching arbitrary rows.
      expect(await repo.getByColor('#123456')).toEqual([]);
    });

    it('should filter by color and moduleId when provided', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 2, verseIdStart: 45008028, color: 'yellow' }));

      const results = await repo.getByColor('yellow', 1);
      expect(results).toHaveLength(1);
      expect(results[0].moduleId).toBe(1);
    });

    it('should return empty array for color with no markups', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));

      const results = await repo.getByColor('purple');
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Get By Note Tests
  // ==========================================================================

  describe('getByNote', () => {
    it('should return markups linked to a specific note', async () => {
      // Create real notes to satisfy FK constraints
      const provider = UserTestHelper.getProvider();
      provider.execute(`INSERT INTO user_note (content, note_type) VALUES ('note A', 'verse_note')`);
      const noteA = provider.queryOne<{ note_id: number }>('SELECT last_insert_rowid() as note_id')!.note_id;
      provider.execute(`INSERT INTO user_note (content, note_type) VALUES ('note B', 'verse_note')`);
      const noteB = provider.queryOne<{ note_id: number }>('SELECT last_insert_rowid() as note_id')!.note_id;

      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow', noteId: noteA }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003017, color: 'blue', noteId: noteA }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 45008028, color: 'red', noteId: noteB }));

      const results = await repo.getByNote(noteA);
      expect(results).toHaveLength(2);
      expect(results.every(r => r.noteId === noteA)).toBe(true);
    });

    it('should return empty array for note with no markups', async () => {
      const results = await repo.getByNote(99999);
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Delete For Verse Tests
  // ==========================================================================

  describe('deleteForVerse', () => {
    it('should delete markups for a specific verse and module', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'blue' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003017, color: 'red' }));

      await repo.deleteForVerse(43003016, 1);

      const remaining = await repo.getForModule(1);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].verseIdStart).toBe(43003017);
    });

    it('should not delete markups from other modules', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 2, verseIdStart: 43003016, color: 'blue' }));

      await repo.deleteForVerse(43003016, 1);

      const mod2 = await repo.getForModule(2);
      expect(mod2).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Delete For Verse Range Tests
  // ==========================================================================

  describe('deleteForVerseRange', () => {
    it('should delete markups within a verse range for a module', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003014, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'blue' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003020, color: 'red' }));

      await repo.deleteForVerseRange(43003015, 43003018, 1);

      const remaining = await repo.getForModule(1);
      // R-1: only markups that actually overlap 15..18 are deleted.
      //   43003014: end(14) >= 15? no => KEPT (v. 14 is outside the range)
      //   43003016: overlaps => deleted
      //   43003020: start(20) <= 18? no => kept
      //
      // Before R-1 the NULL end matched unconditionally and the markup on v. 14
      // was deleted too - silently destroying a user annotation outside the
      // range they asked to clear.
      expect(remaining).toHaveLength(2);
      expect(remaining.map(r => r.verseIdStart)).toEqual([43003014, 43003020]);
    });

    it('should not affect other modules', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 2, verseIdStart: 43003016, color: 'blue' }));

      await repo.deleteForVerseRange(43003015, 43003018, 1);

      const mod2 = await repo.getForModule(2);
      expect(mod2).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Count For Module Tests
  // ==========================================================================

  describe('countForModule', () => {
    it('should count markups for a module', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 45008028, color: 'blue' }));
      await repo.create(new UserTextMarkup({ moduleId: 2, verseIdStart: 43003016, color: 'red' }));

      const count = await repo.countForModule(1);
      expect(count).toBe(2);
    });

    it('should return 0 for module with no markups', async () => {
      const count = await repo.countForModule(999);
      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // Find Overlapping Tests
  // ==========================================================================

  describe('findOverlapping', () => {
    it('should find markups that overlap a single verse', async () => {
      // Single verse at 43003016
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      // Range covering 43003014-43003018
      await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003014,
        verseIdEnd: 43003018,
        color: 'green'
      }));
      // Single verse at 43003020 (no overlap)
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003020, color: 'red' }));

      const overlapping = await repo.findOverlapping(43003016, null, 1);
      expect(overlapping).toHaveLength(2);
    });

    it('should find markups that overlap a range', async () => {
      // Range 43003010-43003015 (ends before our range but overlaps)
      await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003010,
        verseIdEnd: 43003015,
        color: 'yellow'
      }));
      // Single verse at 43003016 (within range)
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'blue' }));
      // Range 43003018-43003025 (starts within our range)
      await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003018,
        verseIdEnd: 43003025,
        color: 'green'
      }));
      // Single verse at 43003030 (no overlap)
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003030, color: 'red' }));

      const overlapping = await repo.findOverlapping(43003014, 43003020, 1);
      // 43003010-43003015 overlaps (end 15 >= start 14)
      // 43003016 overlaps (start 16 <= end 20)
      // 43003018-43003025 overlaps (start 18 <= end 20)
      // 43003030 does not overlap (start 30 > end 20)
      expect(overlapping).toHaveLength(3);
    });

    it('should scope overlapping search by moduleId', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));
      await repo.create(new UserTextMarkup({ moduleId: 2, verseIdStart: 43003016, color: 'blue' }));

      const overlapping = await repo.findOverlapping(43003016, null, 1);
      expect(overlapping).toHaveLength(1);
      expect(overlapping[0].moduleId).toBe(1);
    });

    it('should return empty array when no overlaps exist', async () => {
      await repo.create(new UserTextMarkup({ moduleId: 1, verseIdStart: 43003016, color: 'yellow' }));

      const overlapping = await repo.findOverlapping(1001001, 1001010, 1);
      expect(overlapping).toEqual([]);
    });
  });

  // ==========================================================================
  // Partial Text (textStart/textEnd) Tests
  // ==========================================================================

  describe('partial text (textStart/textEnd)', () => {
    it('should store and retrieve partial text indices', async () => {
      const markup = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow',
        textStart: 3,
        textEnd: 10
      }));

      const fetched = await repo.getById(markup.markupId!);
      expect(fetched!.textStart).toBe(3);
      expect(fetched!.textEnd).toBe(10);
    });

    it('should handle null textStart/textEnd for whole verse highlights', async () => {
      const markup = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      }));

      const fetched = await repo.getById(markup.markupId!);
      expect(fetched!.textStart).toBeNull();
      expect(fetched!.textEnd).toBeNull();
    });
  });

  // ==========================================================================
  // Metadata Round-Trip Tests
  // ==========================================================================

  describe('metadata round-trip', () => {
    it('should round-trip underline metadata', async () => {
      const markup = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'blue',
        metadata: {
          markupType: 'both',
          underlineStyle: 'wavy',
          underlineColor: 'red'
        }
      }));

      const fetched = await repo.getById(markup.markupId!);
      expect(fetched!.metadata!.markupType).toBe('both');
      expect(fetched!.metadata!.underlineStyle).toBe('wavy');
      expect(fetched!.metadata!.underlineColor).toBe('red');
    });

    it('should handle null metadata', async () => {
      const markup = await repo.create(new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 43003016,
        color: 'yellow'
      }));

      const fetched = await repo.getById(markup.markupId!);
      expect(fetched!.metadata).toBeUndefined();
    });
  });
});
