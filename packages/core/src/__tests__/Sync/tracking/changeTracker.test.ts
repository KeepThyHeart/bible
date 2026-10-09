/**
 * ChangeTracker (contracts 0063 §4, task 0150 W1-C) over the real core user schema.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestSqliteProvider } from '../../helpers/TestSqliteProvider';
import { createUserSchema } from '../../../Data/UserSchema';
import { USER_TABLES } from '../../../Backup/Registry';
import {
  createChangeTracker, coreTrackedTables, type ChangeTracker, type TrackedTable,
} from '../../../Sync/tracking/ChangeTracker';
import type { RecordPlaintext } from '../../../Sync/types';

const US = String.fromCharCode(31);
const RID = (n: number): string => n.toString(16).padStart(32, '0');

/** Values that satisfy the DDL's CHECK constraints, for the generic per-table test. */
const CHECKED_VALUES: Record<string, string | number> = {
  item_type: 'verse', content_type: 'note', value_type: 'string', status: 'active', priority: 1,
  content_format: 'html', note_type: 'verse_note', visibility: 'private', link_type: 'reference',
};

let db: TestSqliteProvider;
let tracker: ChangeTracker;

interface Rec { table_name: string; local_key: string; dirty: number; deleted: number; server_seq: number | null; record_id: string | null }
const records = (kind?: string): Rec[] =>
  kind === undefined
    ? db.queryAll<Rec>('SELECT * FROM sync_record ORDER BY table_name, local_key')
    : db.queryAll<Rec>('SELECT * FROM sync_record WHERE table_name = ? ORDER BY local_key', [kind]);
const record = (kind: string, key: string): Rec | undefined =>
  db.queryOne<Rec>('SELECT * FROM sync_record WHERE table_name = ? AND local_key = ?', [kind, key]);

function addNote(content = 'hello'): number {
  return db.execute('INSERT INTO user_note (content) VALUES (?)', [content]).lastInsertRowId!;
}

function addMemoryChain(): { passage: number; card: number; attempt: number } {
  const coll = db.execute("INSERT INTO memory_collection (name, created_at) VALUES ('Default', 1)").lastInsertRowId!;
  const passage = db.execute(
    `INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
     VALUES (?, 'KJV', 1001001, 1001002, 'Gen 1:1-2', 2, 1)`, [coll]).lastInsertRowId!;
  const card = db.execute("INSERT INTO memory_card (passage_id, rung, state) VALUES (?, 'r1', 'new')", [passage]).lastInsertRowId!;
  const attempt = db.execute(
    'INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (?, 1, 0.5, 1, 4)', [card]).lastInsertRowId!;
  return { passage, card, attempt };
}

/** Pretend the server has every current record (as after a push). */
function syncAll(): void {
  let seq = 1;
  for (const r of records()) {
    tracker.markSynced(r.table_name, r.local_key, { recordId: RID(seq), serverSeq: seq, hlc: 'h', baseJson: '{}', deleted: r.deleted === 1 });
    seq++;
  }
}

beforeEach(() => {
  db = new TestSqliteProvider(':memory:');
  createUserSchema(db);
  tracker = createChangeTracker(db);
});
afterEach(() => db.close());

describe('coreTrackedTables', () => {
  it('is every content table plus the memory workspace tables and extension_storage as ext.kv', () => {
    const tables = coreTrackedTables();
    const names = tables.map((t) => t.table);
    for (const spec of USER_TABLES.filter((t) => t.cls === 'content')) expect(names).toContain(spec.name);
    expect(names).toContain('memory_setting');
    expect(names).toContain('memory_resume_state');
    expect(tables.find((t) => t.table === 'extension_storage')).toEqual({ table: 'extension_storage', pk: ['extension_id', 'key'], kind: 'ext.kv' });
    expect(names).not.toContain('session');
    expect(names).not.toContain('setting');
    expect(names).not.toContain('user_search_history');
    expect(names.length).toBe(USER_TABLES.filter((t) => t.cls === 'content').length + 3);
    for (const t of tables) if (t.table !== 'extension_storage') expect(t.kind).toBe(t.table);
  });
});

