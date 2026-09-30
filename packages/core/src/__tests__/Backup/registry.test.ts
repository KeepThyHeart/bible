/**
 * Drift tests for the user-table registry against the schema core ships
 * (`UserDatabase.sql`). The matching test against the desktop's own DDL lives in
 * `apps/desktop/electron/services/__tests__/BackupRegistry.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserTestHelper } from '../helpers/UserTestHelper';
import type { ISql } from '../../Data/Core/ISql';
import {
  USER_TABLES, USER_SCHEMA_VERSION, EXCLUDED_TABLES, isClassified, isDerivedTable, orderedTables, parentTables,
  tableSpec, upgradeRow, readUserSchemaVersion, stampUserSchemaVersion,
} from '../../Backup/Registry';

let db: ISql;
beforeAll(() => { UserTestHelper.initialize(); db = UserTestHelper.getProvider(); });
afterAll(() => UserTestHelper.cleanup());

const tablesOf = () => (db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).map((r) => r.name);
const colsOf = (t: string) => db.queryAll<{ name: string }>(`PRAGMA table_info("${t}")`).map((r) => r.name);

describe('registry vs core UserDatabase.sql', () => {
  it('classifies every table core creates', () => {
    const unclassified = tablesOf().filter((t) => !isClassified(t));
    expect(unclassified, 'add these tables to USER_TABLES or EXCLUDED_TABLES').toEqual([]);
  });
  it('has every table core-origin tables claim, with exactly the same columns', () => {
    for (const spec of USER_TABLES.filter((s) => s.origin !== 'desktop')) {
      expect(tablesOf(), spec.name).toContain(spec.name);
      expect(colsOf(spec.name), spec.name).toEqual(spec.columns);
    }
  });
  it('does not claim a table core lacks as core-origin', () => {
    const present = new Set(tablesOf());
    for (const spec of USER_TABLES) {
      if (spec.origin === 'desktop') expect(present.has(spec.name), `${spec.name} is desktop-only`).toBe(false);
    }
  });
  it('lists primary keys that match the DDL for core tables', () => {
    for (const spec of USER_TABLES.filter((s) => s.origin !== 'desktop')) {
      const pk = db.queryAll<{ name: string; pk: number }>(`PRAGMA table_info("${spec.name}")`).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
      expect(pk, spec.name).toEqual(spec.pk);
    }
  });
});

describe('registry internal consistency', () => {
  it('has unique names, and every excluded table is really not a registered one', () => {
    const names = USER_TABLES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const e of EXCLUDED_TABLES) expect(names).not.toContain(e);
    expect(isDerivedTable('user_note_fts_data')).toBe(true);
  });
  it('every declared column set includes the primary key, the fks and the identity columns', () => {
    for (const s of USER_TABLES) {
      for (const k of s.pk) expect(s.columns, `${s.name}.${k}`).toContain(k);
      for (const fk of s.fks) {
        expect(s.columns, `${s.name}.${fk.column}`).toContain(fk.column);
        if ('typeColumn' in fk) expect(s.columns).toContain(fk.typeColumn);
      }
      if (s.identity.kind === 'unique') for (const c of s.identity.columns) expect(s.columns, `${s.name}.${c}`).toContain(c);
      if (s.identity.kind === 'content') for (const c of s.identity.exclude) expect(s.columns, `${s.name}.${c}`).toContain(c);
      if (s.identity.kind === 'unique' && s.identity.stamp) expect(s.columns).toContain(s.identity.stamp);
      if (s.defaultFlag) expect(s.columns).toContain(s.defaultFlag);
      for (const o of s.optionalColumns ?? []) expect(s.columns).toContain(o);
    }
  });
  it('every foreign key points at a registered table, and autoId tables have one integer key', () => {
    for (const s of USER_TABLES) {
      for (const p of parentTables(s)) expect(tableSpec(p), `${s.name} -> ${p}`).toBeDefined();
      if (s.autoId) expect(s.pk.length).toBe(1);
      expect(s.cls).not.toBe('excluded');
    }
  });
  it('unique-identity tables with an autoId key do not use the key as identity', () => {
    for (const s of USER_TABLES) {
      if (s.identity.kind === 'unique' && s.autoId) for (const k of s.pk) expect(s.identity.columns).not.toContain(k);
    }
  });
  it('orders parents before children, ignoring self references', () => {
    const order = orderedTables().map((t) => t.name);
    expect(order.length).toBe(USER_TABLES.length);
    for (const s of USER_TABLES) for (const p of parentTables(s)) {
      expect(order.indexOf(p), `${p} before ${s.name}`).toBeLessThan(order.indexOf(s.name));
    }
    expect(order.indexOf('user_note')).toBeLessThan(order.indexOf('verse_link'));
  });
  it('self-referencing tables are identified', () => {
    expect(tableSpec('user_note')!.fks.some((f) => 'table' in f && f.table === 'user_note')).toBe(true);
    expect(tableSpec('collection')!.fks.some((f) => 'table' in f && f.table === 'collection')).toBe(true);
  });
});

describe('row upgraders and the version stamp', () => {
  it('chains upgraders from the source version to the target', () => {
    const spec = { ...tableSpec('collection')!, upgraders: {
      0: (r: Record<string, unknown>) => ({ ...r, color: r.colour, colour: undefined }),
      1: (r: Record<string, unknown>) => ({ ...r, name: String(r.name).trim() }),
    } };
    expect(upgradeRow(spec, { colour: '#fff', name: ' a ' }, 0, 2)).toMatchObject({ color: '#fff', name: 'a' });
    expect(upgradeRow(spec, { name: ' a ' }, 1, 2)).toMatchObject({ name: 'a' });
    expect(upgradeRow(spec, { name: ' a ' }, 2, 2)).toMatchObject({ name: ' a ' });
  });
  it('the current version is 1 and stamping is monotonic', () => {
    expect(USER_SCHEMA_VERSION).toBe(1);
    expect(readUserSchemaVersion(db)).toBe(0);
    stampUserSchemaVersion(db);
    expect(readUserSchemaVersion(db)).toBe(1);
    db.execute('PRAGMA user_version = 7');
    stampUserSchemaVersion(db);
    expect(readUserSchemaVersion(db)).toBe(7);
    db.execute('PRAGMA user_version = 0');
  });
});
