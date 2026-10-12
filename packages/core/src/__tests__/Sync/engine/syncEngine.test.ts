/** SyncEngine (contracts 0063 §8, task 0150 W3-A): two real engines against an in-memory §7 server. */
import { describe, it, expect, vi } from 'vitest';
import { deterministicRandom, hexEncode } from '../../../Crypto';
import { createRecordCipher, type RecordCipher } from '../../../Sync/crypto/RecordCipher';
import { SyncHttpError, SyncNetworkError, type ISyncTransport } from '../../../Sync/engine/ISyncTransport';
import { SEAL_LIMIT, type SyncAdapter, type SyncScheduler } from '../../../Sync/engine/SyncEngine';
import { createCodecRegistry, createCoreCodecs, type RecordCodec } from '../../../Sync/codecs/RecordCodec';
import type { RecordPlaintext } from '../../../Sync/types';
import {
  FakeServer, addNote, cloneAccount, makeDevice, notes, otherAccount, recordIdOf, reopenDevice, seededRandom, setChangedMs,
  testAccount, type Device,
} from './harness';

function pair(extraA = {}, extraB = {}) {
  const server = new FakeServer();
  const u = testAccount();
  const a = makeDevice(server, 1, u, extraA);
  const b = makeDevice(server, 2, cloneAccount(u), extraB);
  return { server, u, a, b };
}

const dirtyRow = (d: Device, kind: string, key: number | string) =>
  d.db.queryOne<{ dirty: number; server_seq: number | null; deleted: number }>(
    'SELECT dirty, server_seq, deleted FROM sync_record WHERE table_name = ? AND local_key = ?', [kind, String(key)]);

const epochOf = (blob: Uint8Array): number => new DataView(blob.buffer, blob.byteOffset + 1, 4).getUint32(0);

describe('SyncEngine: basic flow', () => {
  it('an edit on A reaches B; updates follow; status is idle with counts', async () => {
    const { a, b } = pair();
    const id = addNote(a, 'first');
    const r1 = await a.engine.syncNow();
    expect(r1.pushed).toBe(1);
    expect(a.status.getSnapshot()).toMatchObject({ state: 'idle', pending: 0, opaque: 0 });
    expect(a.status.getSnapshot().lastSyncedAt).toBeDefined();

    const r2 = await b.engine.syncNow();
    expect(r2.pulled).toBe(1);
    expect(notes(b).map((n) => n.content)).toEqual(['first']);
    expect(b.tracker.pendingCount()).toBe(0);

    a.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['second', id]);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['second']);

    // Our own pushes coming back on the next pull change nothing.
    expect(await a.engine.syncNow()).toMatchObject({ pulled: 0, pushed: 0, conflicts: 0 });
    expect(await b.engine.syncNow()).toMatchObject({ pulled: 0, pushed: 0, conflicts: 0 });
  });

  it('children before parents: a link that arrives first waits in sync_pending', async () => {
    const { a, b } = pair({}, { pageSize: 1 });
    const noteId = addNote(a, 'parent');
    const linkId = a.db.execute(
      'INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (?, 1001001, 1001002)', [noteId]).lastInsertRowId!;
    setChangedMs(a, 'note_verse_link', linkId, 1); // dirty order is changed_ms: the child goes out first
    setChangedMs(a, 'user_note', noteId, 2);
    await a.engine.syncNow();

    const put = vi.spyOn(b.tracker.pending, 'put');
    await b.engine.syncNow();
    expect(put).toHaveBeenCalledTimes(1);
    expect(b.tracker.pending.all()).toEqual([]);
    const note = b.db.queryOne<{ note_id: number; content: string }>('SELECT note_id, content FROM user_note')!;
    const link = b.db.queryOne<{ note_id: number }>('SELECT note_id FROM note_verse_link')!;
    expect(note.content).toBe('parent');
    expect(link.note_id).toBe(note.note_id);
    expect(b.tracker.pendingCount()).toBe(0);
  });

  it('natural-key records created on both devices meet on one derived id and converge (ext.kv)', async () => {
    const { a, b } = pair();
    a.db.execute("INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES ('ext.m', 'k', '\"a\"', 1)");
    b.db.execute("INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES ('ext.m', 'k', '\"b\"', 2)");
    setChangedMs(a, 'ext.kv', 'ext.m\u001fk', Date.now() - 5000);
    setChangedMs(b, 'ext.kv', 'ext.m\u001fk', Date.now() - 1000);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(recordIdOf(a, 'ext.kv', 'ext.m\u001fk')).toBe(recordIdOf(b, 'ext.kv', 'ext.m\u001fk'));
    const val = (d: Device) => d.db.queryOne<{ value: string }>('SELECT value FROM extension_storage')!.value;
    expect(val(a)).toBe('"b"');
    expect(val(b)).toBe('"b"');
    expect(a.tracker.pendingCount() + b.tracker.pendingCount()).toBe(0);
  });
});

