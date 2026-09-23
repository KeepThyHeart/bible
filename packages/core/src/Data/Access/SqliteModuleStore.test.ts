import { describe, it, expect, vi } from 'vitest';
import { SqliteModuleStore, type SqlDriverFactory } from './SqliteModuleStore';
import type { ISql } from '../Core/ISql';
import type { ModuleLocator } from './ModuleStore';

function fakeSql(): ISql {
  return {
    queryOne: () => undefined,
    queryAll: () => [],
    execute: () => ({ changes: 0 }),
    transaction: (cb) => cb(),
    close: vi.fn(),
    isOpen: () => true,
    getDatabasePath: () => 'fake.db',
  };
}

describe('SqliteModuleStore', () => {
  describe('canOpen', () => {
    it('accepts a file locator whose extension is in `extensions`', () => {
      const store = new SqliteModuleStore({ create: () => fakeSql() });
      expect(store.canOpen({ kind: 'file', path: 'modules/bible_kjv.db' })).toBe(true);
      expect(store.canOpen({ kind: 'file', path: 'modules/bible_kjv.DB' })).toBe(true);
    });

    it('rejects a file locator with an unrecognised extension', () => {
      const store = new SqliteModuleStore({ create: () => fakeSql() });
      expect(store.canOpen({ kind: 'file', path: 'modules/bible_kjv.csv' })).toBe(false);
    });

    it('rejects a non-file locator - this store only ever opens files', () => {
      const store = new SqliteModuleStore({ create: () => fakeSql() });
      expect(store.canOpen({ kind: 'opfs', name: 'bible_kjv.db' })).toBe(false);
      expect(store.canOpen({ kind: 'remote', url: 'https://example.com/bible_kjv.db' })).toBe(false);
    });

    it('drives its accept set off `extensions`, not a hard-coded literal', () => {
      const store = new SqliteModuleStore({ create: () => fakeSql() });
      // Mutating the instance's own declared extensions changes what canOpen
      // accepts - proof canOpen reads the property rather than a private
      // hard-coded string, matching the discovery-facing contract in
      // moduleDetector.ts.
      (store as unknown as { extensions: string[] }).extensions = ['.mod'];
      expect(store.canOpen({ kind: 'file', path: 'modules/bible_kjv.db' })).toBe(false);
      expect(store.canOpen({ kind: 'file', path: 'modules/bible_kjv.mod' })).toBe(true);
    });
  });

  describe('open', () => {
    it('threads `readonly: true` through to the driver and reports the connection as not writable', () => {
      const driver: SqlDriverFactory = { create: vi.fn(() => fakeSql()) };
      const store = new SqliteModuleStore(driver);
      const loc: ModuleLocator = { kind: 'file', path: 'modules/bible_kjv.db' };

      const conn = store.open(loc, { readonly: true });

      expect(driver.create).toHaveBeenCalledWith('modules/bible_kjv.db', { readonly: true });
      expect(conn.writable).toBe(false);
      expect(conn.locator).toEqual(loc);
    });

    it('threads `readonly: false` through to the driver and reports the connection as writable', () => {
      const driver: SqlDriverFactory = { create: vi.fn(() => fakeSql()) };
      const store = new SqliteModuleStore(driver);

      const conn = store.open({ kind: 'file', path: 'modules/bible_kjv.db' }, { readonly: false });

      expect(driver.create).toHaveBeenCalledWith('modules/bible_kjv.db', { readonly: false });
      expect(conn.writable).toBe(true);
    });

    it('closes the underlying ISql when the connection is closed', () => {
      const sql = fakeSql();
      const store = new SqliteModuleStore({ create: () => sql });

      const conn = store.open({ kind: 'file', path: 'modules/bible_kjv.db' }, { readonly: true });
      conn.close();

      expect(sql.close).toHaveBeenCalledTimes(1);
    });

    it('throws for a locator it cannot open, rather than silently doing nothing', () => {
      const store = new SqliteModuleStore({ create: () => fakeSql() });
      expect(() => store.open({ kind: 'opfs', name: 'bible_kjv.db' }, { readonly: true })).toThrow();
    });

    it('exposes the connection\'s `sql` for a SQL-backed store', () => {
      const sql = fakeSql();
      const store = new SqliteModuleStore({ create: () => sql });
      const conn = store.open({ kind: 'file', path: 'modules/bible_kjv.db' }, { readonly: true });
      expect(conn.sql).toBe(sql);
    });
  });
});
