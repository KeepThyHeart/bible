/** W4-D: the real core sync client against the real sync server (see world.ts). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sync } from '@bible/core';
import { Device, PASSWORD, PASSWORD2, PASSWORD3, mailTo, serverCounts, startNet, twoDevices, type Net } from './world';

let net: Net;
beforeEach(async () => { net = await startNet(); });
afterEach(async () => { await net.close(); });

const T = 120_000;

describe('core sync client <-> sync server', () => {
  it('sign-up, verify, second device sign-in, edits flow both ways (note + verse link + highlight)', async () => {
    const { a, b } = await twoDevices(net);
    expect(a.status.getSnapshot().state).toBe('idle');
    expect(b.status.getSnapshot().state).toBe('idle');

    const noteId = a.addNote('first note');
    a.sql.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (?, 1001001, 1001002)', [noteId]);
    a.sql.execute("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (1, 1001001, 1001001, '#ffff00')");
    await a.sync();
    const rb = await b.sync();
    expect(rb.pulled).toBeGreaterThanOrEqual(3);
    expect(b.notes().map((n) => n.content)).toEqual(['first note']);
    const link = b.sql.queryOne<{ note_id: number; verse_id_start: number; verse_id_end: number }>('SELECT * FROM note_verse_link')!;
    expect(link).toMatchObject({ note_id: b.notes()[0].note_id, verse_id_start: 1001001, verse_id_end: 1001002 });
    expect(b.sql.queryAll('SELECT module_id, color FROM user_text_markup')).toEqual([{ module_id: 1, color: '#ffff00' }]);

    // B edits and adds; A receives.
    b.setContent(b.notes()[0].note_id, 'first note edited on B');
    b.addNote('note from B');
    await b.sync();
    await a.sync();
    expect(a.notes().map((n) => n.content)).toEqual(['first note edited on B', 'note from B']);
    expect(a.tracker.pendingCount() + b.tracker.pendingCount()).toBe(0);
    expect(a.status.getSnapshot().state).toBe('idle');
    // The server only ever stores ciphertext records: three + one edit + one new = 4 live records plus links.
    expect(serverCounts(net).record).toBeGreaterThanOrEqual(4);
  }, T);

  it('concurrent note edit leaves a conflict copy on both devices', async () => {
    const { a, b } = await twoDevices(net);
    const id = a.addNote('base');
    await a.sync();
    await b.sync();
    const bId = b.notes()[0].note_id;
    const t = Date.now();
    a.setContent(id, 'from A');
    b.setContent(bId, 'from B');
    a.setChangedMs('user_note', id, t + 1000);
    b.setChangedMs('user_note', bId, t + 2000);
    await a.sync();
    const rb = await b.sync();
    expect(rb.conflicts).toBe(1);
    expect(rb.conflictCopies).toBe(1);
    await a.sync();
    for (const d of [a, b]) {
      expect(d.notes().map((n) => n.content)).toEqual(['from A', 'from B']);
      expect(JSON.parse(d.notes().find((n) => n.content === 'from A')!.metadata!)).toHaveProperty('conflictOf');
      expect(d.tracker.pendingCount()).toBe(0);
    }
  }, T);

  it('a delete on A reaches B as a sealed tombstone stored by the server', async () => {
    const { a, b } = await twoDevices(net);
    const id = a.addNote('doomed');
    a.addNote('survivor');
    a.sql.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (?, 1001001, 1001001)', [id]);
    await a.sync();
    await b.sync();
    expect(b.notes()).toHaveLength(2);

    a.sql.execute('DELETE FROM user_note WHERE note_id = ?', [id]);
    const ra = await a.sync();
    expect(ra.pushed).toBeGreaterThanOrEqual(1);
    await b.sync();
    expect(b.notes().map((n) => n.content)).toEqual(['survivor']);
    expect(b.sql.queryAll('SELECT * FROM note_verse_link')).toEqual([]);
    const tombs = net.t.sql.queryAll<{ blob: Uint8Array | null }>('SELECT blob FROM record WHERE deleted = 1');
    expect(tombs.length).toBeGreaterThanOrEqual(1);
    for (const r of tombs) expect(r.blob && r.blob.length > 0).toBe(true);
    expect(a.status.getSnapshot().state).toBe('idle');
    expect(b.status.getSnapshot().state).toBe('idle');
  }, T);

  it('password change: old password refused, B (signed out by the change) signs in again and keeps syncing', async () => {
    const { a, b, email } = await twoDevices(net);
    a.addNote('before change');
    await a.sync();
    await b.sync();

    await a.account.changePassword(PASSWORD, PASSWORD2, true);
    await b.sync();
    expect(b.status.getSnapshot().state).toBe('locked');
    await expect(b.account.signIn(email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' });

    await b.account.signIn(email, PASSWORD2);
    expect(b.status.getSnapshot().state).toBe('idle');
    b.addNote('after change on B');
    await b.sync();
    await a.sync();
    expect(a.notes().map((n) => n.content)).toEqual(['after change on B', 'before change']);
    expect(b.notes()).toHaveLength(2);
    // A kept its session (signOutOthers only drops the others).
    expect(a.status.getSnapshot().state).toBe('idle');
  }, T);

  it('reset by email (start over) on A, then B signs in with the new material; B-only data reaches the server and A', async () => {
    const { a, b, email } = await twoDevices(net);
    a.addNote('old A note');
    await a.sync();
    await b.sync();
    expect(b.notes()).toHaveLength(1);

    const mailsBefore = net.t.mail.sent.length;
    await a.api.reset({ email });
    const { token } = await mailTo(net, email, /reset/i, mailsBefore);
    await a.account.startOver(token, PASSWORD2);
    expect(a.account.needsReencrypt).toBe(true);
    expect(a.status.getSnapshot().state).toBe('idle');
    await a.sync();   // re-uploads everything under the new keys

    // B's old session died with the reset.
    await b.sync();
    expect(b.status.getSnapshot().state).toBe('locked');
    b.addNote('B only (while locked)');
    await expect(b.account.signIn(email, PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await b.account.signIn(email, PASSWORD2);
    await b.sync();
    await a.sync();
    await b.sync();

    for (const d of [a, b]) {
      expect(d.notes().map((n) => n.content)).toEqual(['B only (while locked)', 'old A note']);
      expect(d.tracker.pendingCount()).toBe(0);
      expect(d.status.getSnapshot().state).toBe('idle');
    }
    expect(serverCounts(net).record).toBe(2);
  }, T);

  it('revoking device B makes its next sync locked', async () => {
    const { a, b } = await twoDevices(net);
    a.addNote('x');
    await a.sync();
    await b.sync();
    const { devices } = await a.api.devices();
    expect(devices.map((d) => d.id).sort()).toEqual([a.deviceId, b.deviceId].sort());
    await a.api.revokeDevice(b.deviceId);
    await b.sync();
    expect(b.status.getSnapshot().state).toBe('locked');
    b.addNote('after revoke');
    await b.sync();
    expect(b.status.getSnapshot().state).toBe('locked');
    await a.sync();
    expect(a.status.getSnapshot().state).toBe('idle');
    expect(a.notes().map((n) => n.content)).toEqual(['x']);
  }, T);

  it('deleting the account locks the other device, signs this one out and empties the server', async () => {
    const { a, b, email } = await twoDevices(net);
    a.addNote('gone soon');
    await a.sync();
    await b.sync();
    expect(serverCounts(net).account).toBe(1);

    await expect(a.account.deleteAccount(PASSWORD2)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await a.account.deleteAccount(PASSWORD);
    expect(a.status.getSnapshot().state).toBe('signed-out');
    expect(a.wiped).toBe(true);
    await b.sync();
    expect(b.status.getSnapshot().state).toBe('locked');
    expect(serverCounts(net)).toEqual({ account: 0, keyset: 0, device: 0, session: 0, record: 0, email_token: 0 });
    await expect(b.account.signIn(email, PASSWORD)).rejects.toBeInstanceOf(Sync.AccountError);
  }, T);

  it('recovery code sign-in on a new device, then sync works (extra: recover route)', async () => {
    const { a } = await twoDevices(net);
    const email = a.status.getSnapshot().accountEmail!;
    const c = new Device(net, 0xc3);
    const { recoveryCode } = await a.account.regenerateRecoveryCode(PASSWORD);
    a.addNote('for C');
    await a.sync();
    await c.account.signInWithRecoveryCode(email, recoveryCode, PASSWORD3);
    await c.sync();
    expect(c.notes().map((n) => n.content)).toEqual(['for C']);
  }, T);
});
