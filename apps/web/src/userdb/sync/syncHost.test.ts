// @vitest-environment node
/**
 * Integration tests for the web sync host (design §6): the real sync server in-process, "browsers" with their own
 * cookie jar, IndexedDB and Origin, each with real user-DB workers (createUserDbHandler + createSyncHost over an
 * in-memory sqlite-wasm database), manual timers and the Argon2id floor. See `__testing__/syncWorld.ts`.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The server package's dist may be older than its source: run the source. Its only runtime core imports are the
// `Crypto` and `Sync` namespaces, which the browser barrel (aliased to core source) provides.
vi.mock('@bible/sync-server', async () => await import('../../../../../packages/sync-server/src/index'));
vi.mock('@bible/core', async () => {
  const b = await import('@bible/core/browser');
  return { Crypto: b.Crypto, Sync: b.Sync };
});

import { Crypto, Sync } from '@bible/core/browser';
import { IndexedDbSecretStore } from '../IndexedDbSecretStore';
import type { UserDbRequest } from '../protocol';
import { deviceNameFromUserAgent, sanitizeSyncError } from './syncHost';
import {
  CONSENT, PASSWORD, WRONG_PASSWORD, WireFailure, createBrowser, findSecrets, freshEmail, idbNames, loadSqlite,
  rawSecretRecords, seedLegacyUserData, serverRecordCount, signUpVerified, startWorker, startWorld, until,
  type Browser, type Sqlite3, type World,
} from './__testing__/syncWorld';

let sqlite3: Sqlite3;
beforeAll(async () => { sqlite3 = await loadSqlite(); }, 60_000);

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});
async function setup(): Promise<World> {
  world = await startWorld(sqlite3);
  return world;
}

const T = 60_000;
/** States of an unlocked session (a freshly started engine syncs at once). */
const UNLOCKED = ['idle', 'syncing'];

async function failure(p: Promise<unknown>): Promise<WireFailure> {
  const r = await p.then(() => null, (e: unknown) => e);
  if (!(r instanceof WireFailure)) throw new Error(`expected a wire failure, got ${String(r)}`);
  return r;
}

function addNote(sql: Sync.ISql, content: string): number {
  return sql.execute('INSERT INTO user_note (title, content) VALUES (?, ?)', ['t', content]).lastInsertRowId!;
}
function noteContents(sql: Sync.ISql): string[] {
  return sql.queryAll<{ content: string }>('SELECT content FROM user_note ORDER BY content').map((r) => r.content);
}
function markupModules(sql: Sync.ISql): Array<[number, number]> {
  return sql.queryAll<{ verse_id_start: number; module_id: number }>(
    'SELECT verse_id_start, module_id FROM user_text_markup ORDER BY verse_id_start',
  ).map((r) => [r.verse_id_start, r.module_id]);
}
const markup = (moduleId: number, verse: number) => ({ moduleId, verseIdStart: verse, verseIdEnd: verse, color: 'yellow' });

/** The keys this browser keeps in `kth-secrets` (remember on). */
async function storedKeys(b: Browser): Promise<Sync.UnlockedAccount> {
  const store = new IndexedDbSecretStore({ indexedDB: b.indexedDB });
  try {
    const blob = await store.get('sync.unlocked');
    if (!blob) throw new Error('no stored keys');
    return Sync.deserializeUnlocked(blob);
  } finally {
    store.close();
  }
}

/** The password's auth key and KEK, derived the way the client does (server KDF params via prelogin). */
async function passwordKeys(w: World, email: string, password: string): Promise<Sync.PasswordKeys> {
  const res = await fetch(`${w.origin}${Sync.SYNC_API_PREFIX}/prelogin`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: w.origin }, body: JSON.stringify({ email }),
  });
  const { kdf } = (await res.json()) as { kdf: Sync.KdfParamsJson };
  return Sync.derivePasswordKeys(password, Crypto.kdfParamsFromJson(kdf));
}

const setRemember = (w: { request(r: UserDbRequest): Promise<unknown> }, remember: boolean) =>
  w.request({ op: 'sync', action: 'setRemember', remember });

