// @vitest-environment node
/**
 * Drift tests: the core table registry against the DDL this app really creates
 * (`initializeUserSchema` -> core `createUserSchema`, `initializeExtensionSchema`, `ensureContentVerseLinkTable`).
 * A table added to the desktop schema without being classified in the registry
 * fails here, which removes the "forgot to add it to the backup list" path.
 * The matching test against core's own `UserDatabase.sql` is in
 * `packages/core/src/__tests__/Backup/registry.test.ts`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { Backup } from '@bible/core';
import type { ISql } from '@bible/core';
import { makeSql } from './helpers/testSql';
import { initializeUserSchema } from '../../schema/userSchema';
import { initializeExtensionSchema } from '../../extensions/extensionSchema';
import { ensureContentVerseLinkTable } from '../../utils/verseIndexing';

let db: Database.Database;
let sql: ISql;
beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  sql = makeSql(db);
  initializeUserSchema(sql);
  initializeExtensionSchema(sql);
  ensureContentVerseLinkTable(sql);
});

const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => (r as { name: string }).name);
const cols = (t: string) => db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => (c as { name: string }).name);

describe('desktop schema vs the backup table registry', () => {
  it('classifies every table the desktop creates', () => {
    expect(tables().filter((t) => !Backup.isClassified(t))).toEqual([]);
  });
  it('creates every registered table (core builds the whole schema now), with exactly the registry columns', () => {
    for (const spec of Backup.USER_TABLES) {
      expect(tables(), spec.name).toContain(spec.name);
      // A fresh database has the optional columns too (`user_note.sort_order`); only older files lack them.
      expect(cols(spec.name), spec.name).toEqual(spec.columns);
    }
  });
  it('creates no sync_metadata table, and no tracker table before the tracker is installed', () => {
    expect(tables()).not.toContain('sync_metadata');
    expect(tables().filter((t) => t.startsWith('sync_'))).toEqual([]);
  });
  it('stamps the schema version, and never lowers a higher one', () => {
    expect(Backup.readUserSchemaVersion(sql)).toBe(Backup.USER_SCHEMA_VERSION);
    db.pragma('user_version = 9');
    initializeUserSchema(sql);
    expect(Backup.readUserSchemaVersion(sql)).toBe(9);
    db.pragma(`user_version = ${Backup.USER_SCHEMA_VERSION}`);
  });
});