describe('SyncEngine: conflicts', () => {
  it('concurrent note edits: the newer body wins and both devices get the same conflicted copy', async () => {
    const { a, b } = pair();
    const id = addNote(a, 'base');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const bId = b.db.queryOne<{ note_id: number }>('SELECT note_id FROM user_note')!.note_id;
    const t = Date.now();
    a.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['from A', id]);
    b.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['from B', bId]);
    setChangedMs(a, 'user_note', id, t + 1000);
    setChangedMs(b, 'user_note', bId, t + 2000);

    await a.engine.syncNow();                // A pushes first
    const rb = await b.engine.syncNow();     // B merges: B is newer, A's body becomes a copy
    expect(rb.conflicts).toBe(1);
    expect(rb.conflictCopies).toBe(1);
    await a.engine.syncNow();

    const winner = recordIdOf(a, 'user_note', id);
    for (const d of [a, b]) {
      const ns = notes(d);
      expect(ns.map((n) => n.content)).toEqual(['from A', 'from B']);
      const copy = ns.find((n) => n.content === 'from A')!;
      expect(JSON.parse(copy.metadata!)).toEqual({ conflictOf: winner });
      expect(d.tracker.pendingCount()).toBe(0);
    }
    // Same record ids on both sides.
    const ids = (d: Device) => d.db.queryAll<{ record_id: string }>(
      "SELECT record_id FROM sync_record WHERE table_name = 'user_note' ORDER BY record_id").map((r) => r.record_id);
    expect(ids(a)).toEqual(ids(b));
  });

  it('delete vs a newer concurrent edit: the edit survives (no silent loss) on both devices', async () => {
    const { a, b } = pair();
    const id = addNote(a, 'v1');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const bId = b.db.queryOne<{ note_id: number }>('SELECT note_id FROM user_note')!.note_id;
    a.db.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
    b.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['edited on B', bId]);
    const t = Date.now();
    setChangedMs(a, 'user_note', id, t + 1000);    // the delete is older than the edit
    setChangedMs(b, 'user_note', bId, t + 2000);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(notes(a).map((n) => n.content)).toEqual(['edited on B']);
    expect(notes(b).map((n) => n.content)).toEqual(['edited on B']);
    expect(a.tracker.pendingCount() + b.tracker.pendingCount()).toBe(0);
  });

  it('R1 H1: a sealed delete newer than a concurrent edit wins on both devices', async () => {
    const { a, b } = pair();
    const id = addNote(a, 'v1');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const bId = b.db.queryOne<{ note_id: number }>('SELECT note_id FROM user_note')!.note_id;
    b.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['edited on B', bId]);
    a.db.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
    const t = Date.now();
    setChangedMs(b, 'user_note', bId, t + 1000);   // the edit is older than the delete
    setChangedMs(a, 'user_note', id, t + 2000);
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(notes(a)).toEqual([]);
    expect(notes(b)).toEqual([]);
    expect(a.tracker.pendingCount() + b.tracker.pendingCount()).toBe(0);
  });

  it('a delete without a concurrent edit removes the row on the other device', async () => {
    const { a, b } = pair();
    const id = addNote(a, 'gone soon');
    await a.engine.syncNow();
    await b.engine.syncNow();
    a.db.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
    await a.engine.syncNow();
    const r = await b.engine.syncNow();
    expect(r.pulled).toBe(1);
    expect(notes(b)).toEqual([]);
    expect(b.tracker.pendingCount()).toBe(0);
  });

  it('gives up on a record after 3 conflict retries in one run and leaves it dirty', async () => {
    const { server, a, b } = pair();
    const id = addNote(a, 'x');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const rid = recordIdOf(a, 'user_note', id);
    a.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['y', id]);
    server.bumpOnPush.add(rid);
    const before = server.pushCalls.length;
    await a.engine.syncNow();
    const attempts = server.pushCalls.slice(before).filter((c) => c.some((r) => r.id === rid)).length;
    expect(attempts).toBe(4); // first push + 3 retries
    expect(dirtyRow(a, 'user_note', id)!.dirty).toBe(1);
    server.bumpOnPush.clear();
    await a.engine.syncNow();
    expect(dirtyRow(a, 'user_note', id)!.dirty).toBe(0);
    await b.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['y']);
  });
});

