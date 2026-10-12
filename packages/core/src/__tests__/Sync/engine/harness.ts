/**
 * Engine test harness (task 0150 W3-A): an in-memory server that follows the contracts §7 rules, and "devices" that
 * each own a real user DB (better-sqlite3), tracker, codecs, cipher and engine.
 */
import { b64urlDecode, deterministicRandom, hexEncode, type RandomSource } from '../../../Crypto';
import { TestSqliteProvider } from '../../helpers/TestSqliteProvider';
import { createUserSchema } from '../../../Data/UserSchema';
import { createChangeTracker, coreTrackedTables, type ChangeTracker } from '../../../Sync/tracking/ChangeTracker';
import { createHlc, type HlcClock } from '../../../Sync/tracking/Hlc';
import { createCodecRegistry, createCoreCodecs } from '../../../Sync/codecs/RecordCodec';
import { createRecordCipher, type RecordCipher } from '../../../Sync/crypto/RecordCipher';
import type { UnlockedAccount } from '../../../Sync/crypto/keys';
import { LIMITS, type PushRecord } from '../../../Sync/api';
import type { EncryptedRecord, RecordId } from '../../../Sync/types';
import { SyncHttpError, type ISyncTransport } from '../../../Sync/engine/ISyncTransport';
import { createSyncStatusStore, type SyncStatusStore } from '../../../Sync/engine/SyncStatus';
import { SyncEngine, type SyncEngineOptions, type SyncTimers } from '../../../Sync/engine/SyncEngine';
import { mulberry32, moduleResolver } from '../codecs/harness';

export interface ServerRow { seq: number; deleted: boolean; blob: Uint8Array | null }

/**
 * In-memory server with the contracts §7 rules: seq per account, baseSeq rule, tombstones kept, conflicts. Since 0150
 * R1 a tombstone push must carry its sealed tombstone blob (400 otherwise), which is stored and served back.
 */
export class FakeServer {
  readonly rows = new Map<RecordId, ServerRow>();
  seq = 0;
  pullCalls = 0;
  readonly pushCalls: PushRecord[][] = [];
  /** Runs before a push is processed (simulate local edits in flight). */
  beforePush?: (records: PushRecord[]) => void | Promise<void>;
  /** Return an error to throw instead of answering. */
  failPull?: () => Error | undefined;
  failPush?: (records: PushRecord[]) => Error | undefined;
  /** Ids whose stored version is re-stored under a new seq before every push (forces a conflict each time). */
  readonly bumpOnPush = new Set<RecordId>();
  /** 413 too_large when a record's blob exceeds this many bytes (the whole push is rejected, like the real server). */
  maxRecordBytes: number = LIMITS.maxRecordBytes;

  /** Another client (or a hostile server, with `deleted` and a null blob) wrote this version. */
  put(id: RecordId, blob: Uint8Array | null, deleted = false): number {
    this.rows.set(id, { seq: ++this.seq, deleted, blob });
    return this.seq;
  }

  /** "Start over": every record is wiped (seqs restart, like a re-created account). */
  wipe(): void {
    this.rows.clear();
    this.seq = 0;
  }