describe('install', () => {
  it('creates the sync tables and three triggers on every tracked table', () => {
    tracker.install(coreTrackedTables());
    const tables = db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sync%'").map((r) => r.name);
    expect(tables.sort()).toEqual(['sync_opaque', 'sync_pending', 'sync_record', 'sync_state']);
    const triggers = new Set(db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'").map((r) => r.name));
    for (const t of coreTrackedTables()) {
      for (const s of ['ai', 'au', 'ad']) expect(triggers.has(`sync_trg_${t.table}_${s}`)).toBe(true);
    }
  });

  it('tracks insert, update and delete on every tracked table', () => {
    tracker.install(coreTrackedTables());
    db.exec('PRAGMA foreign_keys = OFF');
    let n = 0;
    for (const t of coreTrackedTables()) {
      const cols = db.queryAll<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>(
        `PRAGMA table_info("${t.table}")`);
      const fill = cols.filter((c) => c.pk > 0 || (c.notnull === 1 && c.dflt_value === null));
      const values = fill.map((c) => CHECKED_VALUES[c.name] ?? (/INT|REAL/i.test(c.type) ? 7 : 'v7'));
      db.execute(`INSERT INTO "${t.table}" (${fill.map((c) => `"${c.name}"`).join(', ')}) VALUES (${fill.map(() => '?').join(', ')})`, values);
      const key = t.pk.map((p) => String(values[fill.findIndex((c) => c.name === p)])).join(US);
      expect(record(t.kind, key), `insert ${t.table}`).toMatchObject({ dirty: 1, deleted: 0 });

      tracker.markSynced(t.kind, key, { recordId: RID(++n), serverSeq: 1, hlc: 'h', baseJson: null, deleted: false });
      expect(record(t.kind, key)!.dirty).toBe(0);
      const nonPk = cols.find((c) => c.pk === 0);
      const setCol = nonPk ? nonPk.name : t.pk[0];
      db.execute(`UPDATE "${t.table}" SET "${setCol}" = "${setCol}"`);
      expect(record(t.kind, key), `update ${t.table}`).toMatchObject({ dirty: 1, deleted: 0 });

      db.execute(`DELETE FROM "${t.table}"`);
      expect(record(t.kind, key), `delete ${t.table}`).toMatchObject({ dirty: 1, deleted: 1 });
    }
  });

  it('joins a composite primary key with char(31) and records it under ext.kv', () => {
    tracker.install(coreTrackedTables());
    db.execute("INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES ('ext.a', 'k1', '1', 1)");
    expect(records('ext.kv').map((r) => r.local_key)).toEqual([`ext.a${US}k1`]);
    expect(records('extension_storage')).toEqual([]);
  });

  it('is idempotent and enrols rows that existed before', () => {
    const note = addNote();
    db.execute("INSERT INTO memory_setting (key, value) VALUES ('answerMode', 'type')");
    tracker.install(coreTrackedTables());
    expect(record('user_note', String(note))).toMatchObject({ dirty: 1, deleted: 0 });
    expect(record('memory_setting', 'answerMode')).toMatchObject({ dirty: 1 });
    syncAll();
    const before = records();
    const schema = db.queryAll('SELECT type, name, sql FROM sqlite_master ORDER BY type, name');
    tracker.install(coreTrackedTables());
    expect(records()).toEqual(before);
    expect(db.queryAll('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')).toEqual(schema);
  });

  it('skips tables that do not exist yet', () => {
    db.exec('DROP TABLE memory_setting');
    const extra: TrackedTable = { table: 'not_there', pk: ['id'], kind: 'not_there' };
    expect(() => tracker.install([...coreTrackedTables(), extra])).not.toThrow();
    const triggers = db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync_trg_%'").map((r) => r.name);
    expect(triggers.some((n) => n.startsWith('sync_trg_memory_setting_'))).toBe(false);
    expect(triggers.some((n) => n.startsWith('sync_trg_not_there_'))).toBe(false);
    expect(triggers).toContain('sync_trg_user_note_ai');
  });
});

describe('triggers', () => {
  beforeEach(() => tracker.install(coreTrackedTables()));

  it('deleting a row the server never had removes its record; otherwise leaves a dirty tombstone', () => {
    const a = addNote('a');
    const b = addNote('b');
    tracker.markSynced('user_note', String(b), { recordId: RID(2), serverSeq: 5, hlc: 'h', baseJson: '{}', deleted: false });
    db.execute('DELETE FROM user_note WHERE note_id IN (?, ?)', [a, b]);
    expect(record('user_note', String(a))).toBeUndefined();
    expect(record('user_note', String(b))).toMatchObject({ dirty: 1, deleted: 1, server_seq: 5, record_id: RID(2) });
  });

  it('re-inserting a tombstoned key revives it', () => {
    db.execute("INSERT INTO memory_setting (key, value) VALUES ('k', '1')");
    tracker.markSynced('memory_setting', 'k', { recordId: RID(1), serverSeq: 1, hlc: 'h', baseJson: null, deleted: false });
    db.execute("DELETE FROM memory_setting WHERE key = 'k'");
    db.execute("INSERT INTO memory_setting (key, value) VALUES ('k', '2')");
    expect(record('memory_setting', 'k')).toMatchObject({ dirty: 1, deleted: 0, record_id: RID(1) });
  });

  it('an update that changes the primary key is a delete of the old key and an insert of the new one', () => {
    db.execute("INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES ('e', 'old', '1', 1)");
    db.execute("INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES ('e', 'gone', '1', 1)");
    tracker.markSynced('ext.kv', `e${US}old`, { recordId: RID(1), serverSeq: 1, hlc: 'h', baseJson: null, deleted: false });
    db.execute("UPDATE extension_storage SET key = 'new' WHERE key = 'old'");
    db.execute("UPDATE extension_storage SET key = 'gone2' WHERE key = 'gone'");
    expect(record('ext.kv', `e${US}old`)).toMatchObject({ dirty: 1, deleted: 1, record_id: RID(1) });
    expect(record('ext.kv', `e${US}new`)).toMatchObject({ dirty: 1, deleted: 0, record_id: null });
    expect(record('ext.kv', `e${US}gone`)).toBeUndefined();
    expect(record('ext.kv', `e${US}gone2`)).toMatchObject({ dirty: 1, deleted: 0 });
  });

  it('tracks foreign-key cascade deletes: user_note -> note_verse_link', () => {
    const note = addNote();
    const link = db.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (?, 1, 1)', [note]).lastInsertRowId!;
    syncAll();
    db.execute('DELETE FROM user_note WHERE note_id = ?', [note]);
    expect(db.queryAll('SELECT * FROM note_verse_link')).toEqual([]);
    expect(record('note_verse_link', String(link))).toMatchObject({ dirty: 1, deleted: 1 });
    expect(record('user_note', String(note))).toMatchObject({ dirty: 1, deleted: 1 });
  });

  it('tracks foreign-key cascade deletes: memory_card -> memory_attempt (and resume state)', () => {
    const { card, attempt } = addMemoryChain();
    db.execute('INSERT INTO memory_resume_state (card_id, cursor, correct_first, graded_units, updated_at) VALUES (?, 1, 1, 1, 1)', [card]);
    syncAll();
    db.execute('DELETE FROM memory_card WHERE id = ?', [card]);
    expect(record('memory_attempt', String(attempt))).toMatchObject({ dirty: 1, deleted: 1 });
    expect(record('memory_resume_state', String(card))).toMatchObject({ dirty: 1, deleted: 1 });
    expect(record('memory_card', String(card))).toMatchObject({ dirty: 1, deleted: 1 });
  });

  it('cascade of never-pushed children just forgets them', () => {
    const note = addNote();
    db.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (?, 1, 1)', [note]);
    db.execute('DELETE FROM user_note WHERE note_id = ?', [note]);
    expect(records()).toEqual([]);
  });

  it('leaves the note full-text index behaving exactly as without tracking', () => {
    const run = (d: TestSqliteProvider, apply: (fn: () => void) => void): number[][] => {
      const hit = (q: string): number[] =>
        d.queryAll<{ rowid: number }>('SELECT rowid FROM user_note_fts WHERE user_note_fts MATCH ? ORDER BY rowid', [q]).map((r) => r.rowid);
      const out: number[][] = [];
      const id = d.execute("INSERT INTO user_note (content) VALUES ('the quick brown fox')").lastInsertRowId!;
      out.push(hit('quick'));
      d.execute("UPDATE user_note SET content = 'a lazy dog' WHERE note_id = ?", [id]);
      out.push(hit('lazy'), hit('quick'));
      apply(() => { d.execute("INSERT INTO user_note (content) VALUES ('remote words')"); });
      out.push(hit('remote'));
      d.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
      out.push(hit('lazy'));
      return out;
    };
    const plain = new TestSqliteProvider(':memory:');
    try {
      createUserSchema(plain);
      const expected = run(plain, (fn) => fn());
      const actual = run(db, (fn) => tracker.applyRemote(fn));
      expect(actual).toEqual(expected);
      expect(actual[0]).toEqual([1]);
      expect(actual[1]).toEqual([1]);
      expect(actual[3]).toEqual([2]);
    } finally {
      plain.close();
    }
  });
});

describe('applyRemote', () => {
  beforeEach(() => tracker.install(coreTrackedTables()));

  it('records nothing while applying, and tracks again afterwards', () => {
    const note = tracker.applyRemote(() => {
      const n = addNote('remote');
      db.execute("INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES ('e', 'k', '1', 1)");
      expect(tracker.state.get('applying')).toBe('1');
      return n;
    });
    expect(records()).toEqual([]);
    expect(tracker.state.get('applying')).toBe('0');
    db.execute("UPDATE user_note SET content = 'local' WHERE note_id = ?", [note]);
    expect(record('user_note', String(note))).toMatchObject({ dirty: 1 });
  });

  it('rolls back and restores the flag when fn throws', () => {
    expect(() => tracker.applyRemote(() => {
      addNote('doomed');
      throw new Error('boom');
    })).toThrow('boom');
    expect(tracker.state.get('applying')).toBe('0');
    expect(db.queryAll('SELECT * FROM user_note')).toEqual([]);
    const n = addNote('local');
    expect(record('user_note', String(n))).toMatchObject({ dirty: 1 });
  });

  it('remote deletes are not tracked', () => {
    const n = addNote();
    syncAll();
    tracker.applyRemote(() => db.execute('DELETE FROM user_note WHERE note_id = ?', [n]));
    expect(record('user_note', String(n))).toMatchObject({ dirty: 0, deleted: 0 });
  });
});

describe('bookkeeping API', () => {
  beforeEach(() => tracker.install(coreTrackedTables()));

  it('dirty / pendingCount / markSynced / assignRecordId / lookups', () => {
    const a = addNote('a');
    const b = addNote('b');
    expect(tracker.pendingCount()).toBe(2);
    const dirty = tracker.dirty(10);
    expect(dirty.map((d) => d.localKey).sort()).toEqual([String(a), String(b)].sort());
    expect(dirty[0]).toMatchObject({ kind: 'user_note', recordId: null, serverSeq: null, deleted: false, baseJson: null });
    expect(typeof dirty[0].changedMs).toBe('number');
    expect(Math.abs(dirty[0].changedMs - Date.now())).toBeLessThan(60_000);
    expect(tracker.dirty(1)).toHaveLength(1);

    tracker.assignRecordId('user_note', String(a), RID(9));
    expect(tracker.lookupByLocal('user_note', String(a))).toEqual({ recordId: RID(9) });
    expect(() => tracker.assignRecordId('user_note', '999', RID(10))).toThrow();

    tracker.markSynced('user_note', String(a), { recordId: RID(9), serverSeq: 3, hlc: 'hlc-a', baseJson: '{"x":1}', deleted: false });
    expect(tracker.pendingCount()).toBe(1);
    expect(tracker.lookupByRecordId(RID(9))).toEqual({
      kind: 'user_note', localKey: String(a), deleted: false, dirty: false, serverSeq: 3, baseJson: '{"x":1}', hlc: 'hlc-a',
    });
    expect(tracker.lookupByRecordId(RID(1))).toBeUndefined();
    expect(tracker.lookupByLocal('user_note', 'nope')).toBeUndefined();

    // A pulled record the tracker never saw (inserted while applying) is created by markSynced.
    tracker.markSynced('user_note', '77', { recordId: RID(77), serverSeq: 4, hlc: 'h', baseJson: null, deleted: true });
    expect(tracker.lookupByRecordId(RID(77))).toMatchObject({ localKey: '77', deleted: true, dirty: false });
  });

  it('state, opaque and pending stores', () => {
    expect(tracker.state.get('cursor')).toBeUndefined();
    tracker.state.set('cursor', '5');
    tracker.state.set('cursor', '6');
    expect(tracker.state.get('cursor')).toBe('6');

    tracker.opaque.put(RID(1), 2, new Uint8Array([1, 2, 3]));
    tracker.opaque.put(RID(2), 1, null);
    const opaque = tracker.opaque.all();
    expect(opaque.map((o) => o.id)).toEqual([RID(2), RID(1)]);
    expect(opaque[1].blob).toBeInstanceOf(Uint8Array);
    expect(Array.from(opaque[1].blob!)).toEqual([1, 2, 3]);
    expect(opaque[0].blob).toBeNull();
    tracker.opaque.remove(RID(1));
    expect(tracker.opaque.all()).toHaveLength(1);

    const pt: RecordPlaintext = { t: 'note_verse_link', cv: 1, h: 'h', dev: '00000000000000aa', d: { note: RID(3) } };
    tracker.pending.put(RID(4), 9, pt, [RID(3)]);
    expect(tracker.pending.all()).toEqual([{ id: RID(4), seq: 9, pt, missing: [RID(3)] }]);
    tracker.pending.remove(RID(4));
    expect(tracker.pending.all()).toEqual([]);
  });
});

describe('uninstall', () => {
  it('drops triggers and sync tables only; user rows stay and edits are no longer tracked', () => {
    tracker.install(coreTrackedTables());
    const note = addNote('keep me');
    db.execute("INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES ('e', 'k', '1', 1)");
    tracker.uninstall();
    expect(db.queryAll("SELECT name FROM sqlite_master WHERE name LIKE 'sync%'")).toEqual([]);
    expect(db.queryOne<{ content: string }>('SELECT content FROM user_note WHERE note_id = ?', [note])!.content).toBe('keep me');
    expect(db.queryAll('SELECT * FROM extension_storage')).toHaveLength(1);
    // FTS triggers survive, and writes work without the sync tables.
    const triggers = db.queryAll<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger'").map((r) => r.name);
    expect(triggers).toContain('user_note_fts_insert');
    expect(() => addNote('after')).not.toThrow();
    expect(() => tracker.uninstall()).not.toThrow();
    // Reinstall enrols everything again.
    tracker.install(coreTrackedTables());
    expect(tracker.pendingCount()).toBe(3);
  });
});
