/**
 * Sync engine (contracts 0063 §8; task 0150 W3-A). Browser-safe: no Node imports, nothing runs at module load,
 * timers and the clock are injectable.
 *
 * One run (`syncNow`) = pull -> merge -> push:
 *
 * 0. Once per engine instance: the account check (0150 R1 H2/M4). sync_state keeps `account_id`, `idk_fp` (first 8
 *    bytes of HMAC-SHA256(recordIdKey, "fp"), hex) and `epoch_max`. A different account id or record-id key (another
 *    account, or "start over" on any device), or none stored while rows carry server state, runs
 *    `tracker.resetForNewAccount` in one transaction: every local record is re-uploaded under the new keys, derived ids
 *    are re-derived, cursor 0. The same account offering fewer key epochs than `epoch_max` is refused (status error
 *    'crypto'; the run stops before any request).
 * 1. Pull pages from `cursor` (sync_state). A page must have strictly increasing seqs above the cursor and `next` equal
 *    to its last seq (or the cursor when empty); anything else is a SyncResponseError (R1 L15). Each record is
 *    decrypted outside SQL; then the page is applied in ONE
 *    transaction under `tracker.applyRemote` (triggers off), each record in its own savepoint, together with the
 *    pending-children retry and the cursor update. Adapter hooks (`conflictCopy`, `afterApply`) and `onApplied` run
 *    after the commit.
 *    - Opaque (kept in sync_opaque, never deleted, never pushed, local rows untouched): unknown blob version or epoch,
 *      undecryptable (AuthError) or bad JSON, unknown record type, a codec version (`cv`) above ours, a payload the
 *      codec rejects (RecordDecodeError), or any unexpected error while applying that one record. Opaque records are
 *      retried once per engine instance (first run), so an app upgrade, an installed extension or a new key epoch
 *      picks them up. A tombstone for an opaque record removes it.
 *    - Tombstones (0150 R1 H1) are SEALED: the blob opens to `{ t, cv, h, dev, d: {}, del: true }`. Only such a blob
 *      deletes anything; a tombstone with no blob (or one that does not open, or whose sealed content is a live
 *      version) is kept opaque like any unreadable record, so a server cannot delete user data. A delete that cannot
 *      be applied now (the codec's remove throws) waits in sync_pending and is retried (R1 L4).
 *    - Already seen (seq <= the row's server_seq, e.g. our own push coming back): skipped.
 *    - Replay (a known record, live or deleted, whose incoming HLC (live or tombstone) is older than or equal to the
 *      version we hold): content ignored, only the seq is recorded as the new base (so our next push is not a conflict
 *      loop). A deleted record is therefore resurrected only by a version newer than its tombstone (R1 M3).
 *    - Clean local row (or no local row): apply remote (codec decode + upsert, or remove for a tombstone).
 *    - Dirty local row: `mergeOutcomeFor(type, local, remote, base, { recordId })`, where `local.h` is the HLC of the
 *      local change (see `localHlc`) and a remote tombstone is `{ d: {}, h: <its sealed HLC>, deleted: true }`. takeRemote applies
 *      remote; keepLocal records the remote seq/HLC as base and leaves the row dirty; merged writes `d` locally and
 *      leaves the row dirty on top of the remote base (pushed with an HLC above both); conflictCopy inserts `copy` as
 *      a new record of the same type (fresh random id, via `codec.upsert` + `tracker.touch`, or via the adapter's
 *      `conflictCopy` hook after commit) and resolves the winner as above.
 *    - Children whose parents have not arrived (or whose Bible module is not installed) wait in sync_pending and are
 *      retried after every page.
 * 2. Push: `adapter.collect()`, then derived record ids are assigned to natural-key rows (deriveRecordId with
 *    `unlocked.recordIdKey`, before pulling too, so two devices creating the same natural key meet on one id), then
 *    dirty rows are encoded, sealed and pushed in batches bounded by LIMITS (500 records, 8 MiB body). Accepted ->
 *    `markSynced(..., { expectRev })`: a row edited while its push was in flight stays dirty and is pushed by the next
 *    run with the new base. Conflicts are handled exactly like pulled records and retried, at most 3 more times per
 *    record and run. A 413 (too_large / quota_exceeded) splits the batch until the failing record is alone; that record
 *    is marked failed for this engine instance (until it changes again) and the others continue.
 * 3. Status: 'syncing' while running; then 'idle' (+ lastSyncedAt), 'error' (+ error), 'offline' (network failure;
 *    pending counts kept), or 'locked' (401; the engine then refuses to run until a new one is built). 403
 *    email_unverified stops pushing for the run with that error code.
 *
 * Nonce budget: once `cipher.sealsThisEpoch` reaches 2^30 the engine stops sealing live records (tombstones, which are
 * tiny and rare, are still sealed and go out), sets status error `crypto` and calls `onNeedNewEpoch` once; the host
 * rotates the data key (new epoch) and calls `reencryptAll()` (or builds a new engine with the new cipher). The
 * counter is per cipher instance (per session), not persisted: the real bound is the global one for random 96-bit
 * GCM nonces (stay far below ~2^32 seals per key), which this per-session limit keeps in practice (R1 L6).
 *
 * Where the tracker API has no operation for it, the engine writes the tracker's own `sync_record` table directly:
 * forgetting a record the server no longer has, taking over a derived id held by an old tombstone, and marking every
 * synced record dirty for `reencryptAll`. Nothing here logs; errors put in the status never contain record content.
 *
 * Foreign keys resolve through `CodecContext.localKeyFor(id, expectedKind)`: a reference to a record of another kind
 * is a RecordDecodeError (the record is kept opaque), never a link to the wrong table (R1 L5).
 */
import type { ISql } from '../../Data/Core/ISql';
import type { Row } from '../../Backup/Registry';
import { b64urlEncode, defaultRandom, hexEncode, utf8Encode, type RandomSource } from '../../Crypto';
import { LIMITS, type ApiErrorCode, type PushRecord } from '../api';
import type { ChangeTracker } from '../tracking/ChangeTracker';
import { compareHlc, parseHlc, type HlcClock } from '../tracking/Hlc';
import type { CodecContext, CodecRegistry, ModuleRefResolver, RecordCodec } from '../codecs/RecordCodec';
import { RecordDecodeError } from '../codecs/errors';
import { RecordTooLargeError, type RecordCipher } from '../crypto/RecordCipher';
import { hmacSha256 } from '../crypto/hmac';
import { deriveRecordId, maxEpoch, type UnlockedAccount } from '../crypto/keys';
import { mergeOutcomeFor, type ExtDbMerge, type Version } from '../merge/MergePolicy';
import type { DeviceId, EncryptedRecord, HlcString, RecordId, RecordPlaintext } from '../types';
import { SyncHttpError, SyncNetworkError, SyncResponseError, type ISyncTransport } from './ISyncTransport';
import type { SyncStatus, SyncStatusStore } from './SyncStatus';

