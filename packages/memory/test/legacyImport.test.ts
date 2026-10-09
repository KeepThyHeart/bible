/**
 * The one-time import of the extension's database (task 0114). Users' data
 * must survive the move, so every schema version the extension shipped is
 * built from its real migrations and imported here.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  importLegacyMemory,
  legacyImportRecord,
  LEGACY_SOURCE_KEY,
  LEGACY_TABLES,
  type LegacyImportResult,
} from '../src/core/legacyImport';
import { installMemorySchema, MEMORY_TABLES } from '../src/core/schema';
import { createSqlPort } from '../src/core/sqlPort';
import { MemoryStore } from '../src/core/store';
import { TestSql } from './helpers/sqlite';
import { createLegacyDb } from './helpers/legacyDb';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'memory-import-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function target(): TestSql {
  const t = new TestSql();
  installMemorySchema(t);
  return t;
}

/** Opens the file the way the desktop does: read-only, must exist. */
function opener(path: string): () => TestSql | null {
  return () => (existsSync(path) ? new TestSql(new Database(path, { readonly: true, fileMustExist: true })) : null);
}

function run(t: TestSql, path: string): LegacyImportResult {
  return importLegacyMemory(t, { openSource: opener(path), now: NOW });
}

function count(t: TestSql, table: string): number {
  return t.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;
}

function fileHash(path: string): string {
  const h = createHash('sha256');
  for (const p of [path, `${path}-wal`]) if (existsSync(p)) h.update(readFileSync(p));
  return h.digest('hex');
}

/**
 * A realistic plan at schema `version`: two lists, three passages (one
 * soft-deleted from v5), cards, attempts, and whatever later versions added.
 */
function populate(db: Db, version: number): void {
  const ins = (sql: string, ...p: unknown[]) => db.prepare(sql).run(...p);
  ins('INSERT INTO collection (id, name, created_at) VALUES (?, ?, ?)', 1, 'My plan', 1000);
  ins('INSERT INTO collection (id, name, created_at) VALUES (?, ?, ?)', 2, 'Psalms', 2000);
  const passage = (id: number, coll: number, start: number, end: number, ref: string) =>
    ins(
      'INSERT INTO passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, coll, 'KJV', start, end, ref, end - start + 1, 3000 + id,
    );
  passage(10, 1, 43003016, 43003017, 'John 3:16-17');
  passage(11, 2, 19023001, 19023006, 'Psalms 23:1-6');
  passage(12, 1, 45008028, 45008028, 'Romans 8:28');
  ins("INSERT INTO card (id, passage_id, rung, state, interval_step, due_at, streak, last_score) VALUES (100, 10, 'ordering', 'learning', 2, 5000, 1, 0.9)");
  ins("INSERT INTO card (id, passage_id, rung, state) VALUES (101, 10, 'blanks', 'new')");
  ins("INSERT INTO card (id, passage_id, rung, state) VALUES (102, 11, 'ordering', 'new')");
  ins("INSERT INTO card (id, passage_id, rung, state) VALUES (103, 12, 'firstletters', 'new')");
  ins('INSERT INTO attempt (id, card_id, at, score, correct_first, total_steps) VALUES (1000, 100, 4000, 0.9, 1, 1)');
  ins('INSERT INTO attempt (id, card_id, at, score, correct_first, total_steps, replay) VALUES (1001, 100, 4100, 0.5, 0, 1, 1)');
  ins('INSERT INTO attempt (id, card_id, at, score, correct_first, total_steps) VALUES (1002, 102, 4200, 1, 5, 5)');
  if (version >= 2) {
    ins('UPDATE passage SET answer_mode = ? WHERE id = 11', 'fullWord');
    ins('UPDATE attempt SET duration_ms = 12345 WHERE id = 1000');
    ins("INSERT INTO setting (key, value) VALUES ('defaultAnswerMode', 'fullWord')");
    ins(`INSERT INTO setting (key, value) VALUES ('practiceScope', '{"kind":"list","id":2}')`);
    ins('INSERT INTO resume_state (card_id, cursor, correct_first, graded_units, updated_at) VALUES (101, 1, 1, 1, 4300)');
  }
  if (version >= 3) {
    ins('UPDATE attempt SET tier = 1 WHERE id = 1002');
    ins('UPDATE card SET progress_reset_at = 4050 WHERE id = 100');
  }
  if (version >= 4) ins('UPDATE resume_state SET tier = 1 WHERE card_id = 101');
  if (version >= 5) ins('UPDATE passage SET deleted_at = 4400 WHERE id = 12');
  if (version >= 6) {
    ins('UPDATE passage SET recite_on = 1 WHERE id = 10');
    ins("INSERT INTO card (id, passage_id, rung, state) VALUES (104, 10, 'recite', 'new')");
    ins('INSERT INTO attempt (id, card_id, at, score, correct_first, total_steps, tier) VALUES (1003, 104, 4500, 0.8, 1, 1, 0)');
    ins(
      "INSERT INTO recite_detail (attempt_id, card_id, at, verdicts, credits, verse_scores, extras, strictness, engine_id) VALUES (1003, 104, 4500, 'ccv', '[1,1,0.5]', '[0.8]', 0, 'normal', 'whisper')",
    );
  }
  if (version >= 7) {
    ins("INSERT INTO card (id, passage_id, rung, state, due_at) VALUES (105, 11, 'recall', 'new', 9000)");
    ins("INSERT INTO push_card (key, passage_id, fire_at, origin, state, updated_at) VALUES ('11@8000', 11, 8000, 'plan', 'scheduled', 4600)");
    ins(`INSERT INTO setting (key, value) VALUES ('pushCards', '{"enabled":true}')`);
  }
}