  transport(): ISyncTransport {
    return {
      pull: async (since, limit, signal) => {
        this.pullCalls++;
        await Promise.resolve();
        if (signal?.aborted) throw signal.reason;
        const err = this.failPull?.();
        if (err) throw err;
        const all = [...this.rows.entries()].filter(([, r]) => r.seq > since).sort((a, b) => a[1].seq - b[1].seq);
        const page = all.slice(0, limit);
        const records: EncryptedRecord[] = page.map(([id, r]) => ({ id, seq: r.seq, deleted: r.deleted, blob: r.blob ? r.blob.slice() : null }));
        return { records, next: records.length > 0 ? records[records.length - 1].seq : since, more: all.length > limit };
      },
      push: async (records, signal) => {
        this.pushCalls.push(records.map((r) => ({ ...r })));
        await this.beforePush?.(records);
        if (signal?.aborted) throw signal.reason;
        const err = this.failPush?.(records);
        if (err) throw err;
        if (records.length > LIMITS.maxPushRecords) throw new SyncHttpError(413, { error: 'too_large' });
        if (JSON.stringify({ records }).length > LIMITS.maxPushBodyBytes) throw new SyncHttpError(413, { error: 'too_large' });
        for (const r of records) {
          if (r.blob === null) throw new SyncHttpError(400, { error: 'bad_request', message: 'Every record needs a blob' });
          if (b64urlDecode(r.blob).length > this.maxRecordBytes) throw new SyncHttpError(413, { error: 'too_large', message: 'Record too large' });
        }
        const accepted: Array<{ id: RecordId; seq: number }> = [];
        const conflicts: Array<{ id: RecordId; current: EncryptedRecord }> = [];
        for (const r of records) {
          const bumped = this.rows.get(r.id);
          if (bumped && this.bumpOnPush.has(r.id)) bumped.seq = ++this.seq;
          const cur = this.rows.get(r.id);
          const ok = cur ? cur.seq === r.baseSeq : r.baseSeq === null;
          if (!ok) {
            conflicts.push({ id: r.id, current: cur
              ? { id: r.id, seq: cur.seq, deleted: cur.deleted, blob: cur.blob ? cur.blob.slice() : null }
              : { id: r.id, seq: 0, deleted: true, blob: null } });
            continue;
          }
          const seq = ++this.seq;
          this.rows.set(r.id, { seq, deleted: r.deleted, blob: b64urlDecode(r.blob!) });
          accepted.push({ id: r.id, seq });
        }
        return { accepted, conflicts };
      },
    };
  }
}

/** Seeded RandomSource with good spread (deterministicRandom repeats after 256 bytes, so ids could collide across devices). */
export function seededRandom(seed: number): RandomSource {
  const rng = mulberry32(seed);
  return { bytes: (n) => Uint8Array.from({ length: n }, () => Math.floor(rng() * 256)) };
}

export function testAccount(): UnlockedAccount {
  const r = seededRandom(424242);
  return {
    accountId: hexEncode(r.bytes(16)), accountKey: r.bytes(32), recordIdKey: r.bytes(32),
    dataKeys: new Map([[1, r.bytes(32)]]), currentEpoch: 1,
  };
}

/** A different account (new account id, record-id key and data key), e.g. after "start over". */
export function otherAccount(seed: number): UnlockedAccount {
  const r = seededRandom(seed);
  return {
    accountId: hexEncode(r.bytes(16)), accountKey: r.bytes(32), recordIdKey: r.bytes(32),
    dataKeys: new Map([[0, r.bytes(32)]]), currentEpoch: 0,
  };
}

/** Same keys, own copies (so a test can rotate one device's view of the account). */
export function cloneAccount(u: UnlockedAccount): UnlockedAccount {
  return { ...u, dataKeys: new Map([...u.dataKeys].map(([e, k]) => [e, k.slice()])) };
}

export class FakeTimers implements SyncTimers {
  private t = 0;
  private nextId = 1;
  private readonly q = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.q.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown): void { this.q.delete(h as number); }
  get pending(): number { return this.q.size; }
  advance(ms: number): void {
    this.t += ms;
    for (const [id, e] of [...this.q].sort((a, b) => a[1].at - b[1].at)) {
      if (e.at <= this.t) { this.q.delete(id); e.fn(); }
    }
  }
}

export interface Device {
  db: TestSqliteProvider; tracker: ChangeTracker; cipher: RecordCipher; hlc: HlcClock; status: SyncStatusStore;
  engine: SyncEngine; unlocked: UnlockedAccount; timers: FakeTimers;
}

/**
 * `Data/UserSchema/ddl.ts` updates and deletes the external-content `user_note_fts` with plain UPDATE/DELETE, which
 * makes FTS5 read the (already changed) content row and corrupts the index ("database disk image is malformed" on
 * e.g. 'base' -> 'from A'), with or without sync. The desktop `UserDatabase.sql` uses the correct 'delete' command;
 * use that form here until the schema is fixed (reported to the coordinator).
 */