describe('SyncEngine: hostile or unknown records', () => {
  async function sealWith(cipher: RecordCipher, id: string, pt: Partial<RecordPlaintext>): Promise<Uint8Array> {
    return cipher.seal(id, { t: 'user_note', cv: 1, h: '0192f3a1b2c3:0000:9f3c0a1b2c3d4e5f', dev: '9f3c0a1b2c3d4e5f', d: {}, ...pt });
  }

  it('keeps unknown type / higher cv / unknown epoch / undecryptable records opaque, untouched and never pushed', async () => {
    const { server, u, a, b } = pair();
    const rid = (n: number) => hexEncode(seededRandom(9000 + n).bytes(16));
    const known = addNote(a, 'known');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const knownId = recordIdOf(a, 'user_note', known);

    const future = cloneAccount(u);
    future.dataKeys.set(7, seededRandom(77).bytes(32));
    future.currentEpoch = 7;
    const futureCipher = createRecordCipher(future, deterministicRandom(5));
    const blobs = {
      type: await sealWith(a.cipher, rid(1), { t: 'future_type', d: { x: 1 } }),
      cv: await sealWith(a.cipher, rid(2), { cv: 99, d: { content: 'v99' } }),
      epoch: await sealWith(futureCipher, rid(3), { d: { content: 'later' } }),
      garbage: Uint8Array.from([1, 0, 0, 0, 1, ...new Array(40).fill(7)]),
      newerKnown: await sealWith(a.cipher, knownId, { cv: 99, d: { content: 'from a newer app' } }),
    };
    server.put(rid(1), blobs.type);
    server.put(rid(2), blobs.cv);
    server.put(rid(3), blobs.epoch);
    server.put(rid(4), blobs.garbage);
    server.put(knownId, blobs.newerKnown);
    const snapshot = new Map([...server.rows].map(([id, r]) => [id, { seq: r.seq, blob: hexEncode(r.blob!) }]));

    const r = await b.engine.syncNow();
    expect(r.opaque).toBe(5);
    expect(b.status.getSnapshot()).toMatchObject({ state: 'idle', opaque: 5 });
    expect(notes(b).map((n) => n.content)).toEqual(['known']); // local row untouched, nothing created

    // B edits the record it cannot read and adds a note: nothing it cannot read is pushed or changed.
    const bKnown = b.db.queryOne<{ note_id: number }>('SELECT note_id FROM user_note')!.note_id;
    b.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['b edit', bKnown]);
    addNote(b, 'new on b');
    await b.engine.syncNow();
    await b.engine.syncNow();
    for (const [id, s] of snapshot) {
      const row = server.rows.get(id)!;
      expect({ seq: row.seq, blob: hexEncode(row.blob!) }).toEqual(s);
    }
    expect(server.pushCalls.flat().some((p) => [rid(1), rid(2), rid(3), rid(4)].includes(p.id))).toBe(false);
    expect(b.tracker.opaque.all().map((o) => o.id).sort()).toEqual([rid(1), rid(2), rid(3), rid(4), knownId].sort());

    // A newer version of an opaque record replaces the stored copy; a tombstone removes it.
    const v2 = await sealWith(a.cipher, rid(1), { t: 'future_type', d: { x: 2 } });
    const seq2 = server.put(rid(1), v2);
    server.put(rid(2), await sealWith(a.cipher, rid(2), { d: {}, del: true }), true);   // a sealed tombstone
    await b.engine.syncNow();
    const kept = new Map(b.tracker.opaque.all().map((o) => [o.id, o]));
    expect(kept.get(rid(1))!.seq).toBe(seq2);
    expect(hexEncode(kept.get(rid(1))!.blob!)).toBe(hexEncode(v2));
    expect(kept.has(rid(2))).toBe(false);
    expect(b.status.getSnapshot().opaque).toBe(4);

    // A device that has the epoch-7 key reads the record B kept opaque, byte for byte as written.
    const c = makeDevice(server, 3, future);
    await c.engine.syncNow();
    expect(notes(c).map((n) => n.content)).toContain('later');
  });

  it('a replayed older version of a known record is ignored', async () => {
    const { server, a, b } = pair();
    const id = addNote(a, 'v1');
    await a.engine.syncNow();
    const rid = recordIdOf(a, 'user_note', id);
    const oldBlob = server.rows.get(rid)!.blob!;
    a.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['v2', id]);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['v2']);

    const replaySeq = server.put(rid, oldBlob); // a hostile server re-serves v1 under a new seq
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['v2']);
    expect(notes(a).map((n) => n.content)).toEqual(['v2']);
    const bId = b.db.queryOne<{ note_id: number }>('SELECT note_id FROM user_note')!.note_id;
    expect(dirtyRow(b, 'user_note', bId)).toMatchObject({ dirty: 0, server_seq: replaySeq });

    // B's next edit is based on the replayed seq, so it is accepted without a conflict loop.
    b.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['v3', bId]);
    expect((await b.engine.syncNow()).pushed).toBe(1);
    await a.engine.syncNow();
    expect(notes(a).map((n) => n.content)).toEqual(['v3']);
  });
});