function legacyFile(version: number, fill = true): string {
  const path = join(dir, `memory-v${version}.db`);
  const db = createLegacyDb(path, version);
  if (fill) populate(db, version);
  db.close();
  return path;
}

describe('legacy import: every extension schema version', () => {
  for (const version of [1, 2, 3, 4, 5, 6, 7]) {
    it(`imports a populated v${version} database completely, keeping ids`, async () => {
      const path = legacyFile(version);
      const before = fileHash(path);
      const t = target();

      const result = run(t, path);
      expect(result.status).toBe('imported');
      if (result.status !== 'imported') return;
      expect(result.sourceVersion).toBe(version);
      expect(result.dropped).toEqual({});

      // Every row arrived, with its id.
      expect(t.queryAll('SELECT id, name, created_at FROM memory_collection ORDER BY id')).toEqual([
        { id: 1, name: 'My plan', created_at: 1000 },
        { id: 2, name: 'Psalms', created_at: 2000 },
      ]);
      expect(t.queryAll<{ id: number }>('SELECT id FROM memory_passage ORDER BY id').map((r) => r.id)).toEqual([10, 11, 12]);
      expect(count(t, 'memory_card')).toBe(version >= 7 ? 6 : version >= 6 ? 5 : 4);
      expect(count(t, 'memory_attempt')).toBe(version >= 6 ? 4 : 3);
      expect(result.counts.memory_attempt).toBe(count(t, 'memory_attempt'));

      // Columns the version lacked get the defaults its migrations gave old rows.
      const p11 = t.queryOne<{ answer_mode: string | null; deleted_at: number | null; recite_on: number }>(
        'SELECT answer_mode, deleted_at, recite_on FROM memory_passage WHERE id = 11',
      );
      expect(p11).toEqual({ answer_mode: version >= 2 ? 'fullWord' : null, deleted_at: null, recite_on: 0 });
      const a1000 = t.queryOne<{ duration_ms: number | null; tier: number; replay: number }>(
        'SELECT duration_ms, tier, replay FROM memory_attempt WHERE id = 1000',
      );
      expect(a1000).toEqual({ duration_ms: version >= 2 ? 12345 : null, tier: 0, replay: 0 });
      expect(t.queryOne<{ tier: number }>('SELECT tier FROM memory_attempt WHERE id = 1002')?.tier).toBe(version >= 3 ? 1 : 0);
      expect(t.queryOne<{ r: number | null }>('SELECT progress_reset_at AS r FROM memory_card WHERE id = 100')?.r).toBe(
        version >= 3 ? 4050 : null,
      );
      expect(t.queryOne<{ d: number | null }>('SELECT deleted_at AS d FROM memory_passage WHERE id = 12')?.d).toBe(
        version >= 5 ? 4400 : null,
      );
      if (version >= 2) {
        expect(t.queryOne('SELECT cursor, tier FROM memory_resume_state WHERE card_id = 101')).toEqual({
          cursor: 1,
          tier: version >= 4 ? 1 : 0,
        });
      }
      expect(count(t, 'memory_recite_detail')).toBe(version >= 6 ? 1 : 0);
      expect(count(t, 'memory_push_card')).toBe(version >= 7 ? 1 : 0);

      // Recorded, in the same transaction.
      expect(legacyImportRecord(t)).toMatchObject({ status: 'imported', recordedAt: NOW });

      // The source was not touched.
      expect(fileHash(path)).toBe(before);

      // The store reads the imported plan as the extension did.
      const store = new MemoryStore(createSqlPort(t));
      expect((await store.listCollections()).map((c) => c.name)).toEqual(['My plan', 'Psalms']);
      expect((await store.listPassages(1)).map((p) => p.id)).toEqual(version >= 5 ? [10] : [10, 12]);
      if (version >= 2) {
        // The saved scope names list 2 by id: still valid because ids were kept.
        expect(await store.getScope()).toEqual({ kind: 'list', id: 2 });
        expect(await store.getDefaultAnswerMode()).toBe('fullWord');
      }
      const tiers = await store.listTierProgress([10, 11]);
      expect(tiers.length).toBeGreaterThan(0);
    });
  }

  it('imports an empty (freshly installed) extension database', () => {
    const path = legacyFile(7, false);
    const t = target();
    const result = run(t, path);
    expect(result).toMatchObject({ status: 'imported', sourceVersion: 7 });
    expect(MEMORY_TABLES.map((n) => count(t, n)).every((n) => n === 0)).toBe(true);
    expect(legacyImportRecord(t)?.status).toBe('imported');
  });
});

