/** Restoring into a database that syncs: record identities are kept, tombstones are made, merge never duplicates. */
import { describe, it, expect } from 'vitest';
import { createBackupPayload, readBackupPayload } from '../../Backup/Payload';
import type { BackupArchive } from '../../Backup/Payload';
import { applyRestore, defaultSections, inspectBackup } from '../../Backup/Restore';
import type { RestoreMode } from '../../Backup/Restore';
import { once } from '../../Backup/Streams';
import { utf8Decode, utf8Encode } from '../../Crypto';
import { wopts } from './restoreHelpers';
import { idOf, lineAt, lines, markAllClean, newSyncedDb, syncedNote } from './syncedDb';
import type { SyncedDb } from './syncedDb';
import { FakeServer, addNote, cloneAccount, makeDevice, notes, testAccount } from '../Sync/engine/harness';
import { fixNoteFtsTriggers } from '../Sync/engine/harness';

async function backupOf(s: SyncedDb): Promise<BackupArchive> {
  const { zip } = await createBackupPayload({ sql: s.db }, wopts(false));
  return readBackupPayload(once(zip));
}
async function restore(t: SyncedDb, archive: BackupArchive, mode: RestoreMode) {
  const plan = inspectBackup(archive, { sql: t.db }, { preview: false });
  return applyRestore(plan, { sql: t.db }, { mode, sections: defaultSections(plan, mode) });
}
const contents = (s: SyncedDb): string[] => s.db.queryAll<{ content: string }>('SELECT content FROM user_note ORDER BY note_id').map((r) => r.content);
const dirtyCount = (s: SyncedDb): number => s.tracker.pendingCount();
const dump = (s: SyncedDb) => s.db.queryAll('SELECT * FROM sync_record ORDER BY table_name, local_key');

