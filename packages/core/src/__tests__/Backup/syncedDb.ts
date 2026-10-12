/** Test helpers: a user database with the sync tracker installed, as a signed-in device has it. */
import { TestSqliteProvider } from '../helpers/TestSqliteProvider';
import { createUserSchema } from '../../Data/UserSchema';
import { createChangeTracker, coreTrackedTables } from '../../Sync/tracking/ChangeTracker';
import type { ChangeTracker } from '../../Sync/tracking/ChangeTracker';
import { fixNoteFtsTriggers } from './../Sync/engine/harness';

export const FP = 'ab12cd34ef567890';
export const idOf = (n: number): string => n.toString(16).padStart(32, '0');

export interface SyncedDb { db: TestSqliteProvider; tracker: ChangeTracker }

/** A core user DB; `fp` undefined = never synced (tables exist, no idk_fp); `tracked` false = no sync tables at all. */
export function newSyncedDb(opts: { fp?: string | null; tracked?: boolean } = {}): SyncedDb {
  const db = new TestSqliteProvider(':memory:');
  createUserSchema(db);
  fixNoteFtsTriggers(db);
  const tracker = createChangeTracker(db);
  if (opts.tracked !== false) {
    tracker.install(coreTrackedTables());
    if (opts.fp !== null) tracker.state.set('idk_fp', opts.fp ?? FP);
  }
  return { db, tracker };
}

/** Insert a note, give it record id `id` and mark it synced at server seq `seq` (clean, not dirty). */
export function syncedNote(s: SyncedDb, id: string, content: string, seq: number, title = 't'): number {
  const key = s.db.execute('INSERT INTO user_note (title, content) VALUES (?, ?)', [title, content]).lastInsertRowId!;
  s.tracker.markSynced('user_note', String(key), { recordId: id, serverSeq: seq, hlc: `hlc-${seq}`, baseJson: JSON.stringify({ content }), deleted: false });
  return key;
}

export interface RecordLine {
  table_name: string; local_key: string; record_id: string | null; server_seq: number | null; hlc: string | null;
  dirty: number; deleted: number; base_json: string | null;
}
export function lines(s: SyncedDb, table: string): RecordLine[] {
  return s.db.queryAll<RecordLine>(
    'SELECT table_name, local_key, record_id, server_seq, hlc, dirty, deleted, base_json FROM sync_record WHERE table_name = ? ORDER BY local_key', [table]);
}
export const lineAt = (s: SyncedDb, table: string, key: number | string): RecordLine | undefined =>
  lines(s, table).find((l) => l.local_key === String(key));
export const markAllClean = (s: SyncedDb): void => { s.db.execute('UPDATE sync_record SET dirty = 0 WHERE deleted = 0'); };
