/** W4-D: more end-to-end scenarios for the real core sync client against the real sync server (see world.ts). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sync } from '@bible/core';
import {
  CONSENT, Device, PASSWORD, PASSWORD2, count, freshEmail, mailTo, moduleMap, recordsByAccount, serverCounts, startNet,
  twoDevices, type Net,
} from './world';

let net: Net;
beforeEach(async () => { net = await startNet(); });
afterEach(async () => { await net.close(); });
const T = 120_000;
const pendingRows = (d: Device): number => count(d, 'sync_pending');
const opaqueRows = (d: Device): number => count(d, 'sync_opaque');

describe('delete vs concurrent edit (scenario 1)', () => {
  // A deletes, B edits the same note. The later change wins on every device, whichever device syncs first.
  for (const [deleteNewer, syncFirst] of [[true, 'A'], [true, 'B'], [false, 'A'], [false, 'B']] as const) {
    it(`${deleteNewer ? 'delete newer than edit' : 'edit newer than delete'}, ${syncFirst} syncs first`, async () => {
      const { a, b } = await twoDevices(net);
      const id = a.addNote('base');
      await a.sync();
      await b.sync();
      const bId = b.notes()[0].note_id;
      const t = Date.now();
      a.sql.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
      b.setContent(bId, 'edited on B');
      a.setChangedMs('user_note', id, t + (deleteNewer ? 4000 : 1000));
      b.setChangedMs('user_note', bId, t + (deleteNewer ? 1000 : 4000));
      const [first, second] = syncFirst === 'A' ? [a, b] : [b, a];
      await first.sync();
      await second.sync();
      await a.sync();
      await b.sync();
      await a.sync();
      for (const d of [a, b]) {
        expect(d.notes().map((n) => n.content)).toEqual(deleteNewer ? [] : ['edited on B']);
        expect(d.tracker.pendingCount()).toBe(0);
        expect(d.status.getSnapshot().state).toBe('idle');
      }
    }, T);
  }
});

describe('offline catch-up (scenario 2)', () => {
  it('B comes back after 1000 changes on A and pulls them page by page (pageSize 100)', async () => {
    const email = freshEmail();
    const a = new Device(net, 0xa1);
    const b = new Device(net, 0xb2, { pageSize: 100 });
    await a.account.signUp(email, PASSWORD, CONSENT);
    await a.api.verifyEmail({ token: (await mailTo(net, email, /Confirm/i)).token });
    await b.account.signIn(email, PASSWORD);
    a.addNote('seed');
    await a.sync();
    await b.sync();

    b.offline = true;
    b.addNote('written offline');
    const off = await b.sync();
    expect(off.pushed).toBe(0);
    expect(b.status.getSnapshot().state).toBe('offline');
    expect(b.tracker.pendingCount()).toBe(1);

    a.sql.transaction(() => { for (let i = 0; i < 1000; i++) a.addNote(`bulk ${String(i).padStart(4, '0')}`); });
    await a.sync();
    expect(count(a, 'user_note')).toBe(1001);

    b.offline = false;
    b.requests.length = 0;
    const r = await b.sync();
    expect(r.pulled).toBe(1000);
    expect(r.pushed).toBe(1);
    expect(b.requests.filter((q) => q.includes('/changes')).length).toBeGreaterThanOrEqual(10);
    expect(count(b, 'user_note')).toBe(1002);
    expect(b.status.getSnapshot().state).toBe('idle');
    await a.sync();
    expect(count(a, 'user_note')).toBe(1002);
    expect(b.tracker.pendingCount() + a.tracker.pendingCount()).toBe(0);
  }, T);
});

describe('password change without signing others out (scenario 3)', () => {
  it('B keeps its session and keeps syncing; the new password works, the old one does not', async () => {
    const { a, b, email } = await twoDevices(net);
    a.addNote('before');
    await a.sync();
    await b.sync();
    await a.account.changePassword(PASSWORD, PASSWORD2, false);
    b.addNote('from B after change');
    await b.sync();
    expect(b.status.getSnapshot().state).toBe('idle');
    await a.sync();
    expect(a.notes().map((n) => n.content)).toEqual(['before', 'from B after change']);
    a.addNote('from A after change');
    await a.sync();
    await b.sync();
    expect(b.notes()).toHaveLength(3);
    const c = new Device(net, 0xc3);
    await expect(c.account.signIn(email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await c.account.signIn(email, PASSWORD2);
    await c.sync();
    expect(c.notes()).toHaveLength(3);
  }, T);
});

describe('key rotation (scenario 4)', () => {
  it('A rotates and re-encrypts; B is signed out, signs in again and follows; old blobs are gone from the server', async () => {
    const { a, b, email } = await twoDevices(net);
    for (let i = 0; i < 5; i++) a.addNote(`n${i}`);
    await a.sync();
    await b.sync();
    const oldBlobs = new Set(net.t.sql.queryAll<{ blob: Uint8Array }>('SELECT blob FROM record').map((r) => Buffer.from(r.blob).toString('hex')));
    expect(oldBlobs.size).toBe(5);

    await a.account.rotateKeys(PASSWORD);
    expect(a.account.consumeReencrypt()).toBe(true);
    const re = await a.engine!.reencryptAll();
    expect(re.pushed).toBe(5);
    expect(a.status.getSnapshot().state).toBe('idle');
    const nowBlobs = net.t.sql.queryAll<{ blob: Uint8Array }>('SELECT blob FROM record').map((r) => Buffer.from(r.blob).toString('hex'));
    expect(nowBlobs).toHaveLength(5);
    for (const h of nowBlobs) expect(oldBlobs.has(h)).toBe(false);
    expect(net.t.sql.queryOne<{ n: number }>('SELECT current_epoch AS n FROM account')!.n).toBe(1);

    await b.sync();
    expect(b.status.getSnapshot().state).toBe('locked');
    await b.account.signIn(email, PASSWORD);
    b.addNote('from B after rotation');
    await b.sync();
    await a.sync();
    expect(a.notes()).toHaveLength(6);
    expect(b.notes()).toHaveLength(6);
    expect(b.tracker.pendingCount() + a.tracker.pendingCount()).toBe(0);
    expect(opaqueRows(b) + opaqueRows(a)).toBe(0);
  }, T);
});

describe('memory tables across pages (scenario 5)', () => {
  it('children that arrive before their parents wait and are applied once the parents come (pageSize 2)', async () => {
    const email = freshEmail();
    const a = new Device(net, 0xa1);
    const b = new Device(net, 0xb2, { pageSize: 2 });
    await a.account.signUp(email, PASSWORD, CONSENT);
    await a.api.verifyEmail({ token: (await mailTo(net, email, /Confirm/i)).token });
    await b.account.signIn(email, PASSWORD);

    const col = a.sql.execute("INSERT INTO memory_collection (name, created_at) VALUES ('Psalms', 1)").lastInsertRowId!;
    for (let p = 0; p < 3; p++) {
      const pid = a.sql.execute(
        "INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at) VALUES (?, 'KJV', ?, ?, 'ref', 1, 1)",
        [col, 19023001 + p, 19023001 + p]).lastInsertRowId!;
      for (const rung of ['r1', 'r2']) {
        const cid = a.sql.execute("INSERT INTO memory_card (passage_id, rung, state) VALUES (?, ?, 'new')", [pid, rung]).lastInsertRowId!;
        a.sql.execute('INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps) VALUES (?, 5, 0.5, 1, 2)', [cid]);
      }
    }
    await a.sync();
    expect(serverCounts(net).record).toBe(1 + 3 + 6 + 6);
    // Reverse the server's order so every child is pulled before its parent.
    net.t.sql.execute('UPDATE record SET seq = 1000 - seq');

    const r = await b.sync();
    expect(r.pulled).toBe(16);
    expect(pendingRows(b)).toBe(0);
    for (const t of ['memory_collection', 'memory_passage', 'memory_card', 'memory_attempt']) expect(count(b, t)).toBe(count(a, t));
    expect(b.sql.queryAll('PRAGMA foreign_key_check')).toEqual([]);
    expect(b.sql.queryAll(`SELECT p.module_id, p.start_verse_id, c.rung FROM memory_card c JOIN memory_passage p ON p.id = c.passage_id ORDER BY 2, 3`))
      .toEqual(a.sql.queryAll(`SELECT p.module_id, p.start_verse_id, c.rung FROM memory_card c JOIN memory_passage p ON p.id = c.passage_id ORDER BY 2, 3`));
    expect(b.status.getSnapshot().state).toBe('idle');
    expect(b.tracker.pendingCount()).toBe(0);
  }, T);
});

describe('module references (scenario 6)', () => {
  it('KJV maps to local id 1 on A and 7 on B; an uninstalled module waits (portable) and is applied once installed', async () => {
    const ma = moduleMap({ 1: 'KJV', 2: 'ESV' });
    const mb = moduleMap({ 7: 'KJV' });
    const email = freshEmail();
    const a = new Device(net, 0xa1, { modules: ma });
    const b = new Device(net, 0xb2, { modules: mb });
    await a.account.signUp(email, PASSWORD, CONSENT);
    await a.api.verifyEmail({ token: (await mailTo(net, email, /Confirm/i)).token });
    await b.account.signIn(email, PASSWORD);

    a.sql.execute("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (1, 1001001, 1001001, '#ffff00')");
    a.sql.execute("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (2, 1001002, 1001002, '#00ff00')");
    await a.sync();
    await b.sync();
    expect(b.sql.queryAll('SELECT module_id, color FROM user_text_markup')).toEqual([{ module_id: 7, color: '#ffff00' }]);
    expect(pendingRows(b)).toBe(1);
    expect(b.tracker.pendingCount()).toBe(0);   // nothing was lost or re-pushed as something else

    // Nothing B does disturbs the waiting record; the server still holds both highlights.
    b.sql.execute("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (7, 1001003, 1001003, '#ff0000')");
    await b.sync();
    expect(pendingRows(b)).toBe(1);
    expect(serverCounts(net).record).toBe(3);

    mb.map[9] = 'ESV';   // the user installs ESV on B (local id 9)
    await b.sync();
    expect(pendingRows(b)).toBe(0);
    expect(b.sql.queryAll('SELECT module_id, color FROM user_text_markup ORDER BY verse_id_start')).toEqual([
      { module_id: 7, color: '#ffff00' }, { module_id: 9, color: '#00ff00' }, { module_id: 7, color: '#ff0000' },
    ]);
    await a.sync();
    expect(a.sql.queryAll('SELECT module_id, color FROM user_text_markup ORDER BY verse_id_start')).toEqual([
      { module_id: 1, color: '#ffff00' }, { module_id: 2, color: '#00ff00' }, { module_id: 1, color: '#ff0000' },
    ]);
    expect(a.tracker.pendingCount() + b.tracker.pendingCount()).toBe(0);
  }, T);

  it.todo('scenario 7: extension KV opt-in (extension_storage stays local until the extension is opted in) - needs subtask E');
});

describe('opaque kinds (scenario 8)', () => {
  const xTable = 'CREATE TABLE IF NOT EXISTS x_test (k TEXT PRIMARY KEY, v TEXT NOT NULL)';
  const codec: Sync.RecordCodec = {
    type: 'x.test', kind: 'x.test', version: 1,
    encode(localKey, ctx) {
      const r = ctx.sql.queryOne<{ k: string; v: string }>('SELECT k, v FROM x_test WHERE k = ?', [localKey]);
      return r ? { k: r.k, v: r.v } : null;
    },
    decode(d) {
      if (typeof d.k !== 'string' || typeof d.v !== 'string') throw new Sync.RecordDecodeError('x.test: malformed');
      return { ok: true, row: { k: d.k, v: d.v } };
    },
    upsert(row, _key, ctx) {
      ctx.sql.execute('INSERT INTO x_test (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', [row.k as string, row.v as string]);
      return row.k as string;
    },
    remove(key, ctx) { ctx.sql.execute('DELETE FROM x_test WHERE k = ?', [key]); },
  };
  const tracked: Sync.TrackedTable[] = [{ table: 'x_test', pk: ['k'], kind: 'x.test' }];

  it('an unknown record kind is kept untouched and applied later when this device learns the kind', async () => {
    const email = freshEmail();
    const a = new Device(net, 0xa1, { extraCodecs: [codec], trackedExtra: tracked });
    // The table must exist before the tracker installs triggers: create it, then re-install.
    a.sql.execute(xTable);
    a.tracker.install(tracked);
    await a.account.signUp(email, PASSWORD, CONSENT);
    await a.api.verifyEmail({ token: (await mailTo(net, email, /Confirm/i)).token });
    const b = new Device(net, 0xb2);
    await b.account.signIn(email, PASSWORD);

    a.sql.execute("INSERT INTO x_test (k, v) VALUES ('one', 'first')");
    a.addNote('plain note');
    await a.sync();
    expect(serverCounts(net).record).toBe(2);

    const rb = await b.sync();
    expect(rb.opaque).toBe(1);
    expect(opaqueRows(b)).toBe(1);
    expect(b.status.getSnapshot().opaque).toBe(1);
    expect(b.notes().map((n) => n.content)).toEqual(['plain note']);
    const again = await b.sync();
    expect(again.pushed).toBe(0);                 // never pushed back, never deleted on the server
    expect(serverCounts(net).record).toBe(2);

    // B learns the kind (an app upgrade / installed extension): a new engine retries the opaque record.
    b.sql.execute(xTable);
    b.rebuildEngine({ extraCodecs: [codec], trackedExtra: tracked });
    await b.sync();
    expect(opaqueRows(b)).toBe(0);
    expect(b.sql.queryAll('SELECT k, v FROM x_test')).toEqual([{ k: 'one', v: 'first' }]);
    // And it now syncs both ways.
    b.sql.execute("UPDATE x_test SET v = 'second' WHERE k = 'one'");
    await b.sync();
    await a.sync();
    expect(a.sql.queryAll('SELECT k, v FROM x_test')).toEqual([{ k: 'one', v: 'second' }]);
  }, T);
});

describe('ask for the password each launch (scenario 9)', () => {
  it('a restart with an empty secret store is locked; signing in again re-uploads nothing', async () => {
    const { a, email } = await twoDevices(net);
    for (let i = 0; i < 4; i++) a.addNote(`keep ${i}`);
    await a.sync();
    const before = net.t.sql.queryAll<{ id: string; seq: number }>('SELECT id, seq FROM record ORDER BY seq');
    expect(before).toHaveLength(4);

    // App restart: same user DB (and device id), memory store is empty.
    const a2 = new Device(net, 0xa1, { sql: a.sql });
    expect(await a2.account.resume()).toBeNull();
    expect(a2.status.getSnapshot().state).toBe('locked');
    expect(a2.engine).toBeNull();
    a2.addNote('written while locked');

    await a2.account.signIn(email, PASSWORD);
    expect(a2.status.getSnapshot().state).toBe('idle');
    const r = await a2.sync();
    expect(r.pushed).toBe(1);      // only the new note, not the four already synced
    expect(r.pulled).toBeLessThanOrEqual(5);
    const after = net.t.sql.queryAll<{ id: string; seq: number }>('SELECT id, seq FROM record ORDER BY seq');
    expect(after.slice(0, 4)).toEqual(before);
    expect(after).toHaveLength(5);
    expect(a2.tracker.pendingCount()).toBe(0);
    const r2 = await a2.sync();
    expect(r2.pushed).toBe(0);
  }, T);
});

describe('account switch (scenario 10)', () => {
  it('another account on the same user DB re-uploads under the new keys; the old account and its devices see nothing', async () => {
    const { a: x1, b: x2 } = await twoDevices(net);
    x1.addNote('belongs to X');
    await x1.sync();
    await x2.sync();
    const xCounts = recordsByAccount(net);
    const xId = Object.keys(xCounts)[0];

    await x1.account.signOut({ wipeLocal: false });
    expect(x1.status.getSnapshot().state).toBe('signed-out');
    const emailY = freshEmail();
    await x1.account.signUp(emailY, PASSWORD2, CONSENT);
    await x1.api.verifyEmail({ token: (await mailTo(net, emailY, /Confirm/i)).token });
    x1.addNote('added after the switch');
    const r = await x1.sync();
    expect(r.pushed).toBe(2);       // everything on the device goes up under the new account
    const after = recordsByAccount(net);
    expect(after[xId]).toBe(xCounts[xId]);
    const yId = Object.keys(after).find((k) => k !== xId)!;
    expect(after[yId]).toBe(2);
    expect(pendingRows(x1) + opaqueRows(x1)).toBe(0);

    // X's other device never sees anything of Y, and X's server data is untouched.
    await x2.sync();
    expect(x2.notes().map((n) => n.content)).toEqual(['belongs to X']);
    expect(recordsByAccount(net)[xId]).toBe(xCounts[xId]);

    // A fresh device of Y gets exactly what the switched device holds.
    const y2 = new Device(net, 0xd4);
    await y2.account.signIn(emailY, PASSWORD2);
    await y2.sync();
    expect(y2.notes().map((n) => n.content)).toEqual(['added after the switch', 'belongs to X']);
  }, T);

  it.todo('scenario 11: backup 1.1 (account slot wraps the key, restore on a signed-in device re-attaches) - needs subtask C');
});

describe('storage quota (scenario 12)', () => {
  it('records over the quota stay local with a quota error; freeing room lets them upload', async () => {
    await net.close();
    net = await startNet({ quotaBytes: 12_000 });
    const { a, b } = await twoDevices(net);
    for (let i = 0; i < 30; i++) a.addNote(`note ${i}`);
    const r1 = await a.sync();
    expect(r1.pushed).toBeGreaterThan(0);
    expect(r1.pushed).toBeLessThan(30);
    expect(a.status.getSnapshot().state).toBe('error');
    expect(a.status.getSnapshot().error?.code).toBe('quota_exceeded');
    expect(a.tracker.pendingCount()).toBe(30 - r1.pushed);
    expect(count(a, 'user_note')).toBe(30);        // nothing is deleted locally
    await b.sync();
    expect(count(b, 'user_note')).toBe(r1.pushed);

    net.t.sql.execute('UPDATE account SET quota_bytes = 10000000');
    a.rebuildEngine();                              // a failed record is retried per engine instance
    const r2 = await a.sync();
    expect(r2.pushed).toBe(30 - r1.pushed);
    expect(a.status.getSnapshot().state).toBe('idle');
    expect(a.tracker.pendingCount()).toBe(0);
    await b.sync();
    expect(count(b, 'user_note')).toBe(30);
  }, T);
});

describe('email not verified (scenario 13)', () => {
  it('uploads wait with an email_unverified error; after verifying they go up', async () => {
    const email = freshEmail();
    const a = new Device(net, 0xa1);
    await a.account.signUp(email, PASSWORD, CONSENT);
    a.addNote('early note');
    const r1 = await a.sync();
    expect(r1.pushed).toBe(0);
    expect(a.status.getSnapshot().state).toBe('error');
    expect(a.status.getSnapshot().error?.code).toBe('email_unverified');
    expect(a.tracker.pendingCount()).toBe(1);
    expect(serverCounts(net).record).toBe(0);

    await a.api.verifyEmail({ token: (await mailTo(net, email, /Confirm/i)).token });
    const r2 = await a.sync();
    expect(r2.pushed).toBe(1);
    expect(a.status.getSnapshot().state).toBe('idle');
    expect(a.status.getSnapshot().error).toBeUndefined();
    expect(serverCounts(net).record).toBe(1);
    expect(a.tracker.pendingCount()).toBe(0);
  }, T);
});