describe('merge into a synced database', () => {
  async function source() {
    const src = newSyncedDb();
    const n1 = syncedNote(src, idOf(1), 'one', 1);
    syncedNote(src, idOf(2), 'two', 2);
    src.db.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (?, 1, 1)', [n1]);
    src.tracker.markSynced('note_verse_link', '1', { recordId: idOf(10), serverSeq: 3, hlc: 'h3', baseJson: '{}', deleted: false });
    return src;
  }

  it('inserted rows take the backup record ids; merging again changes nothing (no duplicates, no new dirty rows)', async () => {
    const archive = await backupOf(await source());
    const t = newSyncedDb();
    syncedNote(t, idOf(9), 'mine', 5);
    const r1 = await restore(t, archive, 'merge');
    expect(r1.perTable.find((x) => x.table === 'user_note')).toMatchObject({ inserted: 2, matched: 0 });
    const byContent = Object.fromEntries(t.db.queryAll<{ note_id: number; content: string }>('SELECT note_id, content FROM user_note').map((r) => [r.content, r.note_id]));
    expect(lineAt(t, 'user_note', byContent.one)).toMatchObject({ record_id: idOf(1), dirty: 1, deleted: 0, server_seq: null });
    expect(lineAt(t, 'user_note', byContent.two)).toMatchObject({ record_id: idOf(2), dirty: 1 });
    expect(lines(t, 'note_verse_link')).toMatchObject([{ record_id: idOf(10), dirty: 1 }]);
    expect(t.db.queryOne('SELECT note_id FROM note_verse_link')).toEqual({ note_id: byContent.one });
    expect(lineAt(t, 'user_note', 1)).toMatchObject({ record_id: idOf(9), dirty: 0 }); // untouched

    markAllClean(t);
    const before = dump(t);
    const r2 = await restore(t, archive, 'merge');
    expect(r2.perTable.find((x) => x.table === 'user_note')).toMatchObject({ inserted: 0, matched: 2 });
    expect(r2.perTable.find((x) => x.table === 'note_verse_link')).toMatchObject({ inserted: 0, matched: 1 });
    expect(dirtyCount(t)).toBe(0);
    expect(contents(t).sort()).toEqual(['mine', 'one', 'two']);
    expect(dump(t)).toEqual(before);
  });

  it('a backup row whose record id is a live local record is that row: reused even when the content differs locally', async () => {
    const archive = await backupOf(await source());
    const t = newSyncedDb();
    const k = syncedNote(t, idOf(1), 'one, edited here', 4);
    t.db.execute("UPDATE user_note SET content = 'one, edited here 2' WHERE note_id = ?", [k]);
    markAllClean(t);
    await restore(t, archive, 'merge');
    expect(contents(t).sort()).toEqual(['one, edited here 2', 'two']);
    expect(lineAt(t, 'user_note', k)).toMatchObject({ record_id: idOf(1), dirty: 0, server_seq: 4 });
  });

  it('a local tombstone holding the record id is adopted: the row continues that record', async () => {
    const archive = await backupOf(await source());
    const t = newSyncedDb();
    const k = syncedNote(t, idOf(1), 'one', 7);
    t.db.execute('DELETE FROM user_note WHERE note_id = ?', [k]);
    expect(lineAt(t, 'user_note', k)).toMatchObject({ deleted: 1, dirty: 1, record_id: idOf(1), server_seq: 7 });
    await restore(t, archive, 'merge');
    const row = t.db.queryOne<{ note_id: number }>("SELECT note_id FROM user_note WHERE content = 'one'")!;
    expect(lineAt(t, 'user_note', row.note_id)).toMatchObject({ record_id: idOf(1), server_seq: 7, hlc: 'hlc-7', dirty: 1, deleted: 0 });
    expect(lines(t, 'user_note').filter((l) => l.deleted === 1)).toEqual([]);
    expect(lines(t, 'user_note').filter((l) => l.record_id === idOf(1))).toHaveLength(1);
  });

  it('an inserted row that reuses the local key of an unrelated local tombstone parks that tombstone on a synthetic key', async () => {
    // memory_collection has a plain INTEGER PRIMARY KEY, so a freed key is reused and the insert trigger revives the
    // tombstone line at that key (with its record id). The tombstone must move aside before the row takes the backup id.
    const src = newSyncedDb();
    src.db.execute("INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Default', 0)");
    src.tracker.markSynced('memory_collection', '1', { recordId: idOf(1), serverSeq: 1, hlc: 'h1', baseJson: '{}', deleted: false });
    const archive = await backupOf(src);
    const t = newSyncedDb();
    t.db.execute("INSERT INTO memory_collection (id, name, created_at) VALUES (1, 'Gone', 0)");
    t.tracker.markSynced('memory_collection', '1', { recordId: idOf(7), serverSeq: 7, hlc: 'h7', baseJson: '{}', deleted: false });
    t.db.execute('DELETE FROM memory_collection WHERE id = 1');
    expect(lineAt(t, 'memory_collection', 1)).toMatchObject({ record_id: idOf(7), deleted: 1 });
    await restore(t, archive, 'merge');
    expect(t.db.queryAll('SELECT id, name FROM memory_collection')).toEqual([{ id: 1, name: 'Default' }]);
    expect(lineAt(t, 'memory_collection', 1)).toMatchObject({ record_id: idOf(1), server_seq: null, dirty: 1, deleted: 0 });
    expect(lineAt(t, 'memory_collection', `\u001fr:${idOf(7)}`)).toMatchObject({ record_id: idOf(7), server_seq: 7, dirty: 1, deleted: 1 });
  });

  it('a record id claimed by two backup rows, or already used by another kind of record, is taken by at most one', async () => {
    const archive = await backupOf(await source());
    const path = 'user/user_note.ndjson';
    const rows = utf8Decode(archive.entries.get(path)!).trimEnd().split('\n').map((l) => JSON.parse(l));
    rows[1].sync_id = rows[0].sync_id;
    archive.entries.set(path, utf8Encode(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
    const t = newSyncedDb();
    t.db.execute("INSERT INTO collection (name) VALUES ('c')");
    t.tracker.markSynced('collection', '1', { recordId: idOf(1), serverSeq: 1, hlc: 'h', baseJson: '{}', deleted: false });
    await restore(t, archive, 'merge');
    expect(contents(t).sort()).toEqual(['one', 'two']);
    const ids = lines(t, 'user_note').map((l) => l.record_id);
    expect(ids).toEqual([null, null]);                       // idOf(1) belongs to a collection here; the second claim is dropped
    expect(lineAt(t, 'collection', 1)!.record_id).toBe(idOf(1));
  });

  it('a different record-id key (another account) means no identities are used: merge behaves as for 1.0', async () => {
    const archive = await backupOf(await source());
    const t = newSyncedDb({ fp: '0000000000000000' });
    const k = syncedNote(t, idOf(1), 'unrelated', 4);       // same id, other account: must not be treated as the same row
    await restore(t, archive, 'merge');
    expect(contents(t).sort()).toEqual(['one', 'two', 'unrelated']);
    expect(lineAt(t, 'user_note', k)).toMatchObject({ record_id: idOf(1), dirty: 0 });
    expect(lines(t, 'user_note').filter((l) => l.local_key !== String(k)).map((l) => l.record_id)).toEqual([null, null]);
  });

  it('a target that never synced (no fingerprint) and a 1.0 backup both merge as before', async () => {
    const archive = await backupOf(await source());
    const never = newSyncedDb({ fp: null });
    await restore(never, archive, 'merge');
    expect(lines(never, 'user_note').map((l) => l.record_id)).toEqual([null, null]);

    const oldSrc = newSyncedDb({ tracked: false });
    oldSrc.db.execute("INSERT INTO user_note (title, content) VALUES ('t', 'old')");
    const t = newSyncedDb();
    await restore(t, await backupOf(oldSrc), 'merge');
    expect(contents(t)).toEqual(['old']);
    expect(lines(t, 'user_note')).toMatchObject([{ record_id: null, dirty: 1 }]);
  });
});

describe('replace in a synced database', () => {
  it('rows keep their identities and server versions: a swap of local ids between two devices', async () => {
    // The backup's device numbered the same two records the other way round.
    const src = newSyncedDb();
    syncedNote(src, idOf(2), 'B content', 6);   // local id 1 there
    syncedNote(src, idOf(1), 'A content', 5);   // local id 2 there
    const t = newSyncedDb();
    syncedNote(t, idOf(1), 'A content', 5);
    syncedNote(t, idOf(2), 'B content', 6);
    const archive = await backupOf(src);
    await restore(t, archive, 'replace');
    expect(contents(t)).toEqual(['B content', 'A content']);
    expect(lineAt(t, 'user_note', 1)).toMatchObject({ record_id: idOf(2), server_seq: 6, hlc: 'hlc-6', dirty: 1, deleted: 0 });
    expect(lineAt(t, 'user_note', 2)).toMatchObject({ record_id: idOf(1), server_seq: 5, hlc: 'hlc-5', dirty: 1, deleted: 0 });
    expect(lines(t, 'user_note').filter((l) => l.deleted === 1)).toEqual([]);
    expect(t.db.queryOne("SELECT value FROM sync_state WHERE key = 'applying'")).toEqual({ value: '0' });
  });

  it('records that are not in the backup become tombstones, at their old key or, when taken, at a synthetic one', async () => {
    const src = newSyncedDb();
    syncedNote(src, idOf(1), 'kept', 5);
    src.db.execute("INSERT INTO user_note (title, content) VALUES ('t', 'new, never synced')");   // local id 2, no record id
    const t = newSyncedDb();
    syncedNote(t, idOf(1), 'kept', 5);
    const gone2 = syncedNote(t, idOf(7), 'will be gone (key reused)', 8);   // local id 2: the restored row takes this key
    const gone3 = syncedNote(t, idOf(8), 'will be gone (key free)', 9);     // local id 3
    t.db.execute("INSERT INTO user_note (title, content) VALUES ('t', 'never reached the server')");   // local id 4, no server version
    await restore(t, await backupOf(src), 'replace');

    expect(contents(t)).toEqual(['kept', 'new, never synced']);
    expect(lineAt(t, 'user_note', 1)).toMatchObject({ record_id: idOf(1), server_seq: 5, dirty: 1, deleted: 0 });
    // the restored row that had no id is a new record, whatever used to live at its local id
    expect(lineAt(t, 'user_note', gone2)).toMatchObject({ record_id: null, server_seq: null, hlc: null, base_json: null, dirty: 1, deleted: 0 });
    expect(lineAt(t, 'user_note', gone3)).toMatchObject({ record_id: idOf(8), server_seq: 9, hlc: 'hlc-9', dirty: 1, deleted: 1 });
    const synthetic = lines(t, 'user_note').find((l) => l.record_id === idOf(7))!;
    expect(synthetic.local_key).toBe(`\u001fr:${idOf(7)}`);
    expect(synthetic).toMatchObject({ server_seq: 8, hlc: 'hlc-8', dirty: 1, deleted: 1 });
    // a record the server never saw simply vanishes
    expect(lines(t, 'user_note').map((l) => l.record_id).filter((x) => x !== null).sort()).toEqual([idOf(1), idOf(7), idOf(8)]);
    expect(lines(t, 'user_note')).toHaveLength(4);
  });

  it('a restored record the target has never heard of keeps its id (no server version known)', async () => {
    const src = newSyncedDb();
    syncedNote(src, idOf(5), 'from elsewhere', 3);
    const t = newSyncedDb();
    await restore(t, await backupOf(src), 'replace');
    expect(lineAt(t, 'user_note', 1)).toMatchObject({ record_id: idOf(5), server_seq: null, hlc: null, dirty: 1 });
  });

  it('a record that was already a tombstone comes back to life with its server version when the backup holds it', async () => {
    const src = newSyncedDb();
    syncedNote(src, idOf(1), 'resurrected', 5);
    const t = newSyncedDb();
    const k = syncedNote(t, idOf(1), 'x', 5);
    t.db.execute('DELETE FROM user_note WHERE note_id = ?', [k]);
    await restore(t, await backupOf(src), 'replace');
    expect(lines(t, 'user_note')).toMatchObject([{ record_id: idOf(1), server_seq: 5, dirty: 1, deleted: 0 }]);
  });

  it('a record deleted earlier and still pending stays a tombstone when the backup lacks it', async () => {
    const src = newSyncedDb();
    syncedNote(src, idOf(1), 'only one', 5);
    const t = newSyncedDb();
    syncedNote(t, idOf(1), 'only one', 5);
    const k = syncedNote(t, idOf(2), 'deleted before the restore', 6);
    t.db.execute('DELETE FROM user_note WHERE note_id = ?', [k]);
    await restore(t, await backupOf(src), 'replace');
    expect(lines(t, 'user_note').find((l) => l.record_id === idOf(2))).toMatchObject({ deleted: 1, dirty: 1, server_seq: 6 });
  });

  it('children follow: replacing notes re-attaches links by their own record ids too', async () => {
    const src = newSyncedDb();
    const n = syncedNote(src, idOf(1), 'n', 1);
    src.db.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (?, 1, 1)', [n]);
    src.tracker.markSynced('note_verse_link', '1', { recordId: idOf(10), serverSeq: 2, hlc: 'h2', baseJson: '{}', deleted: false });
    const t = newSyncedDb();
    const tn = syncedNote(t, idOf(1), 'n', 1);
    t.db.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (?, 1, 1)', [tn]);
    t.tracker.markSynced('note_verse_link', '1', { recordId: idOf(10), serverSeq: 2, hlc: 'h2', baseJson: '{}', deleted: false });
    await restore(t, await backupOf(src), 'replace');
    expect(lines(t, 'note_verse_link')).toMatchObject([{ record_id: idOf(10), server_seq: 2, dirty: 1, deleted: 0 }]);
  });

  it('another account (different fingerprint) or a 1.0 file: the old behaviour, the id of the old row at the same key stays', async () => {
    const src = newSyncedDb();
    syncedNote(src, idOf(1), 'from backup', 5);
    const archive = await backupOf(src);
    const t = newSyncedDb({ fp: '1111111111111111' });
    syncedNote(t, idOf(3), 'local', 9);
    await restore(t, archive, 'replace');
    expect(contents(t)).toEqual(['from backup']);
    expect(lineAt(t, 'user_note', 1)).toMatchObject({ record_id: idOf(3), server_seq: 9, dirty: 1 });   // pinned to the old identity of local id 1

    const oldSrc = newSyncedDb({ tracked: false });
    oldSrc.db.execute("INSERT INTO user_note (title, content) VALUES ('t', 'v1.0 file')");
    const t2 = newSyncedDb();
    syncedNote(t2, idOf(3), 'local', 9);
    await restore(t2, await backupOf(oldSrc), 'replace');
    expect(lineAt(t2, 'user_note', 1)).toMatchObject({ record_id: idOf(3), dirty: 1 });
  });

  it('inspecting a backup (preview of both modes) writes nothing', async () => {
    const src = newSyncedDb();
    syncedNote(src, idOf(1), 'a', 1);
    const t = newSyncedDb();
    syncedNote(t, idOf(2), 'b', 2);
    const before = dump(t);
    const plan = inspectBackup(await backupOf(src), { sql: t.db });
    expect(plan.preview?.replace.ok).toBe(true);
    expect(dump(t)).toEqual(before);
    expect(contents(t)).toEqual(['b']);
  });
});

describe('with the sync engine', () => {
  /**
   * A and B hold the same two records numbered the other way round; A also has c (local id 3, synced; C has it too).
   * B's backup holds its two notes plus d at local id 3 (never synced). Replace-restoring it into A leaves A's record c
   * as a tombstone, and its local key 3 is taken by d, so the tombstone gets the synthetic key.
   */
  async function restoredWithSyntheticTombstone() {
    const server = new FakeServer();
    const u = testAccount();
    const A = makeDevice(server, 1, u);
    const B = makeDevice(server, 2, cloneAccount(u));
    const C = makeDevice(server, 3, cloneAccount(u));
    for (const d of [A, B, C]) fixNoteFtsTriggers(d.db);

    addNote(A, 'a-note');
    addNote(B, 'b-note');
    await A.engine.syncNow(); await B.engine.syncNow(); await A.engine.syncNow();
    expect(notes(A).map((n) => n.content)).toEqual(['a-note', 'b-note']);
    const cKey = addNote(A, 'c-note');
    await A.engine.syncNow(); await C.engine.syncNow();
    expect(notes(C).map((n) => n.content).sort()).toEqual(['a-note', 'b-note', 'c-note']);
    const sC = A.tracker.lookupByLocal('user_note', String(cKey))!.recordId!;
    expect(cKey).toBe(3);

    addNote(B, 'd-note');
    const { zip } = await createBackupPayload({ sql: B.db }, wopts(false));
    const archive = await readBackupPayload(once(zip));
    expect(archive.manifest.sync?.idkFp).toBe(A.tracker.state.get('idk_fp'));

    const plan = inspectBackup(archive, { sql: A.db }, { preview: false });
    await applyRestore(plan, { sql: A.db }, { mode: 'replace', sections: defaultSections(plan, 'replace') });
    return { server, A, B, C, sC };
  }

  it('the synthetic-key tombstone is pushed and other devices apply the delete', async () => {
    const { server, A, C, sC } = await restoredWithSyntheticTombstone();
    expect(notes(A).map((n) => n.content).sort()).toEqual(['a-note', 'b-note', 'd-note']);
    expect(A.db.queryOne('SELECT local_key, deleted, dirty FROM sync_record WHERE record_id = ?', [sC]))
      .toEqual({ local_key: `\u001fr:${sC}`, deleted: 1, dirty: 1 });

    await A.engine.syncNow();
    expect(server.rows.get(sC)).toMatchObject({ deleted: true });
    expect(A.tracker.pendingCount()).toBe(0);
    expect(A.db.queryOne('SELECT dirty, deleted, server_seq FROM sync_record WHERE record_id = ?', [sC])).toMatchObject({ dirty: 0, deleted: 1 });

    await C.engine.syncNow();
    expect(notes(C).map((n) => n.content).sort()).toEqual(['a-note', 'b-note', 'd-note']);
  });

  it('a newer remote edit of that record later inserts a fresh local row (regression: SyncEngine.upsertRow on a synthetic key)', async () => {
    const { server, A, C, sC } = await restoredWithSyntheticTombstone();
    await A.engine.syncNow();
    // C still holds c. It edits it (newer than A's delete), then syncs: the edit survives the delete and is pushed.
    const cLocal = C.db.queryOne<{ note_id: number }>("SELECT note_id FROM user_note WHERE content = 'c-note'")!.note_id;
    C.db.execute("UPDATE user_note SET content = 'c-note, edited later' WHERE note_id = ?", [cLocal]);
    C.db.execute('UPDATE sync_record SET changed_ms = ? WHERE table_name = ? AND local_key = ?', [Date.now() + 60_000, 'user_note', String(cLocal)]);
    await C.engine.syncNow();
    expect(server.rows.get(sC)).toMatchObject({ deleted: false });

    await A.engine.syncNow();
    expect(notes(A).map((n) => n.content).sort()).toEqual(['a-note', 'b-note', 'c-note, edited later', 'd-note']);
    const back = A.db.queryOne<{ note_id: number }>("SELECT note_id FROM user_note WHERE content = 'c-note, edited later'")!;
    expect(A.tracker.lookupByLocal('user_note', String(back.note_id))).toEqual({ recordId: sC });
    expect(A.db.queryAll('SELECT local_key FROM sync_record WHERE deleted = 1')).toEqual([]);
    expect(A.tracker.pendingCount()).toBe(0);
  });
});
