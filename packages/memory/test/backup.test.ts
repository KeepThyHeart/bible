/**
 * Memory rows through the host's backup format (task 0114): the registry's
 * classification of the `memory_*` tables drives backup, replace and merge.
 * Run against databases holding only the memory schema, so it exercises
 * exactly these specs.
 */

import { describe, expect, it } from 'vitest';
import { Backup } from '@bible/core/browser';

import { installMemorySchema } from '../src/core/schema';
import { TestSql } from './helpers/sqlite';

const APP = { name: 'Keep Thy Heart', version: '0.1.0', platform: 'test' };

function db(): TestSql {
  const t = new TestSql();
  installMemorySchema(t);
  return t;
}

function seed(t: TestSql): void {
  const x = (sql: string) => t.execute(sql);
  x("INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 10), (2, 'Psalms', 20)");
  x("INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at, recite_on) VALUES (10, 1, 'KJV', 43003016, 43003017, 'John 3:16-17', 2, 30, 1), (11, 2, 'KJV', 19023001, 19023006, 'Psalms 23:1-6', 6, 40, 0)");
  x("INSERT INTO memory_card (id, passage_id, rung, state, interval_step, due_at, streak, last_score) VALUES (100, 10, 'ordering', 'learning', 1, 500, 1, 0.9), (101, 10, 'recite', 'new', -1, NULL, 0, NULL), (102, 11, 'blanks', 'new', -1, NULL, 0, NULL)");
  x("INSERT INTO memory_attempt (id, card_id, at, score, correct_first, total_steps, duration_ms, tier) VALUES (1000, 100, 400, 0.9, 1, 1, 1000, 0), (1001, 101, 410, 0.8, 1, 1, NULL, 0)");
  x("INSERT INTO memory_recite_detail (attempt_id, card_id, at, verdicts, credits, verse_scores, extras, strictness) VALUES (1001, 101, 410, 'cc', '[1,1]', '[0.8]', 0, 'normal')");
  x(`INSERT INTO memory_setting (key, value) VALUES ('practiceScope', '{"kind":"list","id":2}'), ('defaultAnswerMode', 'fullWord')`);
  x('INSERT INTO memory_resume_state (card_id, cursor, correct_first, graded_units, updated_at, tier) VALUES (102, 2, 1, 2, 420, 0)');
  x("INSERT INTO memory_push_card (key, passage_id, fire_at, origin, state, updated_at) VALUES ('10@900', 10, 900, 'plan', 'scheduled', 430)");
  x("INSERT INTO memory_import (source, status, recorded_at) VALUES ('extension:x', 'imported', 1)");
}

function rows(t: TestSql, table: string): unknown[] {
  return t.queryAll(`SELECT * FROM ${table} ORDER BY 1`);
}

async function restore(from: TestSql, to: TestSql, mode: Backup.RestoreMode) {
  const { zip } = await Backup.createBackupPayload({ sql: from }, { includeHistory: true, app: APP, now: () => new Date('2026-10-07T00:00:00Z') });
  const archive = await Backup.readBackupPayload(Backup.once(zip));
  const plan = Backup.inspectBackup(archive, { sql: to }, { preview: false });
  const report = await Backup.applyRestore(plan, { sql: to }, { mode, sections: Backup.defaultSections(plan, 'replace') });
  return { archive, report };
}

const BACKED_UP = ['memory_collection', 'memory_passage', 'memory_card', 'memory_attempt', 'memory_recite_detail', 'memory_setting', 'memory_resume_state'];