export function fixNoteFtsTriggers(db: TestSqliteProvider): void {
  db.exec(`
    DROP TRIGGER IF EXISTS user_note_fts_update;
    DROP TRIGGER IF EXISTS user_note_fts_delete;
    CREATE TRIGGER user_note_fts_update AFTER UPDATE ON user_note BEGIN
      INSERT INTO user_note_fts(user_note_fts, rowid, note_id, title, content, tags)
      VALUES ('delete', old.note_id, old.note_id, old.title, old.content, old.tags);
      INSERT INTO user_note_fts(rowid, note_id, title, content, tags)
      VALUES (new.note_id, new.note_id, new.title, new.content, new.tags);
    END;
    CREATE TRIGGER user_note_fts_delete AFTER DELETE ON user_note BEGIN
      INSERT INTO user_note_fts(user_note_fts, rowid, note_id, title, content, tags)
      VALUES ('delete', old.note_id, old.note_id, old.title, old.content, old.tags);
    END;`);
}

export const MODULES = moduleResolver({ 1: 'KJV', 2: 'ESV' });

export function makeDevice(server: FakeServer, n: number, u: UnlockedAccount = testAccount(),
  extra: Partial<SyncEngineOptions> = {}): Device {
  const db = new TestSqliteProvider(':memory:');
  createUserSchema(db);
  const tracker = createChangeTracker(db);
  tracker.install(coreTrackedTables());
  const dev = (n.toString(16).repeat(16)).slice(0, 16);
  tracker.state.set('device_id', dev);
  const hlc = createHlc(dev);
  const cipher = createRecordCipher(u, deterministicRandom(n));
  const status = createSyncStatusStore({ state: 'idle' });
  const timers = new FakeTimers();
  const engine = new SyncEngine({
    sql: db, tracker, codecs: createCodecRegistry(createCoreCodecs({ extKvSyncs: () => true })), cipher, transport: server.transport(), unlocked: u,
    hlc, status, modules: MODULES, random: seededRandom(1000 + n), timers, ...extra,
  });
  return { db, tracker, cipher, hlc, status, engine, unlocked: u, timers };
}

/** A new engine on an existing device's DB (an app restart, or a new sign-in), possibly under another account. */
export function reopenDevice(server: FakeServer, d: Device, n: number, u: UnlockedAccount,
  extra: Partial<SyncEngineOptions> = {}): Device {
  const dev = (n.toString(16).repeat(16)).slice(0, 16);
  const hlc = createHlc(dev);
  const cipher = createRecordCipher(u, deterministicRandom(n + 100));
  const status = createSyncStatusStore({ state: 'idle' });
  const engine = new SyncEngine({
    sql: d.db, tracker: d.tracker, codecs: createCodecRegistry(createCoreCodecs({ extKvSyncs: () => true })), cipher, transport: server.transport(),
    unlocked: u, hlc, status, modules: MODULES, random: seededRandom(2000 + n), timers: d.timers, ...extra,
  });
  return { ...d, cipher, hlc, status, engine, unlocked: u };
}

export function addNote(d: Device, content: string, title = 't'): number {
  return d.db.execute('INSERT INTO user_note (title, content) VALUES (?, ?)', [title, content]).lastInsertRowId!;
}

export function notes(d: Device): Array<{ note_id: number; title: string; content: string; metadata: string | null }> {
  return d.db.queryAll('SELECT note_id, title, content, metadata FROM user_note ORDER BY content');
}

/** Pin the local change time of a row (deterministic LWW between devices). */
export function setChangedMs(d: Device, kind: string, key: string | number, ms: number): void {
  d.db.execute('UPDATE sync_record SET changed_ms = ? WHERE table_name = ? AND local_key = ?', [ms, kind, String(key)]);
}

export function recordIdOf(d: Device, kind: string, key: string | number): string {
  return d.tracker.lookupByLocal(kind, String(key))!.recordId!;
}