describe('legacy import: runs once', () => {
  it('does not open the source again after it has been recorded', () => {
    const path = legacyFile(7);
    const t = target();
    expect(run(t, path).status).toBe('imported');
    const open = vi.fn(opener(path));
    expect(importLegacyMemory(t, { openSource: open, now: NOW })).toEqual({ status: 'already-recorded', recorded: 'imported' });
    expect(open).not.toHaveBeenCalled();
    expect(count(t, 'memory_passage')).toBe(3);
  });

  it('records nothing when there is no old database, and looks again next time', () => {
    const t = target();
    expect(run(t, join(dir, 'missing.db'))).toEqual({ status: 'no-source' });
    expect(legacyImportRecord(t)).toBeUndefined();
    const path = legacyFile(7);
    expect(run(t, path).status).toBe('imported');
  });
});

describe('legacy import: never over real data', () => {
  it('skips (and records) when the store already holds passages, changing nothing', () => {
    const path = legacyFile(7);
    const t = target();
    t.execute("INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 1)");
    t.execute(
      "INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at) VALUES (1, 1, 'KJV', 1001001, 1001001, 'Genesis 1:1', 1, 1)",
    );
    const result = run(t, path);
    expect(result.status).toBe('skipped-not-empty');
    expect(t.queryAll('SELECT id, reference FROM memory_passage')).toEqual([{ id: 1, reference: 'Genesis 1:1' }]);
    expect(count(t, 'memory_card')).toBe(0);
    expect(legacyImportRecord(t)?.status).toBe('skipped-not-empty');
    expect(run(t, path).status).toBe('already-recorded');
  });

  it('replaces the empty Default list the module creates on first start', () => {
    const path = legacyFile(7);
    const t = target();
    t.execute("INSERT INTO memory_collection (id, name, created_at) VALUES (5, 'Default', 1)");
    expect(run(t, path).status).toBe('imported');
    expect(t.queryAll<{ id: number }>('SELECT id FROM memory_collection ORDER BY id').map((r) => r.id)).toEqual([1, 2]);
    expect(t.queryOne<{ value: string }>("SELECT value FROM memory_setting WHERE key = 'defaultAnswerMode'")?.value).toBe('fullWord');
  });

  it('keeps lists and settings the user made in the module: skipped, nothing deleted', () => {
    const path = legacyFile(7);
    for (const setup of [
      "INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 1), (7, 'Psalms to learn', 1)",
      "INSERT INTO memory_collection (id, name, created_at) VALUES (3, 'My own list', 1)",
      "INSERT INTO memory_setting (key, value) VALUES ('defaultAnswerMode', 'firstLetter')",
    ]) {
      const t = target();
      t.execute(setup);
      const before = MEMORY_TABLES.map((n) => t.queryAll(`SELECT * FROM ${n}`));
      expect(run(t, path).status, setup).toBe('skipped-not-empty');
      expect(MEMORY_TABLES.map((n) => t.queryAll(`SELECT * FROM ${n}`))).toEqual(before);
    }
  });

  it('maps every target column: each one is read from the old file or has a default', () => {
    const t = target();
    for (const map of LEGACY_TABLES) {
      const targetCols = t.queryAll<{ name: string }>(`PRAGMA table_info(${map.to})`).map((c) => c.name).sort();
      expect(Object.keys(map.columns).sort(), map.to).toEqual(targetCols);
    }
    expect(LEGACY_TABLES.map((m) => m.to).sort()).toEqual([...MEMORY_TABLES].sort());
  });
});