describe('memory tables in backups', () => {
  it('are all classified', () => {
    for (const t of [...BACKED_UP, 'memory_push_card', 'memory_import']) expect(Backup.isClassified(t), t).toBe(true);
    expect(Backup.tableSpec('memory_push_card')).toBeUndefined();
    expect(Backup.tableSpec('memory_import')).toBeUndefined();
  });

  it('a backup carries the memory sections and stamps schema version 2', async () => {
    const a = db();
    seed(a);
    const { archive } = await restore(a, db(), 'replace');
    expect(archive.manifest.userSchemaVersion).toBe(2);
    const ids = archive.manifest.sections.map((s) => s.id);
    for (const t of BACKED_UP) expect(ids).toContain(`user.${t}`);
    expect(ids.some((id) => id.includes('memory_push_card') || id.includes('memory_import'))).toBe(false);
  });

  it('replace into an empty database reproduces every backed-up row with its id', async () => {
    const a = db();
    seed(a);
    const b = db();
    const { report } = await restore(a, b, 'replace');
    expect(report.ok).toBe(true);
    for (const t of BACKED_UP) expect(rows(b, t), t).toEqual(rows(a, t));
    expect(rows(b, 'memory_push_card')).toEqual([]);
    expect(rows(b, 'memory_import')).toEqual([]);
    expect(b.queryAll('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('replace keeps this machine\'s import record', async () => {
    const a = db();
    seed(a);
    const b = db();
    b.execute("INSERT INTO memory_import (source, status, recorded_at) VALUES ('extension:mine', 'imported', 5)");
    await restore(a, b, 'replace');
    expect(rows(b, 'memory_import')).toEqual([{ source: 'extension:mine', status: 'imported', source_version: null, recorded_at: 5, counts: null, detail: null }]);
  });

  it('merge into a database with its own plan keeps local rows, joins lists by name and remaps ids', async () => {
    const a = db();
    seed(a);
    const b = db();
    b.execute("INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 99), (5, 'Mine', 99)");
    b.execute("INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at) VALUES (10, 5, 'KJV', 1001001, 1001001, 'Genesis 1:1', 1, 1)");
    b.execute("INSERT INTO memory_card (id, passage_id, rung, state) VALUES (100, 10, 'ordering', 'new')");
    b.execute("INSERT INTO memory_setting (key, value) VALUES ('defaultAnswerMode', 'firstLetter')");
    const { report } = await restore(a, b, 'merge');
    expect(report.ok).toBe(true);
    expect(b.queryAll('PRAGMA foreign_key_check')).toEqual([]);

    // Lists: the backup's Default joins the local Default; Psalms is new.
    expect(b.queryAll<{ name: string }>('SELECT name FROM memory_collection ORDER BY id').map((r) => r.name)).toEqual(['Default', 'Mine', 'Psalms']);
    // Local passage 10 is untouched; the backup's passages got new ids under the right lists.
    expect(b.queryOne('SELECT reference, collection_id FROM memory_passage WHERE id = 10')).toEqual({ reference: 'Genesis 1:1', collection_id: 5 });
    const john = b.queryOne<{ id: number; collection_id: number }>("SELECT id, collection_id FROM memory_passage WHERE reference = 'John 3:16-17'")!;
    expect(john.collection_id).toBe(1);
    // History follows its passage through the remapped card ids.
    const history = b.queryAll<{ reference: string; score: number }>(
      'SELECT p.reference, a.score FROM memory_attempt a JOIN memory_card c ON c.id = a.card_id JOIN memory_passage p ON p.id = c.passage_id ORDER BY a.at',
    );
    expect(history).toEqual([{ reference: 'John 3:16-17', score: 0.9 }, { reference: 'John 3:16-17', score: 0.8 }]);
    expect(b.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM memory_recite_detail')?.n).toBe(1);
    // A local preference wins over the backup's.
    expect(b.queryOne("SELECT value FROM memory_setting WHERE key = 'defaultAnswerMode'")).toEqual({ value: 'firstLetter' });

    // Merging again changes nothing.
    const before = BACKED_UP.map((t) => rows(b, t));
    await restore(a, b, 'merge');
    expect(BACKED_UP.map((t) => rows(b, t))).toEqual(before);
  });

  it('merge keeps the local schedule but the later progress reset, so reset history stays hidden', async () => {
    const a = db();
    seed(a); // card 100 never reset in the backup
    const b = db();
    seed(b);
    b.execute('UPDATE memory_card SET progress_reset_at = 450, interval_step = -1, due_at = NULL WHERE id = 100');
    await restore(a, b, 'merge');
    expect(b.queryOne('SELECT progress_reset_at, interval_step, due_at FROM memory_card WHERE id = 100')).toEqual({
      progress_reset_at: 450,
      interval_step: -1,
      due_at: null,
    });
  });
});