describe('web sync host (integration)', () => {
  it('signUp answers only { recoveryCode }; a second browser signs in and both see each other\'s notes', async () => {
    const w = await setup();
    const a = startWorker(sqlite3, createBrowser(w, 'A'));
    const b = startWorker(sqlite3, createBrowser(w, 'B'));
    const email = freshEmail();

    const res = await signUpVerified(w, a, email);
    expect(Object.keys(res as object)).toEqual(['recoveryCode']);
    expect((res as { recoveryCode: string }).recoveryCode).toMatch(/^[0-9A-Z-]{32,}$/);

    addNote(await a.sql(), 'from A');
    await a.sync('syncNow');

    await b.configure();
    expect(await b.account('signIn', email, PASSWORD)).toBeNull();
    await b.sync('syncNow');
    expect(noteContents(await b.sql())).toEqual(['from A']);
    expect(b.events.some((e) => e.event === 'changed' && e.tables.includes('user_note'))).toBe(true);

    addNote(await b.sql(), 'from B');
    await b.sync('syncNow');
    await a.sync('syncNow');
    expect(noteContents(await a.sql())).toEqual(['from A', 'from B']);
    expect(a.events.some((e) => e.event === 'changed' && e.tables.includes('user_note'))).toBe(true);
  }, T);

  it('emits syncStatus events (signed-out -> idle with the email -> lastSyncedAt) and status answers the snapshot', async () => {
    const w = await setup();
    const a = startWorker(sqlite3, createBrowser(w, 'A'));
    const email = freshEmail();
    expect((await a.configure()).state).toBe('signed-out');
    await signUpVerified(w, a, email);
    await a.sync('syncNow');

    const states = a.statusEvents();
    expect(states[0].state).toBe('signed-out');
    expect(states.some((s) => s.state === 'idle' && s.accountEmail === email)).toBe(true);
    expect(states.some((s) => s.state === 'syncing')).toBe(true);
    const status = (await a.sync('status')) as Sync.SyncStatus;
    expect(status).toMatchObject({ state: 'idle', accountEmail: email });
    expect(status.lastSyncedAt).toEqual(expect.any(String));
    expect(states[states.length - 1]).toEqual(status);
  }, T);

  it('nothing the host returns or emits carries the account key, record-id key, data keys, KEK, auth key or password', async () => {
    const w = await setup();
    const browserA = createBrowser(w, 'A');
    const a = startWorker(sqlite3, browserA);
    const browserB = createBrowser(w, 'B');
    const b = startWorker(sqlite3, browserB);
    const email = freshEmail();

    await signUpVerified(w, a, email);
    addNote(await a.sql(), 'secret-free note');
    await a.sync('syncNow');
    expect(await a.account('resume')).toEqual({ resumed: true });
    await a.api('info');
    await a.api('account');
    await a.api('setDeviceName', { name: 'Kitchen laptop' });
    const devices = (await a.api('devices')) as { devices: Array<{ name: string; current: boolean }> };
    expect(devices.devices.find((d) => d.current)?.name).toBe('Kitchen laptop');
    await a.api('exportAll');
    await a.account('regenerateRecoveryCode', PASSWORD);
    await a.sync('status');

    // A new leader (same DB, same IndexedDB) resumes from the remembered keys.
    const a2 = startWorker(sqlite3, browserA);
    expect(UNLOCKED).toContain(((await a2.sync('status')) as Sync.SyncStatus).state);
    expect(await a2.account('resume')).toEqual({ resumed: true });

    await b.configure();
    await failure(b.account('signIn', email, WRONG_PASSWORD));
    await b.account('signIn', email, PASSWORD);
    await b.sync('syncNow');

    const keys = await storedKeys(browserA);
    const pw = await passwordKeys(w, email, PASSWORD);
    const secrets: Record<string, Uint8Array | string> = {
      accountKey: keys.accountKey, recordIdKey: keys.recordIdKey, kek: pw.kek, authKey: pw.authKey,
      password: PASSWORD, wrongPassword: WRONG_PASSWORD,
    };
    for (const [epoch, k] of keys.dataKeys) secrets[`dataKey${epoch}`] = k;
    expect(browserA.seen.length).toBeGreaterThan(20);
    expect(findSecrets(browserA.seen, secrets)).toEqual([]);
    expect(findSecrets(browserB.seen, secrets)).toEqual([]);
    // The scan itself finds what it looks for (raw bytes, an encoding, a string).
    const probe = findSecrets(
      [{ x: [new Uint8Array(keys.accountKey)] }, { y: Buffer.from(pw.kek).toString('base64url') }, `..${PASSWORD}..`], secrets);
    expect(new Set(probe.map((h) => h.split(': ')[1]))).toEqual(new Set(['accountKey (bytes)', 'kek', 'password']));
  }, T);

  it('signOut({ wipeLocal: true }) wipes the database, kth-secrets and kth-user-data; the engine is gone until the next sign-in', async () => {
    const w = await setup();
    const browser = createBrowser(w, 'A');
    const a = startWorker(sqlite3, browser);
    const email = freshEmail();
    await seedLegacyUserData(browser.indexedDB);
    await signUpVerified(w, a, email);
    addNote(await a.sql(), 'keep me on the server');
    await a.sync('syncNow');
    expect(await idbNames(browser.indexedDB)).toEqual(expect.arrayContaining(['kth-secrets', 'kth-user-data']));
    expect(browser.cookies.size).toBe(1);

    expect(await a.account('signOut', { wipeLocal: true })).toBeNull();
    expect(a.wipes).toBe(1);
    expect(a.storeWipes).toBe(1);
    expect(await idbNames(browser.indexedDB)).not.toContain('kth-secrets');
    expect(await idbNames(browser.indexedDB)).not.toContain('kth-user-data');
    expect(browser.cookies.size).toBe(0);
    expect(a.events.some((e) => e.event === 'changed' && e.tables.includes('user_note'))).toBe(true);

    // A fresh database: no notes, signed out, still configured (the same server).
    expect(noteContents(await a.sql())).toEqual([]);
    expect((await a.sync('status')) as Sync.SyncStatus).toMatchObject({ state: 'signed-out' });
    expect(await a.sync('syncNow')).toBeNull();
    // No engine: a local write arms nothing.
    const before = a.timers.pending();
    await a.request({ op: 'call', repo: 'markup', method: 'create', args: [markup(1, 43003016)] });
    expect(a.timers.pending()).toBe(before);

    // Signing in again builds a new engine over the new database and pulls the data back.
    await a.account('signIn', email, PASSWORD);
    await a.sync('syncNow');
    expect(noteContents(await a.sql())).toEqual(['keep me on the server']);
  }, T);

  it('remember=false keeps kth-secrets empty and a new leader over the same DB comes up locked', async () => {
    const w = await setup();
    const browser = createBrowser(w, 'A');
    const a = startWorker(sqlite3, browser);
    const email = freshEmail();
    await signUpVerified(w, a, email, false);
    await a.sync('syncNow');
    expect(await rawSecretRecords(browser.indexedDB)).toEqual([]);
    expect(await idbNames(browser.indexedDB)).not.toContain('kth-secrets');

    const a2 = startWorker(sqlite3, browser);
    expect((await a2.sync('status')) as Sync.SyncStatus).toMatchObject({ state: 'locked', accountEmail: email });
    expect(await a2.account('resume')).toEqual({ resumed: false });
    expect(await a2.sync('syncNow')).toBeNull();
    await a2.account('signIn', email, PASSWORD);
    expect(((await a2.sync('status')) as Sync.SyncStatus).state).not.toBe('locked');
    expect(await idbNames(browser.indexedDB)).not.toContain('kth-secrets');
  }, T);

  it('remember=true resumes after a leader change and keeps syncing', async () => {
    const w = await setup();
    const browserA = createBrowser(w, 'A');
    const a = startWorker(sqlite3, browserA);
    const b = startWorker(sqlite3, createBrowser(w, 'B'));
    const email = freshEmail();
    await signUpVerified(w, a, email, true);
    await a.sync('syncNow');
    await b.configure();
    await b.account('signIn', email, PASSWORD);
    addNote(await b.sql(), 'after the handoff');
    await b.sync('syncNow');

    const a2 = startWorker(sqlite3, browserA);
    const resumed = (await a2.sync('status')) as Sync.SyncStatus;
    expect(UNLOCKED).toContain(resumed.state); // the new engine starts with a sync
    expect(resumed.accountEmail).toBe(email);
    await a2.sync('syncNow');
    expect(noteContents(await a2.sql())).toEqual(['after the handoff']);
  }, T);

  it('switching remember moves the keys in and out of IndexedDB; overlapping switches end with the last choice', async () => {
    const w = await setup();
    const browser = createBrowser(w, 'A');
    const a = startWorker(sqlite3, browser);
    const email = freshEmail();
    await signUpVerified(w, a, email, true);
    expect((await rawSecretRecords(browser.indexedDB)).length).toBeGreaterThan(0);

    await setRemember(a, false);
    expect((await rawSecretRecords(browser.indexedDB)).filter((k) => String(k).startsWith('value:'))).toEqual([]);
    expect(((await startWorker(sqlite3, browser).sync('status')) as Sync.SyncStatus).state).toBe('locked');

    await setRemember(a, true);
    expect(UNLOCKED).toContain(((await startWorker(sqlite3, browser).sync('status')) as Sync.SyncStatus).state);

    // Toggled twice in quick succession (both in flight at once): the second ("do not remember") wins.
    await setRemember(a, false);
    await Promise.all([setRemember(a, true), setRemember(a, false)]);
    expect((await rawSecretRecords(browser.indexedDB)).filter((k) => String(k).startsWith('value:'))).toEqual([]);
    expect(((await startWorker(sqlite3, browser).sync('status')) as Sync.SyncStatus).state).toBe('locked');
    // The session in this worker is still unlocked (keys in memory).
    expect(await a.account('resume')).toEqual({ resumed: true });
  }, T);

  it('configure never changes remember after the first one: a stale tab cannot persist keys against the choice', async () => {
    const w = await setup();
    const browser = createBrowser(w, 'A');
    const a = startWorker(sqlite3, browser);
    await signUpVerified(w, a, freshEmail(), false); // the first configure seeds remember=false
    expect((await rawSecretRecords(browser.indexedDB)).filter((k) => String(k).startsWith('value:'))).toEqual([]);

    // A tab that still believes remember=true re-sends configure (catalog change): the worker ignores it.
    await a.configure({ remember: true });
    await a.configure({ remember: true });
    expect((await rawSecretRecords(browser.indexedDB)).filter((k) => String(k).startsWith('value:'))).toEqual([]);
    expect(((await startWorker(sqlite3, browser).sync('status')) as Sync.SyncStatus).state).toBe('locked');

    // Only the explicit action changes it (and the reverse stale `false` cannot undo it).
    await setRemember(a, true);
    await a.configure({ remember: false });
    expect(UNLOCKED).toContain(((await startWorker(sqlite3, browser).sync('status')) as Sync.SyncStatus).state);
  }, T);

  it('a local write schedules a debounced push (untracked tables do not)', async () => {
    const w = await setup();
    const a = startWorker(sqlite3, createBrowser(w, 'A'), { engineDebounceMs: 1000 });
    await signUpVerified(w, a, freshEmail());
    await a.sync('syncNow');
    const n0 = serverRecordCount(w);

    const armed = a.timers.pending();
    a.host.notifyLocalChange(['setting', 'session']);
    expect(a.timers.pending()).toBe(armed);

    await a.request({ op: 'call', repo: 'markup', method: 'create', args: [markup(2, 43003016)] });
    expect(a.timers.pending()).toBe(armed + 1);
    a.timers.advance(999);
    await new Promise((r) => setTimeout(r, 50));
    expect(serverRecordCount(w)).toBe(n0);
    a.timers.advance(1);
    await until(() => serverRecordCount(w) > n0, 'the debounced push');
    expect(serverRecordCount(w)).toBe(n0 + 1);
  }, T);

  it('maps the same module abbreviation across different catalog ids on the two browsers', async () => {
    const w = await setup();
    const a = startWorker(sqlite3, createBrowser(w, 'A'));
    const b = startWorker(sqlite3, createBrowser(w, 'B'));
    const email = freshEmail();
    await signUpVerified(w, a, email);
    await b.configure({ modules: [{ id: 7, abbr: 'kjv' }, { id: 9, abbr: 'ESV' }, { id: 11, abbr: 'NIV' }] });
    await b.account('signIn', email, PASSWORD);

    await a.request({ op: 'call', repo: 'markup', method: 'create', args: [markup(1, 1001001)] });
    await a.request({ op: 'call', repo: 'markup', method: 'create', args: [markup(2, 1001002)] });
    await a.sync('syncNow');
    await b.sync('syncNow');
    expect(markupModules(await b.sql())).toEqual([[1001001, 7], [1001002, 9]]);

    await b.request({ op: 'call', repo: 'markup', method: 'create', args: [markup(9, 1001003)] });
    await b.sync('syncNow');
    await a.sync('syncNow');
    expect(markupModules(await a.sql())).toEqual([[1001001, 1], [1001002, 2], [1001003, 2]]);
  }, T);

  it('sanitises errors: wrong password -> invalid_credentials without echoing the input', async () => {
    const w = await setup();
    const a = startWorker(sqlite3, createBrowser(w, 'A'));
    const browserB = createBrowser(w, 'B');
    const b = startWorker(sqlite3, browserB);
    const email = freshEmail();

    expect((await failure(b.account('signIn', email, PASSWORD))).code).toBe('not_configured');
    await signUpVerified(w, a, email);
    await b.configure();

    const wrong = await failure(b.account('signIn', email, WRONG_PASSWORD));
    expect(wrong.wire).toMatchObject({ code: 'invalid_credentials', name: 'AccountError' });
    expect(wrong.message).not.toContain(WRONG_PASSWORD);
    expect(wrong.message).not.toContain(email);

    const weak = await failure(b.account('signUp', freshEmail(), 'password1', CONSENT));
    expect(weak.wire).toMatchObject({ code: 'weak_password', name: 'WeakPasswordError' });
    expect(weak.message).not.toContain('password1');

    const unknown = 'nope-' + WRONG_PASSWORD;
    expect((await failure(b.account(unknown))).wire).toMatchObject({ code: 'unknown_method' });
    expect((await failure(b.api(unknown))).wire).toMatchObject({ code: 'unknown_method' });
    expect((await failure(b.account('signUp', freshEmail(), PASSWORD, { terms: true }))).code).toBe('bad_request');
    expect((await failure(b.request({ op: 'sync', action: 'bogus' } as never))).code).toBe('unknown_method');
    expect(findSecrets(browserB.seen, { wrong: WRONG_PASSWORD, weak: 'password1' })).toEqual([]);

    // Anything unexpected becomes a fixed message.
    const err = sanitizeSyncError(new Error(`boom ${PASSWORD}`));
    expect(err).toMatchObject({ code: 'internal', message: 'Sync request failed' });
  }, T);

  it('accepts only a same-origin baseUrl and normalises it', async () => {
    const w = await setup();
    const a = startWorker(sqlite3, createBrowser(w, 'A'));
    for (const bad of ['https://evil.example', 'http://127.0.0.1:1', 'javascript:alert(1)', 'not a url', `${w.origin.replace('http', 'ws')}`]) {
      expect((await failure(a.configure({ baseUrl: bad }))).code).toBe('bad_request');
    }
    expect((await failure(a.request({ op: 'sync', action: 'configure', baseUrl: w.origin, remember: 'yes', modules: [] } as never))).code)
      .toBe('bad_request');
    await a.configure({ baseUrl: `${w.origin}/?q=1#x` });
    await a.account('signUp', freshEmail(), PASSWORD, CONSENT);
    expect(((await a.sync('status')) as Sync.SyncStatus).state).not.toBe('signed-out');
  }, T);

  it('a session cookie left by a logout that never reached the server does not expose the previous account', async () => {
    const w = await setup();
    const browser = createBrowser(w, 'A');
    const a = startWorker(sqlite3, browser);
    const b = startWorker(sqlite3, createBrowser(w, 'B'));
    const email = freshEmail();
    await signUpVerified(w, a, email);
    await b.configure();
    await b.account('signIn', email, PASSWORD);
    const devices = (await b.api('devices')) as { devices: Array<{ id: string; current: boolean }> };
    const other = devices.devices.find((d) => !d.current)!;

    browser.blocked.add('/logout');
    await a.account('signOut', { wipeLocal: false });
    expect(browser.cookies.size).toBe(1); // the server session is still alive
    expect((await failure(a.api('account'))).code).toBe('not_signed_in');
    expect((await failure(a.api('revokeDevice', other.id))).code).toBe('not_signed_in');
    expect((await failure(a.api('devices'))).code).toBe('not_signed_in');
    expect((await failure(a.api('exportAll'))).code).toBe('not_signed_in');
  }, T);

  it('resume reports false once the server has dropped the session (locked by a 401)', async () => {
    const w = await setup();
    const browser = createBrowser(w, 'A');
    const a = startWorker(sqlite3, browser);
    await signUpVerified(w, a, freshEmail());
    await a.sync('syncNow');
    // The server forgets the session (e.g. revoked elsewhere): log out behind the host's back.
    await browser.fetch(`${w.origin}${Sync.SYNC_API_PREFIX}/logout`, { method: 'POST' });
    await a.sync('syncNow');
    expect(((await a.sync('status')) as Sync.SyncStatus).state).toBe('locked');
    expect(await a.account('resume')).toEqual({ resumed: false });
  }, T);
});

describe('deviceNameFromUserAgent', () => {
  it('names browser and OS without versions', () => {
    expect(deviceNameFromUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox on Linux');
    expect(deviceNameFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0'))
      .toBe('Edge on Windows');
    expect(deviceNameFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'))
      .toBe('Safari on iOS');
    expect(deviceNameFromUserAgent(undefined)).toBe('Browser');
  });
});