/** Local key prefix of a tombstone with no local row (backup restore, Backup/syncIds.ts). U+001F never occurs in a real key. */
const SYNTHETIC_KEY_PREFIX = '\u001fr:';

export interface SyncTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ChangedRow { kind: string; localKey: string; deleted: boolean }

export interface SyncEngineOptions {
  sql: ISql; tracker: ChangeTracker; codecs: CodecRegistry; cipher: RecordCipher; transport: ISyncTransport;
  unlocked: UnlockedAccount; hlc: HlcClock; status: SyncStatusStore; modules: ModuleRefResolver;
  /** Extra sources that are not rows of `sql` (desktop .bn files, extension DBs). */
  adapters?: SyncAdapter[];
  now?: () => number; pageSize?: number;           // default 500
  /** Record ids for new records (default: crypto random). Tests pass a seeded source. */
  random?: RandomSource;
  /** Debounce timers for `notifyLocalChange` (default: the global setTimeout / clearTimeout, looked up lazily). */
  timers?: SyncTimers;
  /** Default 5000. */
  debounceMs?: number;
  /** Called once when the seal counter reaches 2^30 under the current epoch: rotate the data key, then `reencryptAll()`. */
  onNeedNewEpoch?: () => void;
  /** Called after each committed batch of remote changes (UI refresh). Never throws into the engine. */
  onApplied?: (changed: ChangedRow[]) => void;
  /** Lower the push limits (tests); values above LIMITS are clamped to LIMITS. */
  pushLimits?: { maxRecords?: number; maxBodyBytes?: number };
}
export interface SyncAdapter {
  kind: string;                                    // e.g. 'bn.file', 'ext.db:<ext>/<db>/<table>'
  codec: RecordCodec;
  /** Called before each push to let the adapter mark its own dirty rows (e.g. scan .bn mtimes). */
  collect?(): Promise<void>;
  /** Called after applyRemote committed, outside the SQL transaction (file writes, extension events). */
  afterApply?(changed: Array<{ kind: string; localKey: string; deleted: boolean }>): Promise<void>;
  /** Save a conflict's losing side as a new item (after commit); returns its local key. Without it the engine uses codec.upsert. */
  conflictCopy?(localKey: string, copy: Record<string, unknown>): string;
  /** `ext.db` tables: the declared merge mode (default 'lww'). */
  merge?: ExtDbMerge;
}
/** `conflicts` counts merges (a dirty local row met a changed server version); `opaque` counts records kept opaque this run. */
export interface SyncResult { pulled: number; pushed: number; conflicts: number; conflictCopies: number; opaque: number }
export interface SyncScheduler { every(ms: number, fn: () => void): () => void; onOnline(fn: () => void): () => void }

export const SYNC_INTERVAL_MS = 5 * 60 * 1000;
export const DEBOUNCE_MS = 5000;
export const MAX_CONFLICT_RETRIES = 3;
/** Seals per data-key epoch before the engine asks for a new epoch (random 96-bit nonces). */
export const SEAL_LIMIT = 2 ** 30;

// --- internals -------------------------------------------------------------------------------------------------

interface SyncRow {
  table_name: string; local_key: string; record_id: string | null; changed_ms: number; rev: number; hlc: string | null;
  server_seq: number | null; dirty: number; deleted: number; base_json: string | null;
}

/** A decrypted incoming version: live content, or a sealed tombstone (`pt.del === true`, `pt.d` = {}). */
type Incoming = { kind: 'live' | 'tombstone'; pt: RecordPlaintext };
const incomingOf = (pt: RecordPlaintext): Incoming => ({ kind: pt.del === true ? 'tombstone' : 'live', pt });

/** The same account offered fewer key epochs than this DB has already seen (rollback to an old key). */
class EpochRollbackError extends Error {
  constructor() { super('Key epoch rollback'); this.name = 'EpochRollbackError'; }
}

/** A natural-key parent has no record id yet (it is derived asynchronously before pull and push). */
class NeedParentIdError extends Error {
  constructor() { super('Parent record id not derived yet'); this.name = 'NeedParentIdError'; }
}

/** Effects of applying one record, merged into the run only when its savepoint commits. */
interface Effects {
  changed: ChangedRow[];
  copies: Array<{ adapter: SyncAdapter; localKey: string; copy: Record<string, unknown> }>;
  conflicts: number; conflictCopies: number; applied: number; opaque: number;
  /** Rows to leave out of this run's push (waiting for a parent, or unmergeable). */
  defer: string[];
}
const noEffects = (): Effects => ({ changed: [], copies: [], conflicts: 0, conflictCopies: 0, applied: 0, opaque: 0, defer: [] });

interface Run {
  signal: AbortSignal;
  result: SyncResult;
  changed: ChangedRow[];
  copies: Effects['copies'];
  defer: Set<string>;
  error?: SyncStatus['error'];
}

const US = '\u001f';
const keyOf = (kind: string, localKey: string): string => kind + US + localKey;
const MAX_HLC_MS = 0xffffffffffff;

function formatHlc(ms: number, counter: number, dev: DeviceId): HlcString {
  if (counter > 0xffff) { ms += 1; counter = 0; }
  ms = Math.min(Math.max(0, Math.floor(ms)), MAX_HLC_MS);
  return `${ms.toString(16).padStart(12, '0')}:${counter.toString(16).padStart(4, '0')}:${dev}`;
}
function tryParseHlc(h: string | null): { ms: number; counter: number } | null {
  if (!h) return null;
  try { return parseHlc(h); } catch { return null; }
}
const maxHlc = (a: HlcString, b: HlcString): HlcString => (compareHlc(a, b) >= 0 ? a : b);

