/**
 * The manual "Import data from the old Scripture Memory extension" (task 0114
 * M2): a merge into a store that already has data. Same identities as a
 * backup merge; never changes local rows except the two documented repairs.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Backup } from '@bible/core/browser';

import { importLegacyMemory, LEGACY_EXTENSION_ID, mergeLegacyMemory } from '../src/core/legacyImport';
import { installMemorySchema } from '../src/core/schema';
import { readMemoryStatus } from '../src/core/status';
import { deletedPassageActivity, pushCardsEnabled, reviveMergedPassages } from '../src/core/maintenance';
import { createSqlPort } from '../src/core/sqlPort';
import { MemoryStore } from '../src/core/store';
import { TestSql } from './helpers/sqlite';
import { createLegacyDb } from './helpers/legacyDb';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'memory-merge-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function legacy(): string {
  const path = join(dir, 'memory.db');
  const db = createLegacyDb(path, 7);
  db.exec(`
    INSERT INTO collection (id, name, created_at) VALUES (1, 'Default', 1), (2, 'Psalms', 2);
    INSERT INTO passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
      VALUES (10, 1, 'KJV', 43003016, 43003016, 'John 3:16', 1, 3), (11, 2, 'KJV', 19023001, 19023002, 'Psalms 23:1-2', 2, 4);
    INSERT INTO card (id, passage_id, rung, state, progress_reset_at) VALUES (100, 10, 'blanks', 'new', 900), (101, 11, 'ordering', 'new', NULL);
    INSERT INTO attempt (id, card_id, at, score, correct_first, total_steps) VALUES (1000, 100, 1000, 1, 1, 1), (1001, 101, 1100, 0.5, 1, 2);
    INSERT INTO recite_detail (attempt_id, card_id, at, verdicts, credits, verse_scores, extras, strictness) VALUES (1000, 100, 1000, 'c', '[1]', '[1]', 0, 'normal');
    INSERT INTO setting (key, value) VALUES ('practiceScope', '{"kind":"list","id":2}'), ('defaultAnswerMode', 'fullWord');
    INSERT INTO push_card (key, passage_id, fire_at, origin, state, updated_at) VALUES ('10@5', 10, 5, 'plan', 'scheduled', 5);
  `);
  db.close();
  return path;
}

function target(): TestSql {
  const t = new TestSql();
  installMemorySchema(t);
  // The user's own plan: a Default list (id 1) holding John 3:16 (removed) and Genesis 1:1.
  t.db.exec(`
    INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 50), (5, 'Mine', 50);
    INSERT INTO memory_passage (id, collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at, deleted_at)
      VALUES (1, 1, 'KJV', 43003016, 43003016, 'John 3:16', 1, 60, 70), (2, 5, 'KJV', 1001001, 1001001, 'Genesis 1:1', 1, 60, NULL);
    INSERT INTO memory_card (id, passage_id, rung, state, interval_step, due_at, progress_reset_at) VALUES (1, 1, 'blanks', 'learning', 3, 4000, 500);
    INSERT INTO memory_setting (key, value) VALUES ('defaultAnswerMode', 'firstLetter');
  `);
  return t;
}

const open = (path: string) => () => new TestSql(new Database(path, { readonly: true, fileMustExist: true }));

describe('manual merge of the old extension database', () => {
  it('adds what is missing, matches what is here, keeps local rows and is idempotent', async () => {
    const path = legacy();
    const t = target();
    const result = mergeLegacyMemory(t, { openSource: open(path), now: 77 });
    expect(result).toMatchObject({
      status: 'merged',
      added: { memory_collection: 1, memory_passage: 1, memory_card: 1, memory_attempt: 2, memory_recite_detail: 1, memory_setting: 1 },
      matched: { memory_collection: 1, memory_passage: 1, memory_card: 1, memory_setting: 1 },
      revived: 1,
    });

    // Lists joined by name; Psalms is new.
    expect(t.queryAll<{ name: string }>('SELECT name FROM memory_collection ORDER BY id').map((r) => r.name)).toEqual(['Default', 'Mine', 'Psalms']);
    // The removed local John 3:16 is live again (the old database still has it); its local schedule stays, the later reset wins.
    expect(t.queryOne('SELECT deleted_at FROM memory_passage WHERE id = 1')).toEqual({ deleted_at: null });
    expect(t.queryOne('SELECT interval_step, due_at, progress_reset_at FROM memory_card WHERE id = 1')).toEqual({
      interval_step: 3,
      due_at: 4000,
      progress_reset_at: 900,
    });
    // History hangs off the local card.
    expect(t.queryAll('SELECT card_id, at FROM memory_attempt ORDER BY at')[0]).toEqual({ card_id: 1, at: 1000 });
    // A local preference wins; the scope is translated to the new list id; push cards are not copied.
    expect(t.queryOne("SELECT value FROM memory_setting WHERE key = 'defaultAnswerMode'")).toEqual({ value: 'firstLetter' });
    const psalms = t.queryOne<{ id: number }>("SELECT id FROM memory_collection WHERE name = 'Psalms'")!.id;
    expect(t.queryOne("SELECT value FROM memory_setting WHERE key = 'practiceScope'")).toEqual({ value: JSON.stringify({ kind: 'list', id: psalms }) });
    expect(t.queryAll('SELECT * FROM memory_push_card')).toEqual([]);
    expect(t.queryAll('PRAGMA foreign_key_check')).toEqual([]);

    // Recorded, and the automatic import will not run over it.
    expect(t.queryOne("SELECT status FROM memory_import WHERE source = 'extension:ext.bible-app.scripture-memory/memory'")).toEqual({ status: 'merged' });
    expect(importLegacyMemory(t, { openSource: open(path), now: 78 })).toEqual({ status: 'already-recorded', recorded: 'merged' });

    // Again: nothing new.
    const before = t.queryAll('SELECT * FROM memory_attempt ORDER BY id');
    expect(mergeLegacyMemory(t, { openSource: open(path), now: 79 })).toMatchObject({ status: 'merged', added: {}, revived: 0 });
    expect(t.queryAll('SELECT * FROM memory_attempt ORDER BY id')).toEqual(before);

    // The store reads the merged plan.
    const store = new MemoryStore(createSqlPort(t));
    expect((await store.listPassages(psalms)).map((p) => p.reference)).toEqual(['Psalms 23:1-2']);
  });

  it('does not undo a removal made after the old database\'s last practice; remaps pinned passages; marks a skipped import merged', () => {
    const path = legacy();
    const t = target();
    t.execute('UPDATE memory_passage SET deleted_at = 5000 WHERE id = 1'); // removed after the legacy attempt at 1000
    t.execute("INSERT INTO memory_import (source, status, recorded_at) VALUES ('extension:ext.bible-app.scripture-memory/memory', 'skipped-not-empty', 1)");
    const db = new Database(path);
    db.prepare("INSERT INTO setting (key, value) VALUES ('pushCards', ?)").run(JSON.stringify({ enabled: true, pinnedPassageIds: [11, 99] }));
    db.close();
    const result = mergeLegacyMemory(t, { openSource: open(path), now: 77 });
    expect(result).toMatchObject({ status: 'merged', revived: 0 });
    expect(t.queryOne('SELECT deleted_at FROM memory_passage WHERE id = 1')).toEqual({ deleted_at: 5000 });
    const psalms = t.queryOne<{ id: number }>("SELECT id FROM memory_passage WHERE reference = 'Psalms 23:1-2'")!.id;
    const push = JSON.parse(t.queryOne<{ value: string }>("SELECT value FROM memory_setting WHERE key = 'pushCards'")!.value);
    expect(push.pinnedPassageIds).toEqual([psalms]);
    expect(t.queryOne("SELECT status FROM memory_import WHERE source = 'extension:ext.bible-app.scripture-memory/memory'")).toEqual({ status: 'merged' });
  });

  it('a matched card takes the old schedule when it was practised there after anything here', () => {
    const path = legacy();
    const db = new Database(path);
    db.prepare("UPDATE card SET state = 'learning', interval_step = 4, due_at = 9000, streak = 3, last_score = 0.9, progress_reset_at = NULL WHERE id = 100").run();
    db.close();
    const t = target();
    t.db.exec('UPDATE memory_passage SET deleted_at = NULL WHERE id = 1');
    t.db.exec('UPDATE memory_card SET progress_reset_at = NULL WHERE id = 1');
    t.db.exec('INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (1, 400, 1, 1, 1)');
    const result = mergeLegacyMemory(t, { openSource: open(path), now: 77 });
    expect(result).toMatchObject({ status: 'merged', advanced: { memory_card: 1 } });
    expect(t.queryOne('SELECT state, interval_step, due_at, streak, last_score FROM memory_card WHERE id = 1')).toEqual({
      state: 'learning', interval_step: 4, due_at: 9000, streak: 3, last_score: 0.9,
    });
  });

  it('a matched card keeps newer local progress, or a reset newer than the old practice', () => {
    const path = legacy();
    const db = new Database(path);
    db.prepare("UPDATE card SET state = 'learning', interval_step = 4, due_at = 9000 WHERE id = 100").run();
    db.close();
    const t = target();
    t.db.exec('INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (1, 2000, 1, 1, 1)'); // newer than the old 1000
    expect(mergeLegacyMemory(t, { openSource: open(path), now: 77 })).toMatchObject({ advanced: {} });
    expect(t.queryOne('SELECT interval_step, due_at FROM memory_card WHERE id = 1')).toEqual({ interval_step: 3, due_at: 4000 });
    const t2 = target(); // reset at 900 is only newer than... the old practice at 1000? No: 1000 > 900, so reset 1500 here
    t2.db.exec('UPDATE memory_card SET progress_reset_at = 1500 WHERE id = 1');
    mergeLegacyMemory(t2, { openSource: open(path), now: 77 });
    expect(t2.queryOne('SELECT interval_step, due_at FROM memory_card WHERE id = 1')).toEqual({ interval_step: 3, due_at: 4000 });
  });

  it('a list renamed here is still the old database\'s list: no second plan, even after an import', () => {
    const path = legacy();
    const t = new TestSql();
    installMemorySchema(t);
    expect(importLegacyMemory(t, { openSource: open(path), now: 10 })).toMatchObject({ status: 'imported' });
    t.execute("UPDATE memory_collection SET name = 'Psalms to learn' WHERE id = 2");
    const result = mergeLegacyMemory(t, { openSource: open(path), now: 77 });
    expect(result).toMatchObject({ status: 'merged', matched: { memory_collection: 2, memory_passage: 2 }, added: {} });
    expect(t.queryAll<{ name: string }>('SELECT name FROM memory_collection ORDER BY id').map((r) => r.name)).toEqual(['Default', 'Psalms to learn']);
    expect(t.queryOne('SELECT COUNT(*) AS n FROM memory_passage')).toEqual({ n: 2 });
  });

  it('a list brought over by a merge is found by id after a rename too', () => {
    const path = legacy();
    const t = target();
    mergeLegacyMemory(t, { openSource: open(path), now: 77 });
    t.execute("UPDATE memory_collection SET name = 'Renamed' WHERE name = 'Psalms'");
    const again = mergeLegacyMemory(t, { openSource: open(path), now: 78 });
    expect(again).toMatchObject({ matched: { memory_collection: 2 }, added: {} });
    expect(t.queryAll<{ name: string }>('SELECT name FROM memory_collection ORDER BY id').map((r) => r.name)).toEqual(['Default', 'Mine', 'Renamed']);
  });

  it('writes nothing when a step fails', () => {
    const path = legacy();
    const t = target();
    t.db.exec("CREATE TRIGGER boom BEFORE INSERT ON memory_attempt WHEN NEW.at = 1100 BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const before = ['memory_collection', 'memory_passage', 'memory_card', 'memory_attempt', 'memory_setting', 'memory_import'].map((n) => t.queryAll(`SELECT * FROM ${n}`));
    expect(() => mergeLegacyMemory(t, { openSource: open(path), now: 1 })).toThrow(/disk full/);
    expect(['memory_collection', 'memory_passage', 'memory_card', 'memory_attempt', 'memory_setting', 'memory_import'].map((n) => t.queryAll(`SELECT * FROM ${n}`))).toEqual(before);
  });

  it('reports a missing or unreadable source without touching anything', () => {
    const t = target();
    expect(mergeLegacyMemory(t, { openSource: () => null, now: 1 })).toEqual({ status: 'no-source' });
  });
});

describe('light status and maintenance', () => {
  it('readMemoryStatus agrees with the store', async () => {
    const t = target();
    t.db.exec(`INSERT INTO memory_card (passage_id, rung, state, due_at) VALUES (2, 'ordering', 'new', 10), (2, 'recite', 'new', 10)`);
    t.db.exec(`INSERT INTO memory_push_card (key, passage_id, fire_at, origin, state, updated_at) VALUES ('a', 2, 1, 'plan', 'waiting', 1), ('b', 1, 1, 'plan', 'waiting', 1)`);
    const store = new MemoryStore(createSqlPort(t));
    for (const now of [5, 50, 5000]) {
      expect(readMemoryStatus(t, now)).toEqual({ due: await store.dueCount({ kind: 'all' }, now), waiting: await store.waitingCount() });
    }
  });

  it('reviveMergedPassages brings back only passages that GAINED history newer than their removal', () => {
    const t = target();
    // Already here: an attempt after the removal (a session finishing late) - not a reason to revive.
    t.db.exec(`INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (1, 75, 1, 1, 1)`);
    const before = deletedPassageActivity(t);
    expect(before.get(1)).toBe(1);
    expect(reviveMergedPassages(t, before)).toBe(0);
    // The merge brings older history: still removed.
    t.db.exec(`INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (1, 60, 1, 1, 1)`);
    expect(reviveMergedPassages(t, before)).toBe(0);
    // The merge brings newer history: back.
    t.db.exec(`INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (1, 80, 1, 1, 1)`);
    expect(reviveMergedPassages(t, before)).toBe(1);
    expect(t.queryOne('SELECT deleted_at FROM memory_passage WHERE id = 1')).toEqual({ deleted_at: null });
  });

  it('pushCardsEnabled reads the push-card settings', () => {
    const t = target();
    expect(pushCardsEnabled(t)).toBe(false);
    t.execute("INSERT INTO memory_setting (key, value) VALUES ('pushCards', '{\"enabled\":true}')");
    expect(pushCardsEnabled(t)).toBe(true);
    t.execute("UPDATE memory_setting SET value = 'not json' WHERE key = 'pushCards'");
    expect(pushCardsEnabled(t)).toBe(false);
  });
});

describe('backups made before the move', () => {
  it('never held the extension database: it declared no backed-up databases', () => {
    // extension.json of the extension at the snapshot (bible-memory 347e271) has no `userData` block,
    // so the host backed up only its key-value store, never `memory.db`. Restoring an older backup
    // therefore cannot bring back memory data that the import would then miss.
    const userData = undefined;
    expect(Backup.resolveExtensionBackup(LEGACY_EXTENSION_ID, userData)).toEqual({ id: LEGACY_EXTENSION_ID, backupKv: true, databases: [] });
  });
});