describe('SyncEngine: scheduling', () => {
  it('single-flight: concurrent syncNow calls share one run', async () => {
    const { server, a } = pair();
    addNote(a, 'x');
    const p1 = a.engine.syncNow();
    const p2 = a.engine.syncNow();
    expect(p2).toBe(p1);
    await Promise.all([p1, p2]);
    expect(server.pullCalls).toBe(1);
    expect(server.pushCalls.length).toBe(1);
  });

  it('notifyLocalChange is debounced 5 s', async () => {
    const { a } = pair();
    const spy = vi.spyOn(a.engine, 'syncNow');
    addNote(a, 'x');
    a.engine.notifyLocalChange();
    a.timers.advance(3000);
    a.engine.notifyLocalChange();
    a.timers.advance(3000);
    a.engine.notifyLocalChange();
    expect(spy).not.toHaveBeenCalled();
    expect(a.status.getSnapshot().pending).toBe(1); // counts refresh right away
    a.timers.advance(4999);
    expect(spy).not.toHaveBeenCalled();
    a.timers.advance(1);
    expect(spy).toHaveBeenCalledTimes(1);
    await spy.mock.results[0].value;
    expect(a.tracker.pendingCount()).toBe(0);
  });

  it('start syncs now, every 5 minutes and when back online; stop unhooks', async () => {
    const { a } = pair();
    const spy = vi.spyOn(a.engine, 'syncNow');
    let tick: (() => void) | undefined;
    let online: (() => void) | undefined;
    const off = { every: vi.fn(), online: vi.fn() };
    const scheduler: SyncScheduler = {
      every: (ms, fn) => { expect(ms).toBe(5 * 60 * 1000); tick = fn; return off.every; },
      onOnline: (fn) => { online = fn; return off.online; },
    };
    a.engine.start(scheduler);
    expect(spy).toHaveBeenCalledTimes(1);
    await spy.mock.results[0].value;
    tick!();
    await spy.mock.results[1].value;
    online!();
    expect(spy).toHaveBeenCalledTimes(3);
    await spy.mock.results[2].value;
    a.engine.stop();
    expect(off.every).toHaveBeenCalled();
    expect(off.online).toHaveBeenCalled();
  });

  it('an AbortSignal stops the run; the next run completes', async () => {
    const { a } = pair();
    addNote(a, 'x');
    const ctl = new AbortController();
    ctl.abort();
    const r = await a.engine.syncNow(ctl.signal);
    expect(r.pushed).toBe(0);
    expect(a.tracker.pendingCount()).toBe(1);
    expect((await a.engine.syncNow()).pushed).toBe(1);
  });
});

