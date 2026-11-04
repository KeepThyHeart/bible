// @vitest-environment node
import { mkdtempSync, mkdirSync, readdirSync, existsSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sync, createUserSchema, type ISql, type SqlParameter, type SqlResult } from '@bible/core';
import { IpcKnownError } from '../../../ipc/result';
import { NetworkBlockedError } from '../../NetworkGateway';
import { DesktopSyncService, toAccountsError, type DesktopSyncDeps } from '../DesktopSyncService';
import { createSyncSettingsStore } from '../syncSettings';
import { createFakeSyncServer, type FakeSyncServer } from './fakeSyncServer';

const PASSWORD = 'violet-Lantern-quietly-7291';
const CONSENT = { terms: true, ageConfirmed: true } as const;
const FLOOR = { m: 19456, t: 2, p: 1 };

type Params = SqlParameter[] | { [key: string]: SqlParameter } | undefined;
const bind = (p: Params): unknown[] => (p === undefined ? [] : Array.isArray(p) ? p : [p]);

class TestSql implements ISql {
  readonly db = new Database(':memory:');
  constructor() { this.db.pragma('foreign_keys = ON'); }
  queryOne<T>(sql: string, params?: Params): T | undefined { return this.db.prepare(sql).get(...(bind(params) as never[])) as T | undefined; }
  queryAll<T>(sql: string, params?: Params): T[] { return this.db.prepare(sql).all(...(bind(params) as never[])) as T[]; }
  execute(sql: string, params?: Params): SqlResult {
    const stmt = this.db.prepare(sql);
    if (!stmt.reader) {
      const info = stmt.run(...(bind(params) as never[]));
      return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
    }
    stmt.all(...(bind(params) as never[]));
    return { changes: 0, lastInsertRowId: 0 };
  }
  transaction<T>(cb: () => T): T { return this.db.transaction(cb)(); }
  close(): void { this.db.close(); }
  isOpen(): boolean { return this.db.open; }
  getDatabasePath(): string { return ':memory:'; }
}

