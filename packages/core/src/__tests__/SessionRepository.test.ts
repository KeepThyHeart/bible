import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SessionRepository } from '../Data/Repositories/SessionRepository';
import { Session } from '../Data/Models/User/Session';
import { UserTestHelper } from './helpers/UserTestHelper';

describe('SessionRepository', () => {
  let repo: SessionRepository;

  beforeAll(() => {
    UserTestHelper.initialize();
    repo = new SessionRepository(UserTestHelper.getProvider());
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
    it('should create a session and assign an ID', () => {
      const session = new Session({
        name: 'Morning Study',
        sessionData: {}
      });

      const created = repo.create(session);

      expect(created.sessionId).toBeDefined();
      expect(created.sessionId).toBeGreaterThan(0);
      expect(created.name).toBe('Morning Study');
    });

    it('should create a session with full session data JSON', () => {
      const sessionData = {
        bible: {
          openTabs: [{ tabId: '1', abbreviation: 'KJV', name: 'King James Version' }],
          activeTabIndex: 0,
          currentBook: 43,
          currentChapter: 3
        },
        layout: {
          activeLayout: 'study',
          paneVisibility: { commentary: true, dictionary: false }
        }
      };

      const session = new Session({
        name: 'Study Session',
        sessionData,
        description: 'My study session'
      });

      const created = repo.create(session);
      const fetched = repo.getById(created.sessionId!);

      expect(fetched).toBeDefined();
      expect(fetched!.sessionData.bible?.openTabs).toHaveLength(1);
      expect(fetched!.sessionData.bible?.currentBook).toBe(43);
      expect(fetched!.sessionData.layout?.activeLayout).toBe('study');
    });

    it('should create a session with isDefault=true and clear other defaults', () => {
      const s1 = repo.create(new Session({ name: 'First', sessionData: {}, isDefault: true }));
      const s2 = repo.create(new Session({ name: 'Second', sessionData: {}, isDefault: true }));

      const fetched1 = repo.getById(s1.sessionId!);
      const fetched2 = repo.getById(s2.sessionId!);

      expect(fetched1!.isDefault).toBe(false);
      expect(fetched2!.isDefault).toBe(true);
    });

    it('should create an autosave session', () => {
      const session = new Session({
        name: 'Autosave',
        sessionData: {},
        isAutosave: true
      });

      const created = repo.create(session);
      const fetched = repo.getById(created.sessionId!);

      expect(fetched!.isAutosave).toBe(true);
    });

    it('should default boolean fields to false', () => {
      const session = repo.create(new Session({ name: 'Plain', sessionData: {} }));
      const fetched = repo.getById(session.sessionId!);

      expect(fetched!.isAutosave).toBe(false);
      expect(fetched!.isDefault).toBe(false);
    });

    it('should store and retrieve metadata', () => {
      const session = repo.create(new Session({
        name: 'With Metadata',
        sessionData: {},
        metadata: { source: 'import', version: 2 }
      }));

      const fetched = repo.getById(session.sessionId!);
      expect(fetched!.metadata).toBeDefined();
      expect(fetched!.metadata!.source).toBe('import');
      expect(fetched!.metadata!.version).toBe(2);
    });

    it('should set createdDate and modifiedDate automatically', () => {
      const session = repo.create(new Session({ name: 'Dated', sessionData: {} }));
      const fetched = repo.getById(session.sessionId!);

      expect(fetched!.createdDate).toBeDefined();
      expect(fetched!.modifiedDate).toBeDefined();
    });
  });

  // ==========================================================================
  // Get By ID Tests
  // ==========================================================================

  describe('getById', () => {
    it('should return a session by ID', () => {
      const created = repo.create(new Session({ name: 'Test', sessionData: {} }));
      const fetched = repo.getById(created.sessionId!);

      expect(fetched).toBeDefined();
      expect(fetched!.sessionId).toBe(created.sessionId);
      expect(fetched!.name).toBe('Test');
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
    it('should return all sessions', () => {
      repo.create(new Session({ name: 'A', sessionData: {} }));
      repo.create(new Session({ name: 'B', sessionData: {} }));
      repo.create(new Session({ name: 'C', sessionData: {} }));

      const all = repo.getAll();
      expect(all).toHaveLength(3);
    });

    it('should return sessions ordered by last_opened DESC by default', () => {
      const provider = UserTestHelper.getProvider();
      const s1 = repo.create(new Session({ name: 'Old', sessionData: {} }));
      // Set explicit timestamps to avoid same-millisecond ties
      provider.execute('UPDATE session SET last_opened = ? WHERE session_id = ?', ['2024-01-01T00:00:00.000Z', s1.sessionId!]);

      const s2 = repo.create(new Session({ name: 'New', sessionData: {} }));
      provider.execute('UPDATE session SET last_opened = ? WHERE session_id = ?', ['2024-06-01T00:00:00.000Z', s2.sessionId!]);

      const all = repo.getAll();
      // s2 was opened more recently
      expect(all[0].name).toBe('New');
    });

    it('should support custom ordering by name', () => {
      repo.create(new Session({ name: 'Zeta', sessionData: {} }));
      repo.create(new Session({ name: 'Alpha', sessionData: {} }));

      const all = repo.getAll({ orderBy: 'name', orderDirection: 'ASC' });
      expect(all[0].name).toBe('Alpha');
      expect(all[1].name).toBe('Zeta');
    });

    it('should support limit and offset', () => {
      repo.create(new Session({ name: 'A', sessionData: {} }));
      repo.create(new Session({ name: 'B', sessionData: {} }));
      repo.create(new Session({ name: 'C', sessionData: {} }));

      const limited = repo.getAll({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('should return empty array when no sessions exist', () => {
      const all = repo.getAll();
      expect(all).toEqual([]);
    });
  });

  // ==========================================================================
  // Get By Name Tests
  // ==========================================================================

  describe('getByName', () => {
    it('should find a session by exact name', () => {
      repo.create(new Session({ name: 'Unique Name', sessionData: {} }));

      const found = repo.getByName('Unique Name');
      expect(found).toBeDefined();
      expect(found!.name).toBe('Unique Name');
    });

    it('should return undefined for non-existent name', () => {
      const found = repo.getByName('Does Not Exist');
      expect(found).toBeUndefined();
    });
  });

  // ==========================================================================
  // Default Session Tests
  // ==========================================================================

  describe('getDefaultSession', () => {
    it('should return the default session', () => {
      repo.create(new Session({ name: 'Regular', sessionData: {} }));
      repo.create(new Session({ name: 'Default', sessionData: {}, isDefault: true }));

      const def = repo.getDefaultSession();
      expect(def).toBeDefined();
      expect(def!.name).toBe('Default');
      expect(def!.isDefault).toBe(true);
    });

    it('should return undefined when no default exists', () => {
      repo.create(new Session({ name: 'Not Default', sessionData: {} }));

      const def = repo.getDefaultSession();
      expect(def).toBeUndefined();
    });
  });

  // ==========================================================================
  // Autosave Session Tests
  // ==========================================================================

  describe('getAutosaveSession', () => {
    it('should return the autosave session', () => {
      repo.create(new Session({ name: 'Normal', sessionData: {} }));
      repo.create(new Session({ name: 'Autosave', sessionData: {}, isAutosave: true }));

      const autosave = repo.getAutosaveSession();
      expect(autosave).toBeDefined();
      expect(autosave!.name).toBe('Autosave');
      expect(autosave!.isAutosave).toBe(true);
    });

    it('should return undefined when no autosave session exists', () => {
      repo.create(new Session({ name: 'Normal', sessionData: {} }));

      const autosave = repo.getAutosaveSession();
      expect(autosave).toBeUndefined();
    });
  });

  // ==========================================================================
  // Recent Sessions Tests
  // ==========================================================================

  describe('getRecentSessions', () => {
    it('should return recent sessions ordered by last_opened', () => {
      const provider = UserTestHelper.getProvider();
      const s1 = repo.create(new Session({ name: 'First', sessionData: {} }));
      provider.execute('UPDATE session SET last_opened = ? WHERE session_id = ?', ['2024-01-01T00:00:00.000Z', s1.sessionId!]);

      const s2 = repo.create(new Session({ name: 'Second', sessionData: {} }));
      provider.execute('UPDATE session SET last_opened = ? WHERE session_id = ?', ['2024-03-01T00:00:00.000Z', s2.sessionId!]);

      const s3 = repo.create(new Session({ name: 'Third', sessionData: {} }));
      provider.execute('UPDATE session SET last_opened = ? WHERE session_id = ?', ['2024-06-01T00:00:00.000Z', s3.sessionId!]);

      const recent = repo.getRecentSessions(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].name).toBe('Third');
      expect(recent[1].name).toBe('Second');
    });

    it('should default to limit of 10', () => {
      for (let i = 0; i < 15; i++) {
        const s = repo.create(new Session({ name: `Session ${i}`, sessionData: {} }));
        repo.markSessionOpened(s.sessionId!);
      }

      const recent = repo.getRecentSessions();
      expect(recent).toHaveLength(10);
    });

    it('should return empty array when no sessions exist', () => {
      const recent = repo.getRecentSessions();
      expect(recent).toEqual([]);
    });
  });

  // ==========================================================================
  // Update Tests
  // ==========================================================================

  describe('update', () => {
    it('should update session fields', () => {
      const session = repo.create(new Session({ name: 'Original', sessionData: {} }));

      session.name = 'Updated';
      session.description = 'Updated description';
      repo.update(session);

      const fetched = repo.getById(session.sessionId!);
      expect(fetched!.name).toBe('Updated');
      expect(fetched!.description).toBe('Updated description');
    });

    it('should update session data JSON', () => {
      const session = repo.create(new Session({
        name: 'Session',
        sessionData: { bible: { currentBook: 1 } }
      }));

      session.sessionData = { bible: { currentBook: 43, currentChapter: 3 } };
      repo.update(session);

      const fetched = repo.getById(session.sessionId!);
      expect(fetched!.sessionData.bible?.currentBook).toBe(43);
      expect(fetched!.sessionData.bible?.currentChapter).toBe(3);
    });

    it('should call touch() and update modifiedDate', () => {
      const session = repo.create(new Session({ name: 'Touchable', sessionData: {} }));

      // `create()` stamps `modified_date` in the row but leaves the instance it
      // was handed alone; only `update()` calls `entity.touch()`. The old test
      // captured `originalModified` here and never compared against it, which
      // hid that asymmetry.
      expect(session.modifiedDate).toBeUndefined();
      expect(repo.getById(session.sessionId!)!.modifiedDate).toBeDefined();

      session.name = 'Touched';
      repo.update(session);

      expect(session.modifiedDate).toBeDefined();
      // And the stamp reached the row, not just the object.
      expect(repo.getById(session.sessionId!)!.modifiedDate).toBe(session.modifiedDate);
    });

    it('should throw when updating without ID', () => {
      const session = new Session({ name: 'No ID', sessionData: {} });

      expect(() => repo.update(session)).toThrow('Cannot update session without ID');
    });

    it('should clear other defaults when updating with isDefault=true', () => {
      const s1 = repo.create(new Session({ name: 'First', sessionData: {}, isDefault: true }));
      const s2 = repo.create(new Session({ name: 'Second', sessionData: {} }));

      s2.isDefault = true;
      repo.update(s2);

      const fetched1 = repo.getById(s1.sessionId!);
      const fetched2 = repo.getById(s2.sessionId!);
      expect(fetched1!.isDefault).toBe(false);
      expect(fetched2!.isDefault).toBe(true);
    });
  });

  // ==========================================================================
  // Delete Tests
  // ==========================================================================

  describe('delete', () => {
    it('should delete an existing session', () => {
      const session = repo.create(new Session({ name: 'Doomed', sessionData: {} }));

      const result = repo.delete(session.sessionId!);
      expect(result).toBe(true);

      const fetched = repo.getById(session.sessionId!);
      expect(fetched).toBeUndefined();
    });

    it('should return false when deleting non-existent session', () => {
      const result = repo.delete(99999);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // Set As Default Tests
  // ==========================================================================

  describe('setAsDefault', () => {
    it('should set a session as default and clear others', () => {
      const s1 = repo.create(new Session({ name: 'First', sessionData: {}, isDefault: true }));
      const s2 = repo.create(new Session({ name: 'Second', sessionData: {} }));

      const result = repo.setAsDefault(s2.sessionId!);
      expect(result).toBe(true);

      const fetched1 = repo.getById(s1.sessionId!);
      const fetched2 = repo.getById(s2.sessionId!);
      expect(fetched1!.isDefault).toBe(false);
      expect(fetched2!.isDefault).toBe(true);
    });

    it('should clear all defaults when setting non-existent session', () => {
      repo.create(new Session({ name: 'Was Default', sessionData: {}, isDefault: true }));

      const result = repo.setAsDefault(99999);
      expect(result).toBe(false);

      const def = repo.getDefaultSession();
      expect(def).toBeUndefined();
    });

    it('should handle setting the same session as default again', () => {
      const session = repo.create(new Session({ name: 'Already Default', sessionData: {}, isDefault: true }));

      const result = repo.setAsDefault(session.sessionId!);
      expect(result).toBe(true);

      const fetched = repo.getById(session.sessionId!);
      expect(fetched!.isDefault).toBe(true);
    });
  });

  // ==========================================================================
  // Mark Session Opened Tests
  // ==========================================================================

  describe('markSessionOpened', () => {
    it('should update last_opened timestamp', () => {
      const session = repo.create(new Session({ name: 'Openable', sessionData: {} }));

      expect(session.lastOpened).toBeUndefined();

      repo.markSessionOpened(session.sessionId!);

      const fetched = repo.getById(session.sessionId!);
      expect(fetched!.lastOpened).toBeDefined();
      expect(typeof fetched!.lastOpened).toBe('string');
    });

    it('should update last_opened to a more recent time on second open', () => {
      const session = repo.create(new Session({ name: 'Multi Open', sessionData: {} }));

      repo.markSessionOpened(session.sessionId!);
      const first = repo.getById(session.sessionId!)!.lastOpened!;

      repo.markSessionOpened(session.sessionId!);
      const second = repo.getById(session.sessionId!)!.lastOpened!;

      // Second open should be >= first
      expect(second >= first).toBe(true);
    });
  });

  // ==========================================================================
  // Session Data JSON Round-Trip Tests
  // ==========================================================================

  describe('session data JSON round-trip', () => {
    it('should round-trip empty session data', () => {
      const session = repo.create(new Session({ name: 'Empty Data', sessionData: {} }));
      const fetched = repo.getById(session.sessionId!);

      expect(fetched!.sessionData).toEqual({});
    });

    it('should round-trip complex nested session data', () => {
      const complexData = {
        bible: {
          openTabs: [
            { tabId: 'tab1', abbreviation: 'KJV', name: 'King James', displayMode: 'study', moduleId: 1 },
            { tabId: 'tab2', abbreviation: 'ESV', name: 'English Standard', moduleId: 2 }
          ],
          activeTabIndex: 1,
          currentBook: 19,
          currentChapter: 23,
          selectedVerseId: 19023001
        },
        commentary: {
          openTabs: [{ abbreviation: 'MHC', name: "Matthew Henry's Commentary" }],
          activeTabIndex: 0,
          currentVerseId: 19023001,
          browseModeByTab: { 'MHC': true }
        },
        ui: {
          theme: 'dark',
          fontSize: 18
        }
      };

      const session = repo.create(new Session({ name: 'Complex', sessionData: complexData }));
      const fetched = repo.getById(session.sessionId!);

      expect(fetched!.sessionData.bible?.openTabs).toHaveLength(2);
      expect(fetched!.sessionData.bible?.selectedVerseId).toBe(19023001);
      expect(fetched!.sessionData.commentary?.browseModeByTab?.['MHC']).toBe(true);
      expect(fetched!.sessionData.ui?.theme).toBe('dark');
    });

    it('should round-trip dockview state', () => {
      const session = repo.create(new Session({
        name: 'Dockview',
        sessionData: {
          dockviewState: {
            grid: { root: { type: 'branch', data: [] } },
            panels: { 'bible-panel': { id: 'bible-panel' } }
          }
        }
      }));

      const fetched = repo.getById(session.sessionId!);
      expect(fetched!.sessionData.dockviewState).toBeDefined();
      expect(fetched!.sessionData.dockviewState!.panels).toHaveProperty('bible-panel');
    });
  });

  // ==========================================================================
  // Boolean Field Handling Tests
  // ==========================================================================

  describe('boolean field handling (0/1 round-trip)', () => {
    it('should store isAutosave as 0/1 and retrieve as boolean', () => {
      const s1 = repo.create(new Session({ name: 'Auto', sessionData: {}, isAutosave: true }));
      const s2 = repo.create(new Session({ name: 'Manual', sessionData: {}, isAutosave: false }));

      const f1 = repo.getById(s1.sessionId!);
      const f2 = repo.getById(s2.sessionId!);

      expect(f1!.isAutosave).toBe(true);
      expect(typeof f1!.isAutosave).toBe('boolean');
      expect(f2!.isAutosave).toBe(false);
      expect(typeof f2!.isAutosave).toBe('boolean');
    });

    it('should store isDefault as 0/1 and retrieve as boolean', () => {
      const session = repo.create(new Session({ name: 'Default', sessionData: {}, isDefault: true }));
      const fetched = repo.getById(session.sessionId!);

      expect(fetched!.isDefault).toBe(true);
      expect(typeof fetched!.isDefault).toBe('boolean');
    });
  });
});