describe('SyncEngine: errors and status', () => {
  it('offline: status offline, pending count kept; recovers when the network is back', async () => {
    const { server, a } = pair();
    addNote(a, 'x');
    addNote(a, 'y');
    server.failPull = () => new SyncNetworkError();
    await a.engine.syncNow();
    expect(a.status.getSnapshot()).toMatchObject({ state: 'offline', pending: 2 });
    server.failPull = undefined;
    await a.engine.syncNow();
    expect(a.status.getSnapshot()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('401 -> locked, and the engine stops running', async () => {
    const { server, a } = pair();
    server.failPull = () => new SyncHttpError(401, { error: 'unauthorized' });
    await a.engine.syncNow();
    expect(a.status.getSnapshot().state).toBe('locked');
    server.failPull = undefined;
    const calls = server.pullCalls;
    await a.engine.syncNow();
    expect(server.pullCalls).toBe(calls);
    expect(a.status.getSnapshot().state).toBe('locked');
  });

  it('403 email_unverified: pull still applied, pushing stops with that error code', async () => {
    const { server, a, b } = pair();
    addNote(a, 'from a');
    await a.engine.syncNow();
    addNote(b, 'from b');
    server.failPush = () => new SyncHttpError(403, { error: 'email_unverified', message: 'Verify your email address to sync' });
    await b.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['from a', 'from b']);
    expect(b.status.getSnapshot()).toMatchObject({ state: 'error', pending: 1, error: { code: 'email_unverified' } });
    expect(server.pushCalls.length).toBe(2); // A's push + B's single refused one
    server.failPush = undefined;
    await b.engine.syncNow();
    expect(b.status.getSnapshot()).toMatchObject({ state: 'idle', pending: 0 });
    expect(b.status.getSnapshot().error).toBeUndefined();
  });

  it('5xx maps to an error status with the server code and no request content', async () => {
    const { server, a } = pair();
    addNote(a, 'secret words');
    server.failPush = () => new SyncHttpError(503, { error: 'server_error', message: 'boom' });
    await a.engine.syncNow();
    const s = a.status.getSnapshot();
    expect(s).toMatchObject({ state: 'error', pending: 1, error: { code: 'server_error' } });
    expect(JSON.stringify(s)).not.toContain('secret');
  });

  it('too_large / quota_exceeded: the failing record is isolated, the others go through', async () => {
    const { server, a, b } = pair();
    addNote(a, 'small 1');
    addNote(a, 'x'.repeat(5000));
    addNote(a, 'small 2');
    server.maxRecordBytes = 3000;
    await a.engine.syncNow();
    expect(a.status.getSnapshot()).toMatchObject({ state: 'error', pending: 1, error: { code: 'too_large' } });
    await b.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['small 1', 'small 2']);
    // The failed record is not retried until it changes.
    const calls = server.pushCalls.length;
    await a.engine.syncNow();
    expect(server.pushCalls.length).toBe(calls);

    server.failPush = (recs) => (recs.length > 0 ? new SyncHttpError(413, { error: 'quota_exceeded' }) : undefined);
    addNote(a, 'over quota');
    await a.engine.syncNow();
    expect(a.status.getSnapshot().error?.code).toBe('quota_exceeded');
  });
});

describe('SyncEngine: push details', () => {
  it('an edit made between read and ack stays dirty and is pushed next run with the new base', async () => {
    const { server, a, b } = pair();
    const id = addNote(a, 'v1');
    let once = true;
    server.beforePush = () => {
      if (!once) return;
      once = false;
      a.db.execute('UPDATE user_note SET content = ? WHERE note_id = ?', ['v2 (typed during the push)', id]);
    };
    await a.engine.syncNow();
    const row = dirtyRow(a, 'user_note', id)!;
    expect(row.dirty).toBe(1);
    expect(row.server_seq).not.toBeNull();
    const r = await a.engine.syncNow();
    expect(r).toMatchObject({ pushed: 1, conflicts: 0 });
    expect(dirtyRow(a, 'user_note', id)!.dirty).toBe(0);
    await b.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['v2 (typed during the push)']);
  });

  it('batches by record count (500) and by body size', async () => {
    const server = new FakeServer();
    const u = testAccount();
    const a = makeDevice(server, 1, u);
    a.db.transaction(() => { for (let i = 0; i < 501; i++) addNote(a, `n${i}`); });
    await a.engine.syncNow();
    expect(server.pushCalls.map((c) => c.length)).toEqual([500, 1]);

    const s2 = new FakeServer();
    const c = makeDevice(s2, 3, cloneAccount(u), { pushLimits: { maxBodyBytes: 12_000 } });
    for (let i = 0; i < 6; i++) addNote(c, `${i}`.repeat(3000));
    await c.engine.syncNow();
    expect(s2.pushCalls.length).toBeGreaterThan(1);
    for (const call of s2.pushCalls) expect(JSON.stringify({ records: call }).length).toBeLessThanOrEqual(12_000);
    expect(s2.pushCalls.flat().length).toBe(6);
  });

  it('reencryptAll re-seals every synced record under the new epoch; the other device follows; opaque untouched', async () => {
    const { server, u, a, b } = pair();
    addNote(a, 'one');
    addNote(a, 'two');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const unknown = hexEncode(seededRandom(31337).bytes(16));
    server.put(unknown, await a.cipher.seal(unknown, { t: 'future_type', cv: 1, h: a.hlc.last, dev: 'a'.repeat(16), d: {} }));
    await a.engine.syncNow();
    const opaqueBlob = hexEncode(server.rows.get(unknown)!.blob!);

    const newKey = seededRandom(2024).bytes(32);
    for (const acct of [a.unlocked, b.unlocked]) { acct.dataKeys.set(2, newKey.slice()); acct.currentEpoch = 2; }
    void u;
    const r = await a.engine.reencryptAll();
    expect(r.pushed).toBe(2);
    for (const [id, row] of server.rows) {
      if (id === unknown) expect(hexEncode(row.blob!)).toBe(opaqueBlob);
      else expect(epochOf(row.blob!)).toBe(2);
    }
    const rb = await b.engine.syncNow();
    expect(rb).toMatchObject({ conflicts: 0, conflictCopies: 0 });
    expect(notes(b).map((n) => n.content)).toEqual(['one', 'two']);
    expect(b.tracker.pendingCount()).toBe(0);
  });

  it('stops sealing at 2^30 seals per epoch, reports crypto and asks once for a new epoch', async () => {
    const server = new FakeServer();
    const u = testAccount();
    const onNeedNewEpoch = vi.fn();
    const base = createRecordCipher(u, deterministicRandom(1));
    const worn: RecordCipher = { seal: (i, p) => base.seal(i, p), open: (i, b) => base.open(i, b), sealsThisEpoch: SEAL_LIMIT };
    const a = makeDevice(server, 1, u, { cipher: worn, onNeedNewEpoch });
    addNote(a, 'x');
    await a.engine.syncNow();
    await a.engine.syncNow();
    expect(server.pushCalls.flat().length).toBe(0);
    expect(onNeedNewEpoch).toHaveBeenCalledTimes(1);
    expect(a.status.getSnapshot()).toMatchObject({ state: 'error', pending: 1, error: { code: 'crypto' } });
  });

  it('adapters: collect before push, afterApply after commit, conflictCopy hook for the loser', async () => {
    const server = new FakeServer();
    const u = testAccount();
    const mk = (n: number) => {
      const files = new Map<string, string>();
      const queue: Array<{ path: string; deleted: boolean }> = [];
      const calls: string[] = [];
      const applied: Array<{ kind: string; localKey: string; deleted: boolean }> = [];
      const holder: { dev?: Device } = {};
      const codec: RecordCodec = {
        type: 'bn.file', kind: 'bn.file', version: 1,
        encode: (key) => (files.has(key) ? { path: key, bn: { text: files.get(key) }, mtime: 'm' } : null),
        decode: (d) => ({ ok: true, row: { path: String(d.path), text: String((d.bn as { text: string }).text) } }),
        upsert: (row) => { files.set(String(row.path), String(row.text)); return String(row.path); },
        remove: (key) => { files.delete(key); },
        naturalKey: (d) => ({ scope: 'bn.file', key: String(d.path).toLowerCase() }),
      };
      const adapter: SyncAdapter = {
        kind: 'bn.file', codec,
        collect: async () => {
          calls.push('collect');
          for (const q of queue.splice(0)) holder.dev!.tracker.touch('bn.file', q.path, { deleted: q.deleted });
        },
        afterApply: async (changed) => { calls.push('afterApply'); applied.push(...changed); },
        conflictCopy: (key, copy) => {
          const name = key.replace(/\.bn$/, ' (conflicted copy).bn');
          files.set(name, String((copy.bn as { text: string }).text));
          expect(typeof copy.conflictOf).toBe('string');
          return name;
        },
      };
      const dev = makeDevice(server, n, n === 1 ? u : cloneAccount(u), { adapters: [adapter] });
      holder.dev = dev;
      const write = (path: string, text: string, changedMs?: number) => {
        files.set(path, text);
        queue.push({ path, deleted: false });
        if (changedMs !== undefined) return () => setChangedMs(dev, 'bn.file', path, changedMs);
        return () => undefined;
      };
      return { dev, files, calls, applied, write, queue };
    };
    const a = mk(1);
    const b = mk(2);
    a.write('Notes/A.bn', 'one');
    await a.dev.engine.syncNow();
    expect(a.calls).toEqual(['collect']);
    await b.dev.engine.syncNow();
    expect([...b.files]).toEqual([['Notes/A.bn', 'one']]);
    expect(b.applied).toEqual([{ kind: 'bn.file', localKey: 'Notes/A.bn', deleted: false }]);
    expect(b.calls).toEqual(['afterApply', 'collect']);
    // Derived id from the natural key: both devices agree.
    expect(recordIdOf(a.dev, 'bn.file', 'Notes/A.bn')).toBe(recordIdOf(b.dev, 'bn.file', 'Notes/A.bn'));

    // Both edit the file; B is newer. A pushes first, B merges and saves A's text through the adapter hook.
    const t = Date.now();
    a.write('Notes/A.bn', 'from A');
    b.write('Notes/A.bn', 'from B');
    await a.dev.engine['o'].adapters![0].collect!();
    await b.dev.engine['o'].adapters![0].collect!();
    setChangedMs(a.dev, 'bn.file', 'Notes/A.bn', t + 1000);
    setChangedMs(b.dev, 'bn.file', 'Notes/A.bn', t + 2000);
    await a.dev.engine.syncNow();
    const rb = await b.dev.engine.syncNow();
    expect(rb.conflictCopies).toBe(1);
    await a.dev.engine.syncNow();
    const sorted = (m: Map<string, string>) => [...m].sort();
    expect(sorted(b.files)).toEqual([['Notes/A (conflicted copy).bn', 'from A'], ['Notes/A.bn', 'from B']]);
    expect(sorted(a.files)).toEqual(sorted(b.files));
    expect(a.dev.tracker.pendingCount() + b.dev.tracker.pendingCount()).toBe(0);
  });
});