function newDb(): TestSql {
  const db = new TestSql();
  createUserSchema(db);
  db.db.exec(`
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
  return db;
}

function fakeSafeStorage(weak: boolean) {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().slice(4),
    getSelectedStorageBackend: () => (weak ? 'basic_text' : 'gnome_libsecret'),
  };
}

const noopScheduler: Sync.SyncScheduler = { every: () => () => undefined, onOnline: () => () => undefined };
const triggers = (db: TestSql): number =>
  db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_trg_%'")!.n;
const hasTable = (db: TestSql, name: string): boolean =>
  db.queryOne("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?", [name]) !== undefined;

describe('DesktopSyncService', () => {
  let dir: string;
  let notes: string;
  let db: TestSql;
  let server: FakeSyncServer;
  let allowed: boolean;
  let saved: Array<{ kind: string; name: string; text: string }>;
  let services: DesktopSyncService[];

  const settingsFile = () => join(dir, 'sync', 'accounts.json');
  const secretFiles = () => (existsSync(join(dir, 'secrets')) ? readdirSync(join(dir, 'secrets')) : []);

  function make(opts: { weak?: boolean; overrides?: Partial<DesktopSyncDeps> } = {}): DesktopSyncService {
    const settings = createSyncSettingsStore(settingsFile());
    const svc = new DesktopSyncService({
      getUserDb: async () => db,
      secretDir: join(dir, 'secrets'),
      safeStorage: fakeSafeStorage(opts.weak === true),
      fetch: server.fetch,
      moduleResolver: { toPortable: () => null, toLocal: () => null },
      notesDir: () => notes,
      bnStateFile: join(dir, 'sync', 'bn-state.json'),
      settings,
      networkAllowed: () => allowed,
      scheduler: noopScheduler,
      saveTextFile: async (req) => {
        const path = join(dir, req.suggestedName);
        const text = await req.content();
        saved.push({ kind: req.kind, name: req.suggestedName, text });
        return { path };
      },
      deviceName: () => 'Test Desktop',
      log: { info() {}, warn() {}, error() {} },
      kdfCost: FLOOR,
      minStrength: 0,
      debounceMs: 60_000,
      pauseTimeoutMs: 2000,
      ...opts.overrides,
    });
    services.push(svc);
    return svc;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kth-accounts-'));
    notes = join(dir, 'notes');
    mkdirSync(notes, { recursive: true });
    db = newDb();
    server = createFakeSyncServer();
    allowed = true;
    saved = [];
    services = [];
  });
  afterEach(() => {
    for (const s of services) s.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function signedUp(svc: DesktopSyncService, email = 'me@example.com'): Promise<void> {
    await svc.setServerUrl('http://127.0.0.1:9');
    await svc.signUp({ email, password: PASSWORD, consent: CONSENT });
  }

  it('starts signed out; the server URL is validated and refused while signed in', async () => {
    const svc = make();
    expect(svc.status.getSnapshot().state).toBe('signed-out');
    await expect(svc.setServerUrl('http://example.com')).rejects.toMatchObject({ failure: 'bad_request' });
    expect((await svc.setServerUrl('https://sync.example.org/'))).toMatchObject({ serverUrl: 'https://sync.example.org', networkAllowed: true });
    await svc.setServerUrl('http://localhost:9');
    await svc.signUp({ email: 'me@example.com', password: PASSWORD, consent: CONSENT });
    await expect(svc.setServerUrl('https://other.example.org')).rejects.toMatchObject({ failure: 'bad_request' });
  });

  it('sign-up installs the tracker, stores the secrets, syncs rows and .bn files', async () => {
    writeFileSync(join(notes, 'a.bn'), JSON.stringify({ version: 1, content: 'hello' }));
    const svc = make();
    await signedUp(svc);
    expect(svc.status.getSnapshot()).toMatchObject({ accountEmail: 'me@example.com' });
    expect(triggers(db)).toBeGreaterThan(0);
    expect(secretFiles().sort()).toEqual(['sync-sync.token.enc', 'sync-sync.unlocked.enc']);
    expect(createSyncSettingsStore(settingsFile()).get()).toMatchObject({ signedIn: true, email: 'me@example.com' });

    db.execute("INSERT INTO user_note (title, content) VALUES ('t', 'body')");
    const res = await svc.syncNow();
    expect(res.pushed).toBeGreaterThanOrEqual(2);
    // The .bn file went through the adapter: the tracker knows its path.
    expect(Sync.createChangeTracker(db).lookupByLocal('bn.file', 'a.bn')).toBeDefined();
    expect(server.pushedRecords).toBeGreaterThanOrEqual(2);
  });

  it('returns the recovery code from sign-up and saves it through the dialog', async () => {
    const svc = make();
    await svc.setServerUrl('http://127.0.0.1:9');
    const { recoveryCode } = await svc.signUp({ email: 'me@example.com', password: PASSWORD, consent: CONSENT });
    expect(recoveryCode).toMatch(/^[A-Z0-9-]{20,}$/i);
    const r = await svc.saveRecoveryCode({ code: recoveryCode });
    expect(r?.path).toContain('keep-thy-heart-recovery-code.txt');
    expect(saved[0].text).toContain(recoveryCode);
  });

  it('sign-out removes triggers and sync tables, deletes secrets and the .bn state, keeps user data', async () => {
    writeFileSync(join(notes, 'a.bn'), JSON.stringify({ version: 1 }));
    const svc = make();
    await signedUp(svc);
    db.execute("INSERT INTO user_note (title, content) VALUES ('t', 'body')");
    await svc.syncNow();
    expect(existsSync(join(dir, 'sync', 'bn-state.json'))).toBe(true);
    await svc.signOut({ wipeLocal: true });
    expect(triggers(db)).toBe(0);
    expect(hasTable(db, 'sync_record')).toBe(false);
    expect(secretFiles()).toEqual([]);
    expect(existsSync(join(dir, 'sync', 'bn-state.json'))).toBe(false);
    expect(db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM user_note')!.n).toBe(1);
    expect(existsSync(join(notes, 'a.bn'))).toBe(true);
    expect(svc.status.getSnapshot().state).toBe('signed-out');
    expect(createSyncSettingsStore(settingsFile()).get()).toMatchObject({ signedIn: false, email: null });
  });

  it('resumes from the stored keys at the next launch without re-uploading', async () => {
    const first = make();
    await signedUp(first);
    db.execute("INSERT INTO user_note (title, content) VALUES ('t', 'body')");
    await first.syncNow();
    first.close();
    const pushedBefore = server.pushedRecords;
    const second = make();
    expect(second.status.getSnapshot()).toMatchObject({ state: 'locked', accountEmail: 'me@example.com' });
    await second.resumeIfSignedIn();
    expect(second.status.getSnapshot().state).not.toBe('locked');
    await second.syncNow();
    expect(server.pushedRecords).toBe(pushedBefore);
  });

  it('weak keyring: keys stay in memory, the next launch is locked, unlock resumes with zero re-enrolment', async () => {
    const first = make({ weak: true });
    expect((await first.info()).settings.secretStoreWeak).toBe(true);
    await signedUp(first);
    expect(secretFiles()).toEqual([]);
    db.execute("INSERT INTO user_note (title, content) VALUES ('t', 'body')");
    await first.syncNow();
    first.close();
    const pushedBefore = server.pushedRecords;
    const dirtyBefore = db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM sync_record WHERE dirty = 1')!.n;
    expect(dirtyBefore).toBe(0);

    const second = make({ weak: true });
    await second.resumeIfSignedIn();
    expect(second.status.getSnapshot()).toMatchObject({ state: 'locked', accountEmail: 'me@example.com' });
    await expect(second.unlock({ password: 'wrong-password-entirely-1' })).rejects.toBeTruthy();
    expect(second.status.getSnapshot().state).toBe('locked');
    await second.unlock({ password: PASSWORD });
    await second.syncNow();
    expect(second.status.getSnapshot().state).toBe('idle');
    expect(server.pushedRecords).toBe(pushedBefore);
    expect(db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM sync_record WHERE dirty = 1')!.n).toBe(0);
  });

  it('sign-in with remember=false keeps keys in memory and sets ask-each-launch', async () => {
    const first = make();
    await signedUp(first);
    await first.signOut({ wipeLocal: false });
    await first.signIn({ email: 'me@example.com', password: PASSWORD, remember: false });
    expect(secretFiles()).toEqual([]);
    expect((await first.info()).settings.askPasswordEachLaunch).toBe(true);
    // Turning it off moves the keys to the OS store.
    const s = await first.setAskPasswordEachLaunch(false);
    expect(s.askPasswordEachLaunch).toBe(false);
    expect(secretFiles().sort()).toEqual(['sync-sync.token.enc', 'sync-sync.unlocked.enc']);
    await first.setAskPasswordEachLaunch(true);
    expect(secretFiles()).toEqual([]);
    expect(first.status.getSnapshot().state).not.toBe('locked');
  });

  it('a failed sign-in does not change the remember choice', async () => {
    const svc = make();
    await signedUp(svc);
    await svc.signOut({ wipeLocal: false });
    await expect(svc.signIn({ email: 'me@example.com', password: 'not-the-password-1', remember: false })).rejects.toBeTruthy();
    expect((await svc.info()).settings.askPasswordEachLaunch).toBe(false);
  });

  it('refuses network flows with the switch off (before any work) and reports it in info()', async () => {
    const svc = make();
    await svc.setServerUrl('http://127.0.0.1:9');
    allowed = false;
    await expect(svc.signUp({ email: 'me@example.com', password: PASSWORD, consent: CONSENT })).rejects.toBeInstanceOf(NetworkBlockedError);
    expect(server.calls).toEqual([]);
    const info = await svc.info();
    expect(info.settings.networkAllowed).toBe(false);
    expect(info.server).toBeNull();
  });

  it('a network failure while the switch is off is reported as blocked, with it on as network', async () => {
    const failing = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const svc = make({ overrides: { fetch: failing } });
    await svc.setServerUrl('http://127.0.0.1:9');
    await expect(svc.requestStartOver({ email: 'a@b.co' })).rejects.toBeInstanceOf(Sync.SyncNetworkError);
    allowed = false; // the switch was turned off: the same failure is now "blocked"
    await expect(svc.requestStartOver({ email: 'a@b.co' })).rejects.toBeInstanceOf(NetworkBlockedError);
  });

  it('info() carries the server, account, email and .bn warnings', async () => {
    writeFileSync(join(notes, 'big.bn'), JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) }));
    const svc = make();
    await signedUp(svc);
    await svc.syncNow();
    const info = await svc.info();
    expect(info.server).toMatchObject({ apiVersion: 1 });
    expect(info.account).toMatchObject({ email: 'me@example.com' });
    expect(info.email).toBe('me@example.com');
    expect(info.bnWarnings).toEqual([{ path: 'big.bn', reason: 'too-large' }]);
  });

  it('lists devices with their names decrypted', async () => {
    const svc = make();
    await signedUp(svc);
    const sealed = await Sync.sealDeviceName(
      (svc as unknown as { bundle: { account: Sync.AccountClient } }).bundle.account.unlocked!, 'abcdabcdabcdabcd', 'Kitchen laptop');
    server.nextDevices = [
      { id: 'abcdabcdabcdabcd', nameSealed: sealed, createdAt: 'c', lastSeenAt: 'l', userAgent: null, current: true },
      { id: '1111111111111111', nameSealed: 'AA', createdAt: 'c', lastSeenAt: 'l', userAgent: 'x', current: false },
    ];
    const devices = await svc.devices();
    expect(devices.map((d) => d.name)).toEqual(['Kitchen laptop', '']);
    expect(devices[0].current).toBe(true);
  });

  it('exports server data through the dialog only after a destination was chosen', async () => {
    const svc = make();
    await signedUp(svc);
    // The fake server has no /export route (404): the download is attempted only after the dialog returned a path.
    await expect(svc.exportServerData()).rejects.toBeInstanceOf(Sync.SyncHttpError);
    expect(server.calls).toContain('GET /export');
    expect(saved).toEqual([]);
  });

  it('pause() waits for a running sync; resume() restarts the engine', async () => {
    const svc = make();
    await signedUp(svc);
    db.execute("INSERT INTO user_note (title, content) VALUES ('t', 'body')");
    server.hold();
    const running = svc.syncNow();
    for (let i = 0; i < 200 && !server.calls.includes('GET /changes'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(server.calls).toContain('GET /changes');
    expect(svc.status.getSnapshot().state).toBe('syncing');
    let paused = false;
    const p = svc.pause().then(() => { paused = true; });
    await new Promise((r) => setTimeout(r, 100));
    expect(paused).toBe(false);
    server.holdChanges!.release();
    await running.catch(() => undefined);
    await p;
    expect(paused).toBe(true);
    expect(await svc.syncNow()).toEqual({ pulled: 0, pushed: 0, conflicts: 0, conflictCopies: 0, opaque: 0 });
    svc.resume();
    expect((await svc.syncNow()).pushed).toBeGreaterThanOrEqual(0);
  });

  it('signs out cleanly when no server URL is left to talk to', async () => {
    const svc = make();
    await signedUp(svc);
    createSyncSettingsStore(settingsFile()).update({ serverUrl: '' });
    const again = make();
    expect(again.status.getSnapshot().state).toBe('locked');
    await again.signOut({ wipeLocal: false });
    expect(again.status.getSnapshot().state).toBe('signed-out');
    expect(readFileSync(settingsFile(), 'utf8')).toContain('"signedIn": false');
  });
});

describe('toAccountsError', () => {
  const code = (e: unknown) => (e as IpcKnownError).message;
  it('maps the stack\'s errors onto failure tokens', () => {
    const cases: Array<[unknown, string, string]> = [
      [new Sync.WeakPasswordError(1, []), 'weak_password', 'invalid_input'],
      [new Sync.AccountError('invalid_credentials'), 'unauthorized', 'unauthorized'],
      [new Sync.AccountError('not_signed_in'), 'unauthorized', 'unauthorized'],
      [new Sync.AccountError('damaged_keys'), 'crypto', 'unauthorized'],
      [new Sync.AccountError('unsafe_kdf'), 'crypto', 'unauthorized'],
      [new Sync.AccountError('invalid_recovery_code'), 'bad_request', 'invalid_input'],
      [new Sync.SyncHttpError(409, { error: 'conflict_email' } as never), 'conflict_email', 'conflict'],
      [new Sync.SyncHttpError(403, { error: 'email_unverified' } as never), 'email_unverified', 'unauthorized'],
      [new Sync.SyncHttpError(429, null), 'rate_limited', 'unavailable'],
      [new Sync.SyncHttpError(502, null), 'server_error', 'unavailable'],
      [new Sync.SyncNetworkError(), 'network', 'unavailable'],
      [new Sync.SyncResponseError(), 'server_error', 'unavailable'],
      [new NetworkBlockedError('sync'), 'network_blocked', 'network_blocked'],
    ];
    for (const [err, token, ipc] of cases) {
      const out = toAccountsError(err);
      expect(out).toBeInstanceOf(IpcKnownError);
      expect(code(out)).toBe(token);
      expect((out as IpcKnownError).code).toBe(ipc);
    }
  });
  it('maps unknown errors to a bare internal error and reports only the error name', () => {
    const names: string[] = [];
    const out = toAccountsError(new TypeError('secret-pw'), (n) => names.push(n));
    expect(out).toBeInstanceOf(IpcKnownError);
    expect(out.code).toBe('internal');
    expect(out.message).toBe('internal');
    expect(out.stack).toBeUndefined();
    expect(names).toEqual(['TypeError']);
    expect(JSON.stringify(names)).not.toContain('secret-pw');
    expect(toAccountsError('secret-pw', (n) => names.push(n)).message).toBe('internal');
    expect(names[1]).toBe('UnknownError');
  });
});
