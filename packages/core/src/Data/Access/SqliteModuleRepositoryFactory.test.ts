import { describe, it, expect } from 'vitest';
import { SqliteModuleRepositoryFactory } from './SqliteModuleRepositoryFactory';
import { nodeCodecRegistry } from './Codec';
import type { IModuleConnection } from './ModuleStore';
import type { ISql } from '../Core/ISql';
import { BibleRepository } from '../Repositories/BibleRepository';
import { CommentaryRepository } from '../Repositories/CommentaryRepository';
import type { RuntimeEnvironment } from './IKeywordIndexProvider';

function fakeSql(overrides: Partial<ISql> = {}): ISql {
  return {
    queryOne: () => undefined,
    queryAll: () => [],
    execute: () => ({ changes: 0 }),
    transaction: (cb) => cb(),
    close: () => {},
    isOpen: () => true,
    getDatabasePath: () => 'fake.db',
    ...overrides,
  };
}

function fakeConnection(sql: ISql | undefined): IModuleConnection {
  return {
    locator: { kind: 'file', path: 'modules/fake.db' },
    writable: false,
    sql,
    close: () => {},
  };
}

const ENV: RuntimeEnvironment = {
  runtime: 'node-server',
  sqlite: { fts5: true, writableModules: false },
  codecs: new Set(['none']),
  indexDir: null,
};

describe('SqliteModuleRepositoryFactory', () => {
  describe('supports', () => {
    it('claims a module type it knows how to build', () => {
      const factory = new SqliteModuleRepositoryFactory(nodeCodecRegistry());
      const conn = fakeConnection(fakeSql());
      expect(factory.supports(conn, 'bible')).toBe(true);
      expect(factory.supports(conn, 'commentary')).toBe(true);
      expect(factory.supports(conn, 'tagGraph')).toBe(true);
    });

    it('does not claim a module type it does not build - one type does not leak into another', () => {
      const factory = new SqliteModuleRepositoryFactory(nodeCodecRegistry());
      const conn = fakeConnection(fakeSql());
      // 'devotional' is not a key of ModuleRepositoryByType at all (no
      // dedicated repository exists yet) - cast to exercise supports()'s
      // runtime guard the way a caller iterating over ModuleType strings
      // would.
      expect(factory.supports(conn, 'devotional' as never)).toBe(false);
    });

    it('refuses a connection with no `sql` - a non-SQL-backed connection is never this factory\'s to build', () => {
      const factory = new SqliteModuleRepositoryFactory(nodeCodecRegistry());
      const conn = fakeConnection(undefined);
      expect(factory.supports(conn, 'bible')).toBe(false);
    });
  });

  describe('create', () => {
    it('builds the real repository class for the requested type', () => {
      const factory = new SqliteModuleRepositoryFactory(nodeCodecRegistry());
      const conn = fakeConnection(fakeSql());

      const repo = factory.create(conn, 'bible', nodeCodecRegistry());

      expect(repo).toBeInstanceOf(BibleRepository);
    });

    it('threads the caller-supplied codec registry through to a repository whose constructor accepts one', () => {
      const factory = new SqliteModuleRepositoryFactory(nodeCodecRegistry());
      const conn = fakeConnection(fakeSql());
      const codecs = nodeCodecRegistry();

      const repo = factory.create(conn, 'commentary', codecs) as CommentaryRepository;

      expect(repo).toBeInstanceOf(CommentaryRepository);
    });

    it('returns null for a connection with no `sql`', () => {
      const factory = new SqliteModuleRepositoryFactory(nodeCodecRegistry());
      const conn = fakeConnection(undefined);

      expect(factory.create(conn, 'bible', nodeCodecRegistry())).toBeNull();
    });
  });

  describe('capabilities', () => {
    it('reports read-open-failed when the connection has no `sql`', () => {
      const factory = new SqliteModuleRepositoryFactory(nodeCodecRegistry());
      const conn = fakeConnection(undefined);

      const caps = factory.capabilities(conn, ENV);

      expect(caps.readContent).toBe(false);
      expect(caps.unavailableReason).toBe('open-failed');
    });

    it('reports an uncompressed module as readable when `module_info.compression` is absent', () => {
      const factory = new SqliteModuleRepositoryFactory(nodeCodecRegistry());
      const conn = fakeConnection(fakeSql());

      const caps = factory.capabilities(conn, ENV);

      expect(caps.readContent).toBe(true);
      expect(caps.compression).toEqual({ codec: 'none', supported: true });
    });
  });
});