describe('legacy import: refuses what it cannot read', () => {
  it('does not import or record a database from a newer extension', () => {
    const path = legacyFile(7);
    const db = new Database(path);
    db.prepare("UPDATE meta SET value = '8' WHERE key = 'schema_version'").run();
    db.close();
    const t = target();
    expect(run(t, path)).toEqual({ status: 'unsupported-version', sourceVersion: 8 });
    expect(legacyImportRecord(t)).toBeUndefined();
    expect(count(t, 'memory_passage')).toBe(0);
  });

  it('does not import or record a file that is not a memory database', () => {
    const path = join(dir, 'other.db');
    const db = new Database(path);
    db.exec('CREATE TABLE something (x INTEGER)');
    db.close();
    const t = target();
    expect(run(t, path)).toEqual({ status: 'not-a-memory-db' });
    expect(legacyImportRecord(t)).toBeUndefined();
  });
});

describe('legacy import: all or nothing', () => {
  it('rolls everything back, records nothing and retries later when a write fails', () => {
    const path = legacyFile(7);
    const t = target();
    t.execute(
      "CREATE TRIGGER fail_attempts BEFORE INSERT ON memory_attempt WHEN NEW.id = 1002 BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    expect(() => run(t, path)).toThrow(/disk full/);
    for (const table of MEMORY_TABLES) expect(count(t, table)).toBe(0);
    expect(legacyImportRecord(t)).toBeUndefined();

    t.execute('DROP TRIGGER fail_attempts');
    expect(run(t, path).status).toBe('imported');
    expect(count(t, 'memory_attempt')).toBe(4);
  });

  it('leaves out (and counts) orphan rows instead of writing broken references', () => {
    const path = legacyFile(7);
    const db = new Database(path);
    db.pragma('foreign_keys = OFF');
    db.prepare("INSERT INTO card (id, passage_id, rung, state) VALUES (999, 777, 'blanks', 'new')").run();
    db.prepare('INSERT INTO attempt (id, card_id, at, score, correct_first, total_steps) VALUES (9999, 999, 1, 1, 1, 1)').run();
    db.close();
    const t = target();
    const result = run(t, path);
    expect(result).toMatchObject({ status: 'imported', dropped: { memory_card: 1, memory_attempt: 1 } });
    expect(count(t, 'memory_card')).toBe(6);
    expect(t.queryAll('PRAGMA foreign_key_check')).toEqual([]);
  });
});

describe('legacy import: a live extension database', () => {
  it('reads committed rows still in the WAL, without writing the source', () => {
    const path = legacyFile(7);
    const writer = new Database(path);
    writer.pragma('journal_mode = WAL');
    writer.pragma('wal_autocheckpoint = 0');
    writer.prepare("INSERT INTO collection (id, name, created_at) VALUES (3, 'Added while running', 5000)").run();
    const before = fileHash(path);
    const t = target();
    const result = run(t, path);
    expect(result.status).toBe('imported');
    expect(t.queryOne('SELECT name FROM memory_collection WHERE id = 3')).toEqual({ name: 'Added while running' });
    expect(fileHash(path)).toBe(before);
    writer.close();
  });

  it('keys its record by a stable source name', () => {
    expect(LEGACY_SOURCE_KEY).toBe('extension:ext.bible-app.scripture-memory/memory');
  });
});