class AbortRun extends Error {
  constructor() { super('Sync aborted'); this.name = 'AbortError'; }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export class SyncEngine {
  private readonly sql: ISql;
  private readonly tracker: ChangeTracker;
  private readonly kinds = new Map<string, { codec: RecordCodec; adapter?: SyncAdapter }>();
  private readonly types = new Map<string, Array<{ codec: RecordCodec; kind: string }>>();
  private readonly random: RandomSource;
  private readonly now: () => number;
  private readonly dev: DeviceId;
  private readonly pageSize: number;
  private readonly maxPushRecords: number;
  private readonly maxPushBytes: number;
  private readonly ctx: CodecContext;

  private running: Promise<SyncResult> | null = null;
  private again = false;
  private debounceHandle: unknown = undefined;
  private unsubs: Array<() => void> = [];
  private stopController: AbortController | null = null;
  private locked = false;
  private opaqueRetried = false;
  private identityChecked = false;
  private epochWarned = false;
  /** Rows that failed for good this session (too large, over quota, unmergeable): key -> rev when it failed. */
  private readonly failed = new Map<string, number>();
  /** Rows that do not encode (not syncable) and were never on the server: key -> rev. */
  private readonly unsyncable = new Map<string, number>();

  constructor(private readonly o: SyncEngineOptions) {
    this.sql = o.sql;
    this.tracker = o.tracker;
    this.random = o.random ?? defaultRandom;
    this.now = o.now ?? (() => Date.now());
    this.dev = parseHlc(o.hlc.last).deviceId;
    this.pageSize = Math.max(1, Math.min(o.pageSize ?? 500, LIMITS.maxPullLimit));
    this.maxPushRecords = Math.max(1, Math.min(o.pushLimits?.maxRecords ?? LIMITS.maxPushRecords, LIMITS.maxPushRecords));
    this.maxPushBytes = Math.max(1024, Math.min(o.pushLimits?.maxBodyBytes ?? LIMITS.maxPushBodyBytes, LIMITS.maxPushBodyBytes));
    for (const codec of o.codecs.all()) this.register(codec.kind, codec);
    for (const a of o.adapters ?? []) this.register(a.kind, a.codec, a);
    this.ctx = this.makeContext();
  }

  private register(kind: string, codec: RecordCodec, adapter?: SyncAdapter): void {
    this.kinds.set(kind, { codec, adapter });
    const list = this.types.get(codec.type) ?? [];
    list.push({ codec, kind });
    this.types.set(codec.type, list);
  }

  // --- public API ----------------------------------------------------------------------------------------------

  /** pull -> merge -> push; retries conflicts up to 3 times; single-flight (concurrent calls share one run). */
  syncNow(signal?: AbortSignal): Promise<SyncResult> {
    if (this.running) return this.running;
    const p = this.run(signal).finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.syncNow();
      }
    });
    this.running = p;
    return p;
  }

  /** Called after a local edit; debounced 5 s. */
  notifyLocalChange(): void {
    this.refreshCounts();
    const t = this.timers();
    if (this.debounceHandle !== undefined) t.clearTimeout(this.debounceHandle);
    this.debounceHandle = t.setTimeout(() => {
      this.debounceHandle = undefined;
      if (this.running) this.again = true;
      else void this.syncNow();
    }, this.o.debounceMs ?? DEBOUNCE_MS);
  }

  /** Start/stop the 5 min timer + online/visibility hooks supplied by the host. Starting also syncs once. */
  start(scheduler: SyncScheduler): void {
    this.stop();
    const kick = (): void => { void this.syncNow(); };
    this.unsubs = [scheduler.every(SYNC_INTERVAL_MS, kick), scheduler.onOnline(kick)];
    kick();
  }

  stop(): void {
    for (const u of this.unsubs) {
      try { u(); } catch { /* host callback */ }
    }
    this.unsubs = [];
    if (this.debounceHandle !== undefined) this.timers().clearTimeout(this.debounceHandle);
    this.debounceHandle = undefined;
    this.again = false;
    this.stopController?.abort();
  }

  /**
   * After a key rotation (new data-key epoch in `unlocked` / the cipher): mark every synced live record dirty, so the
   * next push re-seals it under the current epoch, and sync. Content and HLC order are unchanged (a re-sealed record
   * carries an HLC just above its previous one). Opaque records are left untouched.
   */
  async reencryptAll(signal?: AbortSignal): Promise<SyncResult> {
    if (this.running) await this.running;
    this.epochWarned = false;
    this.sql.execute(
      'UPDATE sync_record SET dirty = 1, rev = rev + 1 WHERE dirty = 0 AND deleted = 0 AND server_seq IS NOT NULL');
    this.failed.clear();
    return this.syncNow(signal);
  }

  // --- run -----------------------------------------------------------------------------------------------------

  private timers(): SyncTimers {
    return this.o.timers ?? {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
    };
  }

  private async run(external?: AbortSignal): Promise<SyncResult> {
    const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, conflictCopies: 0, opaque: 0 };
    if (this.locked) return result;
    const controller = new AbortController();
    this.stopController = controller;
    const onAbort = (): void => controller.abort();
    if (external?.aborted) controller.abort();
    external?.addEventListener('abort', onAbort);
    const run: Run = { signal: controller.signal, result, changed: [], copies: [], defer: new Set() };
    const status = this.o.status;
    status.set({ state: 'syncing' });
    try {
      if (!this.identityChecked) await this.checkAccount();
      await this.ensureDerivedIds(run);
      if (!this.opaqueRetried) {
        this.opaqueRetried = true;
        await this.retryOpaque(run);
      }
      await this.pull(run);
      await this.push(run);
      this.finish(run.error ? { state: 'error', error: run.error } : { state: 'idle', error: undefined });
      status.set({ lastSyncedAt: new Date(this.now()).toISOString() });
    } catch (e) {
      this.finish(this.statusForError(e));
    } finally {
      external?.removeEventListener('abort', onAbort);
      if (this.stopController === controller) this.stopController = null;
    }
    return result;
  }

  private finish(patch: Partial<SyncStatus>): void {
    try { this.tracker.state.set('hlc_last', this.o.hlc.last); } catch { /* tracker gone (signed out mid-run) */ }
    this.o.status.set({ ...patch, ...this.counts() });
  }

  private statusForError(e: unknown): Partial<SyncStatus> {
    if (e instanceof AbortRun || (e instanceof Error && e.name === 'AbortError')) {
      return { state: 'idle' };
    }
    if (e instanceof SyncNetworkError) return { state: 'offline', error: undefined };
    if (e instanceof SyncHttpError) {
      if (e.status === 401) {
        this.locked = true;
        return { state: 'locked', error: { code: 'unauthorized', message: 'Signed out by the server; sign in again' } };
      }
      return { state: 'error', error: { code: e.body?.error ?? (e.status >= 500 ? 'server_error' : 'bad_request'), message: httpMessage(e) } };
    }
    if (e instanceof SyncResponseError) return { state: 'error', error: { code: 'server_error', message: e.message } };
    if (e instanceof EpochRollbackError) {
      return { state: 'error', error: { code: 'crypto', message: 'The server offered older keys than this device has seen; sign in again' } };
    }
    return { state: 'error', error: { code: 'internal', message: 'Sync failed unexpectedly' } };
  }

  private counts(): { pending: number; opaque: number } {
    try {
      const pending = this.tracker.pendingCount();
      const opaque = this.sql.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM sync_opaque')?.n ?? 0;
      return { pending, opaque };
    } catch {
      return { pending: this.o.status.getSnapshot().pending, opaque: this.o.status.getSnapshot().opaque };
    }
  }

  private refreshCounts(): void {
    this.o.status.set(this.counts());
  }

  private check(run: Run): void {
    if (run.signal.aborted) throw new AbortRun();
  }

  // --- account check -------------------------------------------------------------------------------------------

  /**
   * Compare the account id, record-id key fingerprint and highest key epoch with what this DB last synced under
   * (sync_state). A different account or record-id key resets the tracker (everything is re-uploaded, derived ids
   * re-derived); fewer epochs than seen before is refused. See the header, step 0.
   */
  private async checkAccount(): Promise<void> {
    const u = this.o.unlocked;
    const fp = hexEncode((await hmacSha256(u.recordIdKey, utf8Encode('fp'))).subarray(0, 8));
    const top = maxEpoch(u.dataKeys);
    const st = this.tracker.state;
    const storedAccount = st.get('account_id');
    const storedFp = st.get('idk_fp');
    const same = storedAccount === u.accountId && storedFp === fp;
    let floor = -1;
    if (same) {
      const n = Number(st.get('epoch_max') ?? '-1');
      floor = Number.isSafeInteger(n) ? n : -1;
      if (top < floor) throw new EpochRollbackError();
    }
    const naturalKinds = [...this.kinds.entries()].filter(([, e]) => e.codec.naturalKey).map(([k]) => k);
    this.sql.transaction(() => {
      if (!same && (storedAccount !== undefined || storedFp !== undefined || this.hasServerState())) {
        this.tracker.resetForNewAccount(naturalKinds);
      }
      st.set('account_id', u.accountId);
      st.set('idk_fp', fp);
      st.set('epoch_max', String(Math.max(top, floor)));
    });
    if (!same) {
      this.failed.clear();
      this.unsyncable.clear();
    }
    this.identityChecked = true;
  }

  /** Anything learned from a server: a synced row, a cursor, opaque or pending records. */
  private hasServerState(): boolean {
    if (this.sql.queryOne('SELECT 1 AS x FROM sync_record WHERE server_seq IS NOT NULL LIMIT 1')) return true;
    if (this.sql.queryOne('SELECT 1 AS x FROM sync_opaque LIMIT 1')) return true;
    if (this.sql.queryOne('SELECT 1 AS x FROM sync_pending LIMIT 1')) return true;
    return (Number(this.tracker.state.get('cursor') ?? '0') || 0) > 0;
  }

  // --- pull ----------------------------------------------------------------------------------------------------

  private async pull(run: Run): Promise<void> {
    let cursor = Number(this.tracker.state.get('cursor') ?? '0') || 0;
    for (;;) {
      this.check(run);
      const page = await this.o.transport.pull(cursor, this.pageSize, run.signal);
      this.check(run);
      // R1 L15: seqs strictly increasing above the cursor, `next` = the last seq (or the cursor for an empty page).
      let last = cursor;
      for (const r of page.records) {
        if (!Number.isSafeInteger(r.seq) || r.seq <= last) throw new SyncResponseError('Malformed server response (changes order)');
        last = r.seq;
      }
      if (page.next !== last) throw new SyncResponseError('Malformed server response (changes.next)');
      const next = last;
      await this.applyRecords(run, page.records, next);
      if (!page.more || page.records.length === 0) break;
      cursor = next;
    }
  }

  private async retryOpaque(run: Run): Promise<void> {
    const all = this.tracker.opaque.all();
    if (all.length === 0) {
      await this.applyRecords(run, [], undefined); // still retry pending children (a module may have been installed)
      return;
    }
    for (let i = 0; i < all.length; i += this.pageSize) {
      this.check(run);
      const slice = all.slice(i, i + this.pageSize).map((r) => ({ id: r.id, seq: r.seq, deleted: false, blob: r.blob }));
      await this.applyRecords(run, slice, undefined, true);
    }
  }

  /** Decrypt `records`, then apply them in one applyRemote transaction (plus pending retry and the cursor). */
  private async applyRecords(run: Run, records: EncryptedRecord[], cursor: number | undefined, retrying = false): Promise<void> {
    const items: Array<{ rec: EncryptedRecord; inc: Incoming | null }> = [];
    for (const rec of records) {
      // No blob: a bare tombstone (not authenticated, R1 H1) or a broken live record. Kept opaque, deletes nothing.
      if (!rec.blob) { items.push({ rec, inc: null }); continue; }
      let pt: RecordPlaintext;
      try {
        pt = await this.o.cipher.open(rec.id, rec.blob);
      } catch {
        // UnknownEpochError, AuthError, SyntaxError (bad JSON): keep opaque. Never surface the error text.
        items.push({ rec, inc: null });
        continue;
      }
      // A server flagging a record deleted while its sealed content is a live version: the delete is not authentic.
      if (rec.deleted && pt.del !== true) { items.push({ rec, inc: null }); continue; }
      items.push({ rec, inc: incomingOf(pt) });
    }
    this.check(run);
    const fx = noEffects();
    this.tracker.applyRemote(() => {
      for (const { rec, inc } of items) {
        if (retrying) this.tracker.opaque.remove(rec.id);
        this.applyGuarded(rec, inc, fx);
      }
      this.retryPending(fx);
      if (cursor !== undefined) this.tracker.state.set('cursor', String(cursor));
      this.tracker.state.set('hlc_last', this.o.hlc.last);
    });
    if (retrying) fx.opaque = 0; // already counted when they were first kept
    this.absorb(run, fx, !retrying);
    await this.afterCommit(run);
  }

  private absorb(run: Run, fx: Effects, countPulled: boolean): void {
    if (countPulled) run.result.pulled += fx.applied;
    run.result.conflicts += fx.conflicts;
    run.result.conflictCopies += fx.conflictCopies;
    run.result.opaque += fx.opaque;
    run.changed.push(...fx.changed);
    run.copies.push(...fx.copies);
    for (const k of fx.defer) run.defer.add(k);
  }

  /** Adapter conflict copies, then afterApply / onApplied, outside the SQL transaction. */
  private async afterCommit(run: Run): Promise<void> {
    const copies = run.copies.splice(0);
    for (const c of copies) {
      try {
        const key = c.adapter.conflictCopy!(c.localKey, c.copy);
        this.tracker.touch(c.adapter.kind, key);
        run.changed.push({ kind: c.adapter.kind, localKey: key, deleted: false });
      } catch {
        // The adapter could not save the copy; the winner is already applied. Nothing to log (content stays private).
      }
    }
    const changed = run.changed.splice(0);
    if (changed.length === 0) return;
    for (const a of this.o.adapters ?? []) {
      const mine = changed.filter((c) => c.kind === a.kind);
      if (mine.length === 0 || !a.afterApply) continue;
      try { await a.afterApply(mine); } catch { /* adapter errors must not break sync */ }
    }
    try { this.o.onApplied?.(changed); } catch { /* host callback */ }
  }

  /** Apply one record in its own savepoint; any failure keeps it opaque (live) or leaves it alone (tombstone). */
  private applyGuarded(rec: EncryptedRecord, inc: Incoming | null, fx: Effects): void {
    const local = noEffects();
    try {
      this.sql.transaction(() => {
        if (inc === null) this.keepOpaque(rec, local);
        else this.applyOne(rec.id, rec.seq, inc, local, rec);
      });
    } catch (e) {
      if (inc && (inc.kind === 'tombstone' || e instanceof NeedParentIdError)) {
        // A delete that could not be applied (the codec's remove failed; R1 L4), or a local parent created during this
        // run without a derived id yet: wait in sync_pending and retry with the pending children (after every page and
        // on the next run), so the cursor moving on never drops it.
        try { this.sql.transaction(() => this.tracker.pending.put(rec.id, rec.seq, inc.pt, [])); } catch { /* next pull */ }
        return;
      }
      try {
        const o = noEffects();
        this.sql.transaction(() => this.keepOpaque(rec, o));
        merge(fx, o);
      } catch { /* leave it; the cursor still moves, the server keeps the record */ }
      return;
    }
    merge(fx, local);
  }

  private keepOpaque(rec: { id: RecordId; seq: number; blob: Uint8Array | null }, fx: Effects): void {
    this.tracker.opaque.put(rec.id, rec.seq, rec.blob);
    this.tracker.pending.remove(rec.id);
    fx.opaque++;
    const row = this.rowById(rec.id);
    if (row) fx.defer.push(keyOf(row.table_name, row.local_key)); // never push over a version we cannot read
  }

  private retryPending(fx: Effects): void {
    for (let progress = true; progress;) {
      progress = false;
      for (const p of this.tracker.pending.all()) {
        // Still waiting for a parent: skip cheaply (entries with no missing ids wait for a module; always retried).
        if (p.missing.some((id) => this.ctx.localKeyFor(id) === undefined)) continue;
        const local = noEffects();
        let stillPending = false;
        try {
          this.sql.transaction(() => {
            this.tracker.pending.remove(p.id);
            this.applyOne(p.id, p.seq, incomingOf(p.pt), local, null);
            stillPending = this.tracker.pending.all().some((q) => q.id === p.id);
          });
        } catch {
          continue; // stays pending (the savepoint rolled the remove back)
        }
        merge(fx, local);
        if (!stillPending) progress = true;
      }
    }
  }

  private codecForPlaintext(pt: RecordPlaintext): { codec: RecordCodec; kind: string } | undefined {
    const list = this.types.get(pt.t);
    if (!list || list.length === 0) return undefined;
    if (list.length === 1) return list[0];
    if (pt.t === 'ext.db' && isPlainObject(pt.d)) {
      const kind = `ext.db:${String(pt.d.ext)}/${String(pt.d.db)}/${String(pt.d.table)}`;
      return list.find((c) => c.kind === kind);
    }
    return undefined;
  }

  /**
   * Apply one incoming version (pulled, from a push conflict, or a pending retry) inside the caller's transaction.
   * `opaqueSource` is the encrypted record to keep when the plaintext is unusable (null for pending retries).
   */
  private applyOne(id: RecordId, seq: number, inc: Incoming, fx: Effects, opaqueSource: EncryptedRecord | null): void {
    const row = this.rowById(id);
    if (row && row.server_seq !== null && seq <= row.server_seq) return; // already have this version (or newer)
    const pt = inc.pt;
    const opaque = (): void => this.keepOpaque(opaqueSource ?? { id, seq, blob: null }, fx);
    if (typeof pt.h !== 'string' || tryParseHlc(pt.h) === null) { opaque(); return; }

    if (inc.kind === 'tombstone') {
      const entry = row ? this.kinds.get(row.table_name) : undefined;
      if (row && entry && entry.codec.type !== pt.t) { opaque(); return; }   // a tombstone for another type of record
      if (row && this.isReplay(row, pt.h)) { this.replayed(row, id, seq); return; }
      this.receiveHlc(pt.h);
      this.tracker.opaque.remove(id);
      this.tracker.pending.remove(id);
      if (!row) return;
      if (!row.dirty) {
        if (!row.deleted && entry) {
          entry.codec.remove(row.local_key, this.ctx);
          fx.changed.push({ kind: row.table_name, localKey: row.local_key, deleted: true });
        }
        this.markClean(row, id, seq, pt.h, null, true);
        fx.applied++;
        return;
      }
      if (!entry) { this.rebase(row, id, seq, pt.h, row.base_json); return; }
      this.mergeDirty(row, id, seq, entry.codec, { d: {}, h: pt.h, deleted: true }, pt, fx);
      fx.applied++;
      return;
    }

    const found = this.codecForPlaintext(pt);
    if (!found || !Number.isInteger(pt.cv) || pt.cv > found.codec.version || (row && row.table_name !== found.kind)) {
      opaque();
      return;
    }
    const { codec, kind } = found;

    if (row && this.isReplay(row, pt.h)) { this.replayed(row, id, seq); return; }
    this.receiveHlc(pt.h);
    this.tracker.opaque.remove(id);

    if (!row || !row.dirty) {
      if (this.writeRemote(row, kind, codec, id, seq, pt, fx)) fx.applied++;
      return;
    }
    this.mergeDirty(row, id, seq, codec, { d: pt.d, h: pt.h, deleted: false }, pt, fx);
    fx.applied++;
  }

  /** An incoming version (live or tombstone) no newer than the one we hold, deleted or not (R1 M3). */
  private isReplay(row: SyncRow, h: HlcString): boolean {
    return row.hlc !== null && tryParseHlc(row.hlc) !== null && compareHlc(h, row.hlc) <= 0;
  }

  /** Replayed or re-sent older/equal version: keep our state (live or deleted), only move the base to the server's seq. */
  private replayed(row: SyncRow, id: RecordId, seq: number): void {
    this.tracker.opaque.remove(id);
    this.tracker.pending.remove(id);
    if (row.dirty) this.rebase(row, id, seq, row.hlc!, row.base_json);
    else this.markClean(row, id, seq, row.hlc!, row.base_json, row.deleted === 1);
  }

  /** Decode + upsert a remote live version over a clean (or absent) local row. False when it had to wait in pending. */
  private writeRemote(row: SyncRow | undefined, kind: string, codec: RecordCodec, id: RecordId, seq: number,
    pt: RecordPlaintext, fx: Effects): boolean {
    const r = codec.decode(pt.d, this.ctx);
    if (!r.ok) {
      this.tracker.pending.put(id, seq, pt, r.missing);
      if (row) fx.defer.push(keyOf(row.table_name, row.local_key));
      return false;
    }
    const key = this.upsertRow(codec, r.row, row);
    this.tracker.pending.remove(id);
    this.tracker.markSynced(kind, key, { recordId: id, serverSeq: seq, hlc: pt.h, baseJson: JSON.stringify(pt.d), deleted: false });
    fx.changed.push({ kind, localKey: key, deleted: false });
    return true;
  }

  /** codec.upsert onto the row's local key; when the codec answers with another key (adopted row), move the bookkeeping. */
  private upsertRow(codec: RecordCodec, data: Row, row: SyncRow | undefined): string {
    // A tombstone parked on a synthetic key (backup restore, '\u001fr:<recordId>') has no real row to update: insert.
    const target = row && !(row.deleted === 1 && row.local_key.startsWith(SYNTHETIC_KEY_PREFIX)) ? row.local_key : undefined;
    const key = codec.upsert(data, target, this.ctx);
    if (row && key !== row.local_key) {
      this.sql.execute('DELETE FROM sync_record WHERE table_name = ? AND local_key = ?', [row.table_name, row.local_key]);
    }
    return key;
  }

  private mergeDirty(row: SyncRow, id: RecordId, seq: number, codec: RecordCodec, remote: Version,
    pt: RecordPlaintext | null, fx: Effects): void {
    const kind = row.table_name;
    const rowKey = keyOf(kind, row.local_key);
    const localH = this.localHlc(row);
    let localD: Record<string, unknown> | null = null;
    if (!row.deleted) localD = codec.encode(row.local_key, this.ctx);
    if (!row.deleted && localD === null) {
      // The local row no longer encodes (gone or not syncable): the server version stands.
      this.takeRemote(row, id, seq, codec, remote, pt, fx);
      return;
    }
    const local: Version = row.deleted ? { d: {}, h: localH, deleted: true } : { d: localD!, h: localH, deleted: false };
    let base: Version | null = null;
    if (row.base_json) {
      try {
        const b: unknown = JSON.parse(row.base_json);
        if (isPlainObject(b)) base = { d: b, h: row.hlc ?? '', deleted: false };
      } catch { base = null; }
    }
    const adapter = this.kinds.get(kind)?.adapter;
    const outcome = mergeOutcomeFor(codec.type, local, remote, base, { recordId: id, merge: adapter?.merge });
    fx.conflicts++;
    const remoteBase = remote.deleted ? null : JSON.stringify(remote.d);
    const remoteH = remote.h;

    switch (outcome.kind) {
      case 'takeRemote':
        this.takeRemote(row, id, seq, codec, remote, pt, fx);
        return;
      case 'keepLocal':
        this.rebase(row, id, seq, remoteH, remoteBase);
        return;
      case 'merged':
        if (!this.writeMerged(row, id, seq, codec, outcome.d, maxHlc(localH, remoteH), remoteBase, pt, fx)) fx.defer.push(rowKey);
        return;
      case 'conflictCopy': {
        // Check that everything decodes before writing anything (a loser may reference parents we lack).
        const copyDecoded = adapter?.conflictCopy ? null : codec.decode(outcome.copy, this.ctx);
        if (copyDecoded && !copyDecoded.ok) { this.park(id, seq, pt, copyDecoded.missing, rowKey, fx); return; }
        if (outcome.d) {
          if (!this.writeMerged(row, id, seq, codec, outcome.d, maxHlc(localH, remoteH), remoteBase, pt, fx)) {
            fx.defer.push(rowKey);
            return;
          }
        } else if (outcome.winner === 'remote') {
          if (!this.takeRemote(row, id, seq, codec, remote, pt, fx)) return;
        } else {
          this.rebase(row, id, seq, remoteH, remoteBase);
        }
        if (adapter?.conflictCopy) {
          fx.copies.push({ adapter, localKey: row.local_key, copy: outcome.copy });
        } else if (copyDecoded && copyDecoded.ok) {
          const key = codec.upsert(copyDecoded.row, undefined, this.ctx);
          this.tracker.touch(kind, key);
          fx.changed.push({ kind, localKey: key, deleted: false });
        }
        fx.conflictCopies++;
        return;
      }
    }
  }

  /** The server version wins over a dirty row. False when it had to wait for parents (row left as it was). */
  private takeRemote(row: SyncRow, id: RecordId, seq: number, codec: RecordCodec, remote: Version,
    pt: RecordPlaintext | null, fx: Effects): boolean {
    const kind = row.table_name;
    if (remote.deleted) {
      if (!row.deleted) {
        codec.remove(row.local_key, this.ctx);
        fx.changed.push({ kind, localKey: row.local_key, deleted: true });
      }
      this.markClean(row, id, seq, remote.h, null, true);
      return true;
    }
    const r = codec.decode(remote.d, this.ctx);
    if (!r.ok) { this.park(id, seq, pt, r.missing, keyOf(kind, row.local_key), fx); return false; }
    const key = this.upsertRow(codec, r.row, row);
    this.tracker.markSynced(kind, key, { recordId: id, serverSeq: seq, hlc: remote.h, baseJson: JSON.stringify(remote.d), deleted: false });
    fx.changed.push({ kind, localKey: key, deleted: false });
    return true;
  }

  /** Write merged content locally; the row stays dirty on top of the remote base (pushed later with an HLC above both). */
  private writeMerged(row: SyncRow, id: RecordId, seq: number, codec: RecordCodec, d: Record<string, unknown>,
    hlc: HlcString, remoteBase: string | null, pt: RecordPlaintext | null, fx: Effects): boolean {
    const r = codec.decode(d, this.ctx);
    if (!r.ok) { this.park(id, seq, pt, r.missing, keyOf(row.table_name, row.local_key), fx); return false; }
    const key = this.upsertRow(codec, r.row, row);
    const moved = key === row.local_key ? row : { ...row, local_key: key };
    if (moved !== row) this.tracker.touch(row.table_name, key);
    this.rebase(this.rowByKey(row.table_name, key) ?? moved, id, seq, hlc, remoteBase);
    fx.changed.push({ kind: row.table_name, localKey: key, deleted: false });
    return true;
  }

  private park(id: RecordId, seq: number, pt: RecordPlaintext | null, missing: RecordId[], rowKey: string, fx: Effects): void {
    if (pt) this.tracker.pending.put(id, seq, pt, missing);
    fx.defer.push(rowKey);
  }

  private markClean(row: SyncRow, id: RecordId, seq: number, hlc: HlcString, baseJson: string | null, deleted: boolean): void {
    this.tracker.markSynced(row.table_name, row.local_key, { recordId: id, serverSeq: seq, hlc, baseJson, deleted });
  }

  /** Record a server version as the row's base while keeping the row dirty (markSynced with a never-matching rev). */
  private rebase(row: SyncRow, id: RecordId, seq: number, hlc: HlcString, baseJson: string | null): void {
    this.tracker.markSynced(row.table_name, row.local_key, {
      recordId: id, serverSeq: seq, hlc, baseJson, deleted: row.deleted === 1, expectRev: -1,
    });
  }

  private receiveHlc(h: HlcString): void {
    try { this.o.hlc.receive(h, this.now()); } catch { /* too far ahead: applied, but our clock does not jump */ }
  }

  /**
   * HLC of the local version of a dirty row: the wall time of the change, but always above the version it was based
   * on (so an edit made after seeing a version orders after it even with a slow clock).
   */
  private localHlc(row: SyncRow): HlcString {
    const fromWall = formatHlc(Math.min(row.changed_ms, this.now() + 60_000), 0, this.dev);
    const base = tryParseHlc(row.hlc);
    if (!base) return fromWall;
    return maxHlc(fromWall, formatHlc(base.ms, base.counter + 1, this.dev));
  }

  // --- record ids ----------------------------------------------------------------------------------------------

  private makeContext(): CodecContext {
    return {
      sql: this.sql,
      tracker: this.tracker,
      modules: this.o.modules,
      recordIdFor: (kind, localKey) => {
        const existing = this.tracker.lookupByLocal(kind, localKey)?.recordId;
        if (existing) return existing;
        // Natural-key parents get derived ids asynchronously (ensureDerivedIds); never a random one here.
        if (this.kinds.get(kind)?.codec.naturalKey) throw new NeedParentIdError();
        const id = this.newId();
        this.tracker.assignRecordId(kind, localKey, id);
        return id;
      },
      localKeyFor: (recordId, expectedKind) => {
        const hit = this.tracker.lookupByRecordId(recordId);
        if (!hit || hit.deleted) return undefined;
        // A reference to a record of another kind must never link to a row of the wrong table (R1 L5).
        if (expectedKind !== undefined && hit.kind !== expectedKind) {
          throw new RecordDecodeError('A reference points at a record of another type');
        }
        return hit.localKey;
      },
    };
  }

  private newId(): RecordId {
    for (;;) {
      const id = hexEncode(this.random.bytes(16));
      if (!this.rowById(id)) return id;
    }
  }

  /** Give every live natural-key row without a record id its derived id (parents before children). */
  private async ensureDerivedIds(run: Run): Promise<void> {
    const kinds = [...this.kinds.entries()].filter(([, e]) => e.codec.naturalKey).map(([k]) => k);
    if (kinds.length === 0) return;
    for (let pass = 0; pass < 16; pass++) {
      const rows = this.sql.queryAll<{ table_name: string; local_key: string }>(
        `SELECT table_name, local_key FROM sync_record WHERE record_id IS NULL AND deleted = 0
         AND table_name IN (${kinds.map(() => '?').join(', ')})`, kinds);
      if (rows.length === 0) return;
      let progress = false;
      let blocked = false;
      for (const r of rows) {
        this.check(run);
        const codec = this.kinds.get(r.table_name)!.codec;
        let nk: { scope: string; key: string } | null;
        try {
          const d = codec.encode(r.local_key, this.ctx);
          if (d === null) continue;
          nk = codec.naturalKey!(d);
        } catch (e) {
          if (e instanceof NeedParentIdError) { blocked = true; continue; }
          continue; // push reports it
        }
        const id = nk ? await deriveRecordId(this.o.unlocked.recordIdKey, nk.scope, nk.key) : this.newId();
        if (this.claimId(r.table_name, r.local_key, id)) progress = true;
      }
      if (!progress || !blocked) return;
    }
  }

  /**
   * Assign `id` to a row. If an old local tombstone of the same kind holds it (deleted and re-created), the new row
   * takes over its server version; if a live row holds it (a local duplicate natural key), a random id is used.
   */
  private claimId(kind: string, localKey: string, id: RecordId): boolean {
    return this.sql.transaction(() => {
      const me = this.rowByKey(kind, localKey);
      if (!me || me.record_id) return false;
      const holder = this.rowById(id);
      if (!holder) {
        this.tracker.assignRecordId(kind, localKey, id);
      } else if (holder.table_name === kind && holder.deleted) {
        this.sql.execute('DELETE FROM sync_record WHERE table_name = ? AND local_key = ?', [holder.table_name, holder.local_key]);
        this.sql.execute('UPDATE sync_record SET record_id = ?, server_seq = ?, hlc = ? WHERE table_name = ? AND local_key = ?',
          [id, holder.server_seq, holder.hlc, kind, localKey]);
      } else {
        this.tracker.assignRecordId(kind, localKey, this.newId());
      }
      return true;
    });
  }

  private rowById(id: RecordId): SyncRow | undefined {
    return this.sql.queryOne<SyncRow>('SELECT * FROM sync_record WHERE record_id = ?', [id]);
  }

  private rowByKey(kind: string, localKey: string): SyncRow | undefined {
    return this.sql.queryOne<SyncRow>('SELECT * FROM sync_record WHERE table_name = ? AND local_key = ?', [kind, localKey]);
  }

  // --- push ----------------------------------------------------------------------------------------------------

  private async push(run: Run): Promise<void> {
    for (const a of this.o.adapters ?? []) {
      this.check(run);
      if (a.collect) await a.collect();
    }
    await this.ensureDerivedIds(run);
    const attempts = new Map<string, number>();
    const retryable = new Set<string>();
    let stopPushing = false;
    while (!stopPushing) {
      this.check(run);
      const skip = attempts.size + run.defer.size + this.failed.size + this.unsyncable.size;
      const rows = this.tracker.dirty(this.maxPushRecords + skip).filter((d) => {
        const k = keyOf(d.kind, d.localKey);
        if (run.defer.has(k)) return false;
        const f = this.failed.get(k) ?? this.unsyncable.get(k);
        if (f !== undefined && f === d.rev) return false;
        const n = attempts.get(k) ?? 0;
        return n === 0 || (retryable.has(k) && n <= MAX_CONFLICT_RETRIES);
      }).slice(0, this.maxPushRecords);
      if (rows.length === 0) break;
      for (const d of rows) {
        const k = keyOf(d.kind, d.localKey);
        attempts.set(k, (attempts.get(k) ?? 0) + 1);
        retryable.delete(k);
      }
      const items = await this.prepare(run, rows.map((d) => keyOf(d.kind, d.localKey)));
      for (const batch of this.batches(items)) {
        this.check(run);
        try {
          await this.send(run, batch, retryable);
        } catch (e) {
          if (e instanceof SyncHttpError && e.status === 403 && e.body?.error === 'email_unverified') {
            run.error = { code: 'email_unverified', message: 'Verify your email address to upload changes' };
            stopPushing = true;
            break;
          }
          throw e;
        }
      }
    }
  }

  private async prepare(run: Run, keys: string[]): Promise<PushItem[]> {
    // Phase 1 (synchronous, a consistent snapshot): read each row, encode it, assign random ids.
    const drafts: Array<{ row: SyncRow; codec: RecordCodec; d: Record<string, unknown> | null }> = [];
    for (const k of keys) {
      const i = k.indexOf(US);
      const row = this.rowByKey(k.slice(0, i), k.slice(i + 1));
      if (!row || !row.dirty) continue;
      const entry = this.kinds.get(row.table_name);
      if (!entry) { this.unsyncable.set(k, row.rev); continue; }
      if (row.deleted) {
        if (row.server_seq === null || !row.record_id) {
          this.sql.execute('DELETE FROM sync_record WHERE table_name = ? AND local_key = ?', [row.table_name, row.local_key]);
          continue;
        }
        drafts.push({ row, codec: entry.codec, d: null });
        continue;
      }
      let d: Record<string, unknown> | null;
      try {
        d = entry.codec.encode(row.local_key, this.ctx);
      } catch (e) {
        if (e instanceof NeedParentIdError) { run.defer.add(k); continue; }
        this.failRecord(run, k, row.rev, 'internal', 'A change could not be prepared for upload');
        continue;
      }
      if (d === null) {
        if (row.server_seq !== null && row.record_id) {
          // No longer syncable: the server keeps its last version; stop tracking this change.
          this.tracker.markSynced(row.table_name, row.local_key, {
            recordId: row.record_id, serverSeq: row.server_seq, hlc: row.hlc ?? '', baseJson: row.base_json, deleted: false, expectRev: row.rev,
          });
        } else {
          this.unsyncable.set(k, row.rev);
        }
        continue;
      }
      if (!row.record_id) {
        if (entry.codec.naturalKey?.(d)) { run.defer.add(k); continue; } // derived next run (ensureDerivedIds)
        const id = this.newId();
        this.tracker.assignRecordId(row.table_name, row.local_key, id);
        row.record_id = id;
      }
      drafts.push({ row, codec: entry.codec, d });
    }

    // Phase 2 (async): seal.
    const items: PushItem[] = [];
    for (const { row, codec, d } of drafts) {
      this.check(run);
      const k = keyOf(row.table_name, row.local_key);
      const h = this.localHlc(row);
      const id = row.record_id!;
      if (d === null) {
        // Sealed tombstone (R1 H1): authenticates the delete and carries its HLC. Sealed even past the nonce budget.
        let tomb: Uint8Array;
        try {
          tomb = await this.o.cipher.seal(id, { t: codec.type, cv: codec.version, h, dev: this.dev, d: {}, del: true });
        } catch {
          this.failRecord(run, k, row.rev, 'crypto', 'A change could not be encrypted');
          continue;
        }
        items.push({ kind: row.table_name, localKey: row.local_key, rev: row.rev, h, baseJson: null,
          rec: { id, baseSeq: row.server_seq, deleted: true, blob: b64urlEncode(tomb) } });
        continue;
      }
      if (this.o.cipher.sealsThisEpoch >= SEAL_LIMIT) {
        run.error = { code: 'crypto', message: 'The encryption key has been used too often; it must be rotated' };
        if (!this.epochWarned) {
          this.epochWarned = true;
          try { this.o.onNeedNewEpoch?.(); } catch { /* host callback */ }
        }
        run.defer.add(k);
        continue;
      }
      let blob: Uint8Array;
      try {
        blob = await this.o.cipher.seal(id, { t: codec.type, cv: codec.version, h, dev: this.dev, d });
      } catch (e) {
        if (e instanceof RecordTooLargeError) this.failRecord(run, k, row.rev, 'too_large', 'A change is too large to sync');
        else this.failRecord(run, k, row.rev, 'crypto', 'A change could not be encrypted');
        continue;
      }
      const rec: PushRecord = { id, baseSeq: row.server_seq, deleted: false, blob: b64urlEncode(blob) };
      items.push({ kind: row.table_name, localKey: row.local_key, rev: row.rev, h, baseJson: JSON.stringify(d), rec });
    }
    return items;
  }

  private failRecord(run: Run, key: string, rev: number, code: ApiErrorCode | 'crypto' | 'internal', message: string): void {
    this.failed.set(key, rev);
    run.error = { code, message };
  }

  /** Split by record count and by JSON body size (`{"records":[...]}`). */
  private batches(items: PushItem[]): PushItem[][] {
    const out: PushItem[][] = [];
    let cur: PushItem[] = [];
    let bytes = 14;
    for (const it of items) {
      const size = JSON.stringify(it.rec).length + 1;
      if (cur.length > 0 && (cur.length >= this.maxPushRecords || bytes + size > this.maxPushBytes)) {
        out.push(cur);
        cur = [];
        bytes = 14;
      }
      cur.push(it);
      bytes += size;
    }
    if (cur.length > 0) out.push(cur);
    return out;
  }

  private async send(run: Run, batch: PushItem[], retryable: Set<string>): Promise<void> {
    let res: Awaited<ReturnType<ISyncTransport['push']>>;
    try {
      res = await this.o.transport.push(batch.map((b) => b.rec), run.signal);
    } catch (e) {
      if (e instanceof SyncHttpError && e.status === 413) {
        if (batch.length > 1) {
          const mid = Math.ceil(batch.length / 2);
          await this.send(run, batch.slice(0, mid), retryable);
          await this.send(run, batch.slice(mid), retryable);
          return;
        }
        const code = e.body?.error === 'quota_exceeded' ? 'quota_exceeded' : 'too_large';
        this.failRecord(run, keyOf(batch[0].kind, batch[0].localKey), batch[0].rev, code,
          code === 'quota_exceeded' ? 'The sync storage quota is full' : 'A change is too large to sync');
        return;
      }
      throw e;
    }
    // No abort check here: the server has accepted these records, so their acceptance is recorded first (R1 L12).
    const byId = new Map(batch.map((b) => [b.rec.id, b]));
    this.sql.transaction(() => {
      for (const a of res.accepted) {
        const it = byId.get(a.id);
        if (!it) continue;
        this.tracker.markSynced(it.kind, it.localKey, {
          recordId: it.rec.id, serverSeq: a.seq, hlc: it.h, baseJson: it.baseJson, deleted: it.rec.deleted, expectRev: it.rev,
        });
        run.result.pushed++;
        this.failed.delete(keyOf(it.kind, it.localKey));
      }
    });
    for (const a of res.accepted) {
      const it = byId.get(a.id);
      if (it) this.receiveHlc(it.h);
    }
    this.check(run);
    if (res.conflicts.length === 0) return;

    // No server row although we sent a base: forget the base, so the retry goes out as new (or drop a tombstone).
    const real: EncryptedRecord[] = [];
    for (const c of res.conflicts) {
      const it = byId.get(c.id);
      if (!it) continue;
      if (c.current.seq === 0 && c.current.deleted && c.current.blob === null) {
        if (it.rec.deleted) {
          this.sql.execute('DELETE FROM sync_record WHERE table_name = ? AND local_key = ? AND deleted = 1', [it.kind, it.localKey]);
        } else {
          this.sql.execute('UPDATE sync_record SET server_seq = NULL, base_json = NULL WHERE table_name = ? AND local_key = ?',
            [it.kind, it.localKey]);
          retryable.add(keyOf(it.kind, it.localKey));
        }
        continue;
      }
      real.push(c.current);
    }
    if (real.length === 0) return;
    await this.applyRecords(run, real, undefined);
    for (const c of real) {
      const it = byId.get(c.id);
      if (!it) continue;
      const k = keyOf(it.kind, it.localKey);
      const row = this.rowByKey(it.kind, it.localKey);
      if (row?.dirty && !run.defer.has(k)) retryable.add(k);
    }
  }
}

interface PushItem { kind: string; localKey: string; rev: number; h: HlcString; baseJson: string | null; rec: PushRecord }

function merge(into: Effects, from: Effects): void {
  into.changed.push(...from.changed);
  into.copies.push(...from.copies);
  into.defer.push(...from.defer);
  into.conflicts += from.conflicts;
  into.conflictCopies += from.conflictCopies;
  into.applied += from.applied;
  into.opaque += from.opaque;
}

function httpMessage(e: SyncHttpError): string {
  switch (e.body?.error) {
    case 'rate_limited': return 'The sync server is busy; trying again later';
    case 'forbidden': return 'The sync server refused the request';
    case 'server_error': return 'The sync server had a problem';
    default: return e.status >= 500 ? 'The sync server had a problem' : 'The sync server rejected the request';
  }
}