describe('SyncEngine: R1 security fixes', () => {
  const futureHlc = (dev: string, aheadMs = 10_000) =>
    `${(Date.now() + aheadMs).toString(16).padStart(12, '0')}:0000:${dev}`;

  it('H1: tombstones are sealed; the server stores the sealed blob and other devices honour it', async () => {
    const { server, a, b } = pair();
    const id = addNote(a, 'to delete');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const rid = recordIdOf(a, 'user_note', id);
    a.db.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
    await a.engine.syncNow();
    const push = server.pushCalls.flat().find((r) => r.id === rid && r.deleted)!;
    expect(push.blob).toEqual(expect.any(String));
    const row = server.rows.get(rid)!;
    expect(row.deleted).toBe(true);
    const pt = await a.cipher.open(rid, row.blob!);
    expect(pt).toMatchObject({ t: 'user_note', d: {}, del: true });
    await b.engine.syncNow();
    expect(notes(b)).toEqual([]);
  });

  it('H1: a bare server tombstone (blob null) deletes nothing; the record is kept opaque', async () => {
    const { server, a, b } = pair();
    const id = addNote(a, 'precious');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const rid = recordIdOf(a, 'user_note', id);
    server.put(rid, null, true);
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['precious']);
    expect(notes(a).map((n) => n.content)).toEqual(['precious']);
    expect(b.tracker.opaque.all().map((o) => o.id)).toEqual([rid]);
    expect(b.status.getSnapshot().opaque).toBe(1);
    // A fresh device learns nothing from it either.
    const c = makeDevice(server, 3, cloneAccount(a.unlocked));
    await c.engine.syncNow();
    expect(notes(c)).toEqual([]);
  });

  it('H1: a server flagging a live sealed version as deleted deletes nothing', async () => {
    const { server, a, b } = pair();
    const id = addNote(a, 'keep me');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const rid = recordIdOf(a, 'user_note', id);
    server.put(rid, server.rows.get(rid)!.blob, true);
    await b.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['keep me']);
    expect(b.tracker.opaque.all().map((o) => o.id)).toEqual([rid]);
  });

  it('M3: a replayed old version does not resurrect a deleted record; a newer version does', async () => {
    const { server, a, b } = pair();
    const id = addNote(a, 'v1');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const rid = recordIdOf(a, 'user_note', id);
    const oldBlob = server.rows.get(rid)!.blob!;
    a.db.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(notes(b)).toEqual([]);

    server.seq += 10;
    const replaySeq = server.put(rid, oldBlob);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(notes(a)).toEqual([]);
    expect(notes(b)).toEqual([]);
    expect(dirtyRow(a, 'user_note', id)).toMatchObject({ dirty: 0, deleted: 1, server_seq: replaySeq });
    expect(a.tracker.pendingCount() + b.tracker.pendingCount()).toBe(0);

    const pt = await a.cipher.open(rid, oldBlob);
    const newer = await a.cipher.seal(rid, { ...pt, h: futureHlc('9f3c0a1b2c3d4e5f'), d: { ...pt.d, content: 'back again' } });
    server.put(rid, newer);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(notes(a).map((n) => n.content)).toEqual(['back again']);
    expect(notes(b).map((n) => n.content)).toEqual(['back again']);
  });

  it('L4: a delete whose local remove fails waits in sync_pending and is applied by the next run', async () => {
    const server = new FakeServer();
    const u = testAccount();
    const a = makeDevice(server, 1, u);
    let failRemove = true;
    const codecs = createCoreCodecs({ extKvSyncs: () => true }).map((c) => (c.kind !== 'user_note' ? c : {
      ...c,
      remove: (key: string, ctx: Parameters<RecordCodec['remove']>[1]) => {
        if (failRemove) throw new Error('disk full');
        c.remove(key, ctx);
      },
    }));
    const b = makeDevice(server, 2, cloneAccount(u), { codecs: createCodecRegistry(codecs) });
    const id = addNote(a, 'doomed');
    await a.engine.syncNow();
    await b.engine.syncNow();
    const rid = recordIdOf(a, 'user_note', id);
    a.db.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['doomed']);
    expect(b.tracker.pending.all().map((p) => p.id)).toEqual([rid]);
    expect(Number(b.tracker.state.get('cursor'))).toBe(server.seq);   // the cursor moved on; the delete is kept
    failRemove = false;
    await b.engine.syncNow();
    expect(notes(b)).toEqual([]);
    expect(b.tracker.pending.all()).toEqual([]);
    expect(b.tracker.pendingCount()).toBe(0);
  });

  it('L5: a note link whose parent FK is a highlight record id is kept opaque', async () => {
    const { server, a, b } = pair();
    const hl = a.db.execute(
      "INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (1, 1001001, 1001001, '#ffff00')").lastInsertRowId!;
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.db.queryAll('SELECT markup_id FROM user_text_markup')).toHaveLength(1);
    const highlight = recordIdOf(a, 'user_text_markup', hl);
    const rid = hexEncode(seededRandom(555).bytes(16));
    server.put(rid, await a.cipher.seal(rid, {
      t: 'note_verse_link', cv: 1, h: a.hlc.last, dev: '1'.repeat(16),
      d: { note_id: highlight, verse_id_start: 1001001, verse_id_end: 1001001, link_type: 'reference' },
    }));
    const r = await b.engine.syncNow();
    expect(r.opaque).toBe(1);
    expect(b.db.queryAll('SELECT link_id FROM note_verse_link')).toEqual([]);
    expect(b.tracker.opaque.all().map((o) => o.id)).toEqual([rid]);
  });

  it('L12: an abort after the push answer still records the accepted records', async () => {
    const server = new FakeServer();
    const base = server.transport();
    const ctl = new AbortController();
    const transport: ISyncTransport = {
      pull: base.pull,
      push: async (recs, signal) => { const res = await base.push(recs, signal); ctl.abort(); return res; },
    };
    const a = makeDevice(server, 1, testAccount(), { transport });
    const id = addNote(a, 'x');
    await a.engine.syncNow(ctl.signal);
    expect(dirtyRow(a, 'user_note', id)).toMatchObject({ dirty: 0, server_seq: 1 });
    const calls = server.pushCalls.length;
    expect(await a.engine.syncNow()).toMatchObject({ pushed: 0, conflicts: 0 });
    expect(server.pushCalls.length).toBe(calls);
  });

  it('L15: pages with a bad next or out-of-order seqs are refused and the cursor stays put', async () => {
    const { server, a, b } = pair();
    addNote(a, 'one');
    addNote(a, 'two');
    await a.engine.syncNow();
    const base = server.transport();
    const bad: Array<(p: Awaited<ReturnType<ISyncTransport['pull']>>) => Awaited<ReturnType<ISyncTransport['pull']>>> = [
      (p) => ({ ...p, next: p.next + 1000 }),                                   // cursor poisoning
      (p) => ({ ...p, records: [...p.records].reverse() }),                     // not increasing
      (p) => ({ ...p, records: [p.records[0], p.records[0]], next: p.records[0].seq }), // repeated seq
      (p) => ({ ...p, records: [], next: 5 }),                                  // empty page moving the cursor
    ];
    for (const tamper of bad) {
      const c = reopenDevice(server, b, 2, b.unlocked, {
        transport: { pull: async (s, l, sig) => tamper(await base.pull(s, l, sig)), push: base.push },
      });
      await c.engine.syncNow();
      expect(c.status.getSnapshot()).toMatchObject({ state: 'error', error: { code: 'server_error' } });
      expect(c.tracker.state.get('cursor') ?? '0').toBe('0');
      expect(notes(c)).toEqual([]);
    }
    await b.engine.syncNow();
    expect(notes(b).map((n) => n.content)).toEqual(['one', 'two']);
  });

  it('H2: after "start over" on A, both devices re-upload under the new account; a third sees the union once', async () => {
    const { server, a, b } = pair();
    addNote(a, 'from A');
    a.db.execute("INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES ('ext.m', 'k', '\"v\"', 1)");
    await a.engine.syncNow();
    addNote(b, 'from B');
    await b.engine.syncNow();
    await a.engine.syncNow();
    addNote(b, 'B offline');                                    // never reached the old server
    const oldKv = recordIdOf(b, 'ext.kv', 'ext.m\u001fk');

    // A: start over (server wiped, new account id + record-id key), then the app restarts (no in-memory flag).
    server.wipe();
    const u2 = otherAccount(777);
    const a2 = reopenDevice(server, a, 1, u2);
    await a2.engine.syncNow();
    expect(a2.tracker.pendingCount()).toBe(0);
    expect(server.rows.size).toBe(3);                           // A's two notes + the kv entry
    const newKv = recordIdOf(a2, 'ext.kv', 'ext.m\u001fk');
    expect(newKv).not.toBe(oldKv);                              // re-derived under the new record-id key

    // B signs in with the new material.
    const b2 = reopenDevice(server, b, 2, cloneAccount(u2));
    await b2.engine.syncNow();
    await a2.engine.syncNow();
    expect(b2.tracker.pendingCount()).toBe(0);
    expect(recordIdOf(b2, 'ext.kv', 'ext.m\u001fk')).toBe(newKv);

    const c = makeDevice(server, 3, cloneAccount(u2));
    await c.engine.syncNow();
    expect(notes(c).map((n) => n.content)).toEqual(['B offline', 'from A', 'from B']);
    expect(c.db.queryAll('SELECT key FROM extension_storage')).toHaveLength(1);
    for (const d of [a2, b2]) expect(notes(d).map((n) => n.content)).toEqual(['B offline', 'from A', 'from B']);
    expect(server.rows.size).toBe(4);
  });

  it('H2: the same account reopened does not re-upload; no stored account but synced rows does', async () => {
    const { server, a } = pair();
    addNote(a, 'x');
    await a.engine.syncNow();
    const calls = server.pushCalls.length;
    const again = reopenDevice(server, a, 1, cloneAccount(a.unlocked));
    expect(await again.engine.syncNow()).toMatchObject({ pushed: 0 });
    expect(server.pushCalls.length).toBe(calls);

    // A DB synced before the account check existed (no account_id) re-uploads once, as for a new account.
    a.db.execute("DELETE FROM sync_state WHERE key IN ('account_id', 'idk_fp', 'epoch_max')");
    server.wipe();
    const legacy = reopenDevice(server, a, 1, cloneAccount(a.unlocked));
    expect(await legacy.engine.syncNow()).toMatchObject({ pushed: 1 });
  });

  it('M4: an engine offered fewer key epochs than this DB has seen refuses to run', async () => {
    const { server, u, a } = pair();
    addNote(a, 'x');
    await a.engine.syncNow();
    const rotated = cloneAccount(u);
    rotated.dataKeys.set(2, seededRandom(2024).bytes(32));
    rotated.currentEpoch = 2;
    const a2 = reopenDevice(server, a, 1, rotated);
    await a2.engine.syncNow();
    expect(a2.tracker.state.get('epoch_max')).toBe('2');
    const pulls = server.pullCalls;
    const rolledBack = reopenDevice(server, a, 1, cloneAccount(u));
    await rolledBack.engine.syncNow();
    expect(rolledBack.status.getSnapshot()).toMatchObject({ state: 'error', error: { code: 'crypto' } });
    expect(server.pullCalls).toBe(pulls);
  });
});
