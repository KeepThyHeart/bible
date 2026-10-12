import { describe, it, expect } from 'vitest';
import { createBackupPayload, parseManifest, readBackupPayload, sectionRows, FORMAT_VERSION, FORMAT_VERSION_SYNC } from '../../Backup/Payload';
import { USER_TABLES } from '../../Backup/Registry';
import { NATURAL_KEY_TABLES, carriesSyncId, SYNC_ID_COLUMN } from '../../Backup/syncIds';
import { once } from '../../Backup/Streams';
import { DamagedError } from '../../Backup/errors';
import { coreTrackedTables } from '../../Sync/tracking/ChangeTracker';
import { createCoreCodecs } from '../../Sync/codecs/RecordCodec';
import { utf8Encode, utf8Decode } from '../../Crypto';
import { inspectBackup, applyRestore } from '../../Backup/Restore';
import { wopts } from './restoreHelpers';
import { FP, idOf, newSyncedDb, syncedNote } from './syncedDb';

const make = (s: ReturnType<typeof newSyncedDb>) => createBackupPayload({ sql: s.db }, wopts(false));

describe('payload 1.1', () => {
  it('a database that never synced writes 1.0, with no sync key and no sync_id column, whether or not the sync tables exist', async () => {
    const plain = newSyncedDb({ tracked: false });
    const tables = newSyncedDb({ fp: null });
    const never = newSyncedDb({ fp: null });
    for (const s of [plain, tables, never]) {
      s.db.execute("INSERT INTO user_note (title, content) VALUES ('a', 'x')");
      s.db.execute("INSERT INTO collection (name) VALUES ('c')");
    }
    const a = await make(plain);
    const b = await make(tables);
    expect(a.manifest.formatVersion).toBe(FORMAT_VERSION);
    expect(a.manifest.sync).toBeUndefined();
    expect(a.manifest.sections.every((s) => !(s.columns ?? []).includes(SYNC_ID_COLUMN))).toBe(true);
    // Same content, same bytes: the sync tables themselves are never in a backup.
    expect(b.zip).toEqual(a.zip);
    expect(b.manifest).toEqual(a.manifest);
  });

  it('a synced database writes 1.1: minReaderVersion 1.0, the fingerprint, and sync_id as the last column of random-id tables', async () => {
    const s = newSyncedDb();
    const k1 = syncedNote(s, idOf(1), 'one', 3);
    s.db.execute("INSERT INTO user_note (title, content) VALUES ('fresh', 'never synced')");   // line exists, no record id yet
    const doomed = syncedNote(s, idOf(3), 'gone', 4);
    s.db.execute('DELETE FROM user_note WHERE note_id = ?', [doomed]);                           // tombstone: not exported
    s.db.execute("INSERT INTO user_data_item (owner_uuid, collection, item_key, value) VALUES ('', 'c', 'k', 'v')");
    const { manifest, zip } = await make(s);
    expect(manifest.formatVersion).toBe(FORMAT_VERSION_SYNC);
    expect(manifest.formatVersion).toBe('1.1');
    expect(manifest.minReaderVersion).toBe('1.0');
    expect(manifest.sync).toEqual({ idkFp: FP });

    const archive = await readBackupPayload(once(zip));
    const notes = archive.sections.find((x) => x.id === 'user.user_note')!;
    expect(notes.columns!.at(-1)).toBe(SYNC_ID_COLUMN);
    const rows = sectionRows(archive, notes);
    expect(rows.map((r) => [r.note_id, r.sync_id])).toEqual([[k1, idOf(1)], [2, null]]);

    // natural-key tables (record ids derived from content) carry none
    const item = archive.sections.find((x) => x.id === 'user.user_data_item')!;
    expect(item.columns).not.toContain(SYNC_ID_COLUMN);
    // tables the tracker does not track (workspace, history) carry none
    for (const sec of archive.sections) {
      if (sec.kind === 'table' && ['workspace', 'history'].includes(String(sec.class))) expect(sec.columns).not.toContain(SYNC_ID_COLUMN);
    }
  });

  it('every random-id content table carries sync_id, every natural-key table does not (kept equal to the Sync codecs)', () => {
    const codecs = new Map(createCoreCodecs().map((c) => [c.kind, c]));
    const tracked = coreTrackedTables().filter((t) => t.kind !== 'ext.kv');
    const natural = new Set(tracked.filter((t) => codecs.get(t.kind)?.naturalKey !== undefined).map((t) => t.kind));
    expect([...natural].sort()).toEqual([...NATURAL_KEY_TABLES].sort());
    for (const t of tracked) {
      const spec = USER_TABLES.find((x) => x.name === t.table)!;
      expect(carriesSyncId(spec), t.table).toBe(spec.cls === 'content' && spec.autoId && !natural.has(t.kind));
    }
    // and the registry's content tables are all tracked
    for (const spec of USER_TABLES.filter((x) => x.cls === 'content')) expect(tracked.some((t) => t.table === spec.name), spec.name).toBe(true);
  });

  it('the manifest check: a malformed sync block is damage; unknown keys inside it are ignored', async () => {
    const s = newSyncedDb();
    syncedNote(s, idOf(1), 'one', 1);
    const { manifest } = await make(s);
    const enc = (m: unknown) => utf8Encode(JSON.stringify(m));
    for (const bad of [{ idkFp: 'XYZ' }, {}, { idkFp: 5 }, 'x', [], null]) {
      expect(() => parseManifest(enc({ ...manifest, sync: bad }))).toThrow(DamagedError);
    }
    expect(parseManifest(enc({ ...manifest, sync: { idkFp: FP, future: 1 } })).sync?.idkFp).toBe(FP);
    expect(utf8Decode(enc(manifest))).toContain('"sync"');
  });

  it('a 1.0-style target (no sync tables) restores a 1.1 file and does not report sync_id as a dropped column', async () => {
    const src = newSyncedDb();
    syncedNote(src, idOf(1), 'one', 1);
    const { zip } = await make(src);
    const archive = await readBackupPayload(once(zip));
    const target = newSyncedDb({ tracked: false });
    const plan = inspectBackup(archive, { sql: target.db });
    expect(plan.sections.find((x) => x.id === 'user.user_note')!.droppedColumns).toEqual([]);
    expect(plan.warnings.filter((w) => w.code === 'columnsDropped')).toEqual([]);
    const report = await applyRestore(plan, { sql: target.db }, { mode: 'merge', sections: plan.sections.filter((x) => x.defaultOn.merge).map((x) => x.id) });
    expect(report.droppedColumns.filter((d) => d.column === SYNC_ID_COLUMN)).toEqual([]);
    expect(target.db.queryAll('SELECT content FROM user_note')).toEqual([{ content: 'one' }]);
  });
});
