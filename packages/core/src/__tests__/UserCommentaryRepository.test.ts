import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { UserCommentaryRepository } from '../Data/Repositories/UserCommentaryRepository';
import { UserCommentary } from '../Data/Models/User/UserCommentary';
import { UserNoteRepository } from '../Data/Repositories/UserNoteRepository';
import { UserNote } from '../Data/Models/User/UserNote';
import { UserTestHelper } from './helpers/UserTestHelper';

describe('UserCommentaryRepository', () => {
  let repo: UserCommentaryRepository;
  let noteRepo: UserNoteRepository;

  beforeAll(() => {
    UserTestHelper.initialize();
    const provider = UserTestHelper.getProvider();
    repo = new UserCommentaryRepository(provider);
    noteRepo = new UserNoteRepository(provider);
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
    it('should create a commentary and assign an ID', () => {
      const commentary = new UserCommentary({ name: 'My Notes' });

      const created = repo.create(commentary);

      expect(created.userCommentaryId).toBeDefined();
      expect(created.userCommentaryId).toBeGreaterThan(0);
      expect(created.name).toBe('My Notes');
    });

    it('should create a commentary with all fields', () => {
      const commentary = new UserCommentary({
        name: 'Study Notes',
        description: 'Notes from Bible study group',
        isDefault: false,
        color: '#FF5733',
        metadata: { type: 'personal', category: 'study' }
      });

      const created = repo.create(commentary);
      const fetched = repo.getById(created.userCommentaryId!);

      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('Study Notes');
      expect(fetched!.description).toBe('Notes from Bible study group');
      expect(fetched!.color).toBe('#FF5733');
      expect(fetched!.isDefault).toBe(false);
      expect(fetched!.metadata).toBeDefined();
      expect(fetched!.metadata!.type).toBe('personal');
    });

    it('should set createdDate and modifiedDate automatically', () => {
      const commentary = repo.create(new UserCommentary({ name: 'Dated' }));
      const fetched = repo.getById(commentary.userCommentaryId!);

      expect(fetched!.createdDate).toBeDefined();
      expect(fetched!.modifiedDate).toBeDefined();
    });

    it('should default isDefault to false', () => {
      const commentary = repo.create(new UserCommentary({ name: 'Plain' }));
      const fetched = repo.getById(commentary.userCommentaryId!);

      expect(fetched!.isDefault).toBe(false);
    });
  });

  // ==========================================================================
  // Get By ID Tests
  // ==========================================================================

  describe('getById', () => {
    it('should return a commentary by ID', () => {
      const created = repo.create(new UserCommentary({ name: 'Lookup' }));
      const fetched = repo.getById(created.userCommentaryId!);

      expect(fetched).toBeDefined();
      expect(fetched!.userCommentaryId).toBe(created.userCommentaryId);
    });

    it('should return undefined for non-existent ID', () => {
      const fetched = repo.getById(99999);
      expect(fetched).toBeUndefined();
    });
  });

  // ==========================================================================
  // Get All Tests
  // ==========================================================================

  describe('getAll', () => {
    it('should return all commentaries', () => {
      repo.create(new UserCommentary({ name: 'First' }));
      repo.create(new UserCommentary({ name: 'Second' }));

      const all = repo.getAll();
      expect(all).toHaveLength(2);
    });

    it('should return commentaries ordered by name ASC by default', () => {
      repo.create(new UserCommentary({ name: 'Zeta' }));
      repo.create(new UserCommentary({ name: 'Alpha' }));
      repo.create(new UserCommentary({ name: 'Mid' }));

      const all = repo.getAll();
      expect(all[0].name).toBe('Alpha');
      expect(all[1].name).toBe('Mid');
      expect(all[2].name).toBe('Zeta');
    });

    it('should support custom ordering', () => {
      repo.create(new UserCommentary({ name: 'A' }));
      repo.create(new UserCommentary({ name: 'B' }));

      const all = repo.getAll({ orderBy: 'name', orderDirection: 'DESC' });
      expect(all[0].name).toBe('B');
      expect(all[1].name).toBe('A');
    });

    it('should support limit and offset', () => {
      repo.create(new UserCommentary({ name: 'A' }));
      repo.create(new UserCommentary({ name: 'B' }));
      repo.create(new UserCommentary({ name: 'C' }));

      const limited = repo.getAll({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('should return empty array when no commentaries exist', () => {
      const all = repo.getAll();
      expect(all).toEqual([]);
    });
  });

  // ==========================================================================
  // Default Commentary Tests
  // ==========================================================================

  describe('getDefault', () => {
    it('should return the default commentary', () => {
      repo.create(new UserCommentary({ name: 'Regular' }));
      repo.create(new UserCommentary({ name: 'Default One', isDefault: true }));

      const def = repo.getDefault();
      expect(def).toBeDefined();
      expect(def!.name).toBe('Default One');
      expect(def!.isDefault).toBe(true);
    });

    it('should return undefined when no default exists', () => {
      repo.create(new UserCommentary({ name: 'Not Default' }));

      const def = repo.getDefault();
      expect(def).toBeUndefined();
    });
  });

  describe('setDefault', () => {
    it('should set a commentary as default and clear others', () => {
      const c1 = repo.create(new UserCommentary({ name: 'First', isDefault: true }));
      const c2 = repo.create(new UserCommentary({ name: 'Second' }));

      repo.setDefault(c2.userCommentaryId!);

      const fetched1 = repo.getById(c1.userCommentaryId!);
      const fetched2 = repo.getById(c2.userCommentaryId!);
      expect(fetched1!.isDefault).toBe(false);
      expect(fetched2!.isDefault).toBe(true);
    });

    it('should return true even when setting non-existent ID (transaction completes)', () => {
      repo.create(new UserCommentary({ name: 'Was Default', isDefault: true }));

      // setDefault always returns true (it runs the transaction regardless)
      const result = repo.setDefault(99999);
      expect(result).toBe(true);

      // But no commentary should be default now
      const def = repo.getDefault();
      expect(def).toBeUndefined();
    });

    it('should handle multiple setDefault calls', () => {
      const c1 = repo.create(new UserCommentary({ name: 'A' }));
      const c2 = repo.create(new UserCommentary({ name: 'B' }));
      const c3 = repo.create(new UserCommentary({ name: 'C' }));

      repo.setDefault(c1.userCommentaryId!);
      repo.setDefault(c2.userCommentaryId!);
      repo.setDefault(c3.userCommentaryId!);

      const def = repo.getDefault();
      expect(def!.name).toBe('C');

      // Ensure only one default
      const all = repo.getAll();
      const defaults = all.filter(c => c.isDefault);
      expect(defaults).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Get By Type (Metadata) Tests
  // ==========================================================================

  describe('getByType', () => {
    it('should find commentaries by type in metadata', () => {
      repo.create(new UserCommentary({
        name: 'Personal',
        metadata: { type: 'personal' }
      }));
      repo.create(new UserCommentary({
        name: 'Academic',
        metadata: { type: 'academic' }
      }));
      repo.create(new UserCommentary({
        name: 'Also Personal',
        metadata: { type: 'personal' }
      }));

      const personal = repo.getByType('personal');
      expect(personal).toHaveLength(2);
      expect(personal.every(c => (c.metadata as Record<string, string>).type === 'personal')).toBe(true);
    });

    it('should return empty array for non-matching type', () => {
      repo.create(new UserCommentary({
        name: 'Personal',
        metadata: { type: 'personal' }
      }));

      const results = repo.getByType('nonexistent');
      expect(results).toEqual([]);
    });

    it('should return empty array when no commentaries have metadata', () => {
      repo.create(new UserCommentary({ name: 'No Meta' }));

      const results = repo.getByType('personal');
      expect(results).toEqual([]);
    });
  });

  // ==========================================================================
  // Count Notes Tests
  // ==========================================================================

  describe('countNotes', () => {
    it('should count notes in a commentary', () => {
      const commentary = repo.create(new UserCommentary({ name: 'With Notes' }));

      noteRepo.create(new UserNote({
        content: 'Note 1',
        userCommentaryId: commentary.userCommentaryId
      }));
      noteRepo.create(new UserNote({
        content: 'Note 2',
        userCommentaryId: commentary.userCommentaryId
      }));
      noteRepo.create(new UserNote({
        content: 'Note 3',
        userCommentaryId: commentary.userCommentaryId
      }));

      const count = repo.countNotes(commentary.userCommentaryId!);
      expect(count).toBe(3);
    });

    it('should return 0 for commentary with no notes', () => {
      const commentary = repo.create(new UserCommentary({ name: 'Empty' }));

      const count = repo.countNotes(commentary.userCommentaryId!);
      expect(count).toBe(0);
    });

    it('should not count notes from other commentaries', () => {
      const c1 = repo.create(new UserCommentary({ name: 'C1' }));
      const c2 = repo.create(new UserCommentary({ name: 'C2' }));

      noteRepo.create(new UserNote({ content: 'C1 Note', userCommentaryId: c1.userCommentaryId }));
      noteRepo.create(new UserNote({ content: 'C2 Note 1', userCommentaryId: c2.userCommentaryId }));
      noteRepo.create(new UserNote({ content: 'C2 Note 2', userCommentaryId: c2.userCommentaryId }));

      expect(repo.countNotes(c1.userCommentaryId!)).toBe(1);
      expect(repo.countNotes(c2.userCommentaryId!)).toBe(2);
    });
  });

  // ==========================================================================
  // Update Tests
  // ==========================================================================

  describe('update', () => {
    it('should update commentary fields', () => {
      const commentary = repo.create(new UserCommentary({ name: 'Original' }));

      commentary.name = 'Updated';
      commentary.description = 'New description';
      commentary.color = '#00FF00';
      repo.update(commentary);

      const fetched = repo.getById(commentary.userCommentaryId!);
      expect(fetched!.name).toBe('Updated');
      expect(fetched!.description).toBe('New description');
      expect(fetched!.color).toBe('#00FF00');
    });

    it('should call touch() on update', () => {
      const commentary = repo.create(new UserCommentary({ name: 'Touchable' }));
      commentary.name = 'Touched';
      repo.update(commentary);

      expect(commentary.modifiedDate).toBeDefined();
    });

    it('should throw when updating without ID', () => {
      const commentary = new UserCommentary({ name: 'No ID' });

      expect(() => repo.update(commentary)).toThrow('Cannot update commentary without ID');
    });

    it('should update metadata', () => {
      const commentary = repo.create(new UserCommentary({
        name: 'Meta',
        metadata: { type: 'personal' }
      }));

      commentary.metadata = { type: 'academic', version: 2 };
      repo.update(commentary);

      const fetched = repo.getById(commentary.userCommentaryId!);
      expect(fetched!.metadata!.type).toBe('academic');
      expect(fetched!.metadata!.version).toBe(2);
    });
  });

  // ==========================================================================
  // Delete Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete an existing commentary', () => {
      const commentary = repo.create(new UserCommentary({ name: 'Doomed' }));

      const result = repo.delete(commentary.userCommentaryId!);
      expect(result).toBe(true);

      const fetched = repo.getById(commentary.userCommentaryId!);
      expect(fetched).toBeUndefined();
    });

    it('should return false when deleting non-existent commentary', () => {
      const result = repo.delete(99999);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Boolean Field Round-Trip Tests
  // ==========================================================================

  describe('boolean field round-trip', () => {
    it('should store isDefault as 0/1 and retrieve as boolean true', () => {
      const commentary = repo.create(new UserCommentary({ name: 'Default', isDefault: true }));
      const fetched = repo.getById(commentary.userCommentaryId!);

      expect(fetched!.isDefault).toBe(true);
      expect(typeof fetched!.isDefault).toBe('boolean');
    });

    it('should store isDefault as 0/1 and retrieve as boolean false', () => {
      const commentary = repo.create(new UserCommentary({ name: 'Not Default', isDefault: false }));
      const fetched = repo.getById(commentary.userCommentaryId!);

      expect(fetched!.isDefault).toBe(false);
      expect(typeof fetched!.isDefault).toBe('boolean');
    });
  });
});
