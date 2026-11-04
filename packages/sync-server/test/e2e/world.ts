/**
 * E2E world: the REAL core sync client (AccountClient + SyncApiClient + SyncEngine, real crypto, floor Argon2id) talking
 * over real HTTP (http.createServer on port 0, global fetch) to the REAL sync server router mounted in Express.
 * Bearer auth (wantToken), so no cookie jar is needed. Each "device" owns its own user DB, secret store and status.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Sync, createUserSchema } from '@bible/core';
import { TestSql } from '../helpers/sql';
import { makeMailServer, tokenIn, type Mailbox } from '../helpers/flows';
import type { TestServer } from '../helpers/server';

export const PASSWORD = 'violet-Lantern-quietly-7291';
export const PASSWORD2 = 'granite-Harbor-sparrow-5038';
export const PASSWORD3 = 'ember-Meadow-compass-8864';
export const FLOOR_KDF = { m: 19456, t: 2, p: 1 };
export const CONSENT = { terms: true, ageConfirmed: true } as const;
/** Portable module reference = the module abbreviation on both platforms. `map` is local install id -> abbreviation (mutable: "install" a module). */
export function moduleMap(map: Record<number, string>): Sync.ModuleRefResolver & { map: Record<number, string> } {
  return {
    map,
    toPortable: (id) => map[Number(id)] ?? null,
    toLocal: (ref) => { const hit = Object.entries(map).find(([, abbr]) => abbr === ref); return hit ? Number(hit[0]) : null; },
  };
}
const MODULES = moduleMap({ 1: 'KJV', 2: 'ESV' });

export interface DeviceOptions {
  modules?: Sync.ModuleRefResolver;
  pageSize?: number;
  /** Reuse an existing user DB (an app restart: same data, new process). */
  sql?: TestSql;
  /** Default: a fresh MemorySecretStore (also what the desktop uses for "ask for the password each launch"). */
  secrets?: Sync.ISecretStore;
  /** Extra codecs beyond the core ones; their tables are tracked via `trackedExtra`. */
  extraCodecs?: Sync.RecordCodec[];
  trackedExtra?: Sync.TrackedTable[];
  pushLimits?: { maxRecords?: number; maxBodyBytes?: number };
  /** Extension key-value opt-in predicate for the core ext.kv codec (default: no extension syncs). */
  extKvSyncs?: (extensionId: string) => boolean;
}

export interface Net { t: TestServer & { mail: Mailbox }; baseUrl: string; close(): Promise<void> }

export async function startNet(over: Parameters<typeof makeMailServer>[0] = {}): Promise<Net> {
  const t = makeMailServer(over);
  const srv = http.createServer(t.app);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return {
    t, baseUrl,
    close: () => new Promise<void>((r) => { srv.closeAllConnections?.(); srv.close(() => { t.server.close(); r(); }); }),
  };
}

/** Same trigger repair as the core engine harness (user_note_fts external-content triggers; see report). */
function fixNoteFtsTriggers(db: TestSql): void {
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
}

export class Device {
  readonly sql: TestSql;
  readonly secrets: Sync.ISecretStore;
  readonly opts: DeviceOptions;
  /** Engine builds so far (a rebuild = a fresh engine instance, as after an app restart or a re-unlock). */
  engineBuilds = 0;
  readonly status = Sync.createSyncStatusStore({ state: 'signed-out' });
  readonly tracker: Sync.ChangeTracker;
  readonly api: Sync.SyncApiClient;
  readonly account: Sync.AccountClient;
  readonly deviceId: string;
  engine: Sync.SyncEngine | null = null;
  wiped = false;
  /** While true every request fails like a dropped connection. */
  offline = false;
  /** Method + path of every request this device made. */
  readonly requests: string[] = [];

  constructor(net: Net, n: number, opts: DeviceOptions = {}) {
    this.opts = opts;
    this.sql = opts.sql ?? new TestSql();
    this.secrets = opts.secrets ?? new Sync.MemorySecretStore();
    this.deviceId = n.toString(16).repeat(16).slice(0, 16);
    createUserSchema(this.sql);
    fixNoteFtsTriggers(this.sql);
    this.tracker = Sync.createChangeTracker(this.sql);
    this.tracker.install([...Sync.coreTrackedTables(), ...(opts.trackedExtra ?? [])]);
    this.tracker.state.set('device_id', this.deviceId);
    this.api = new Sync.SyncApiClient({
      baseUrl: net.baseUrl,
      auth: { kind: 'bearer', token: () => Sync.loadSyncToken(this.secrets) },
      fetch: (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        if (this.offline) throw new TypeError('fetch failed');
        this.requests.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
        return globalThis.fetch(input, init);
      }) as typeof fetch,
    });
    this.account = new Sync.AccountClient({
      api: this.api, secrets: this.secrets, status: this.status, deviceId: this.deviceId,
      deviceName: () => `Device ${this.deviceId.slice(0, 2)}`, wantToken: true, kdfCost: FLOOR_KDF,
      onUnlocked: (u) => { this.buildEngine(u); },
      onSignedOut: () => { this.engine = null; },
      onWipe: async () => { this.wiped = true; },
    });
  }

  private buildEngine(u: Sync.UnlockedAccount): void {
    this.engineBuilds++;
    this.engine = new Sync.SyncEngine({
      sql: this.sql, tracker: this.tracker,
      codecs: Sync.createCodecRegistry([...Sync.createCoreCodecs(this.opts.extKvSyncs ? { extKvSyncs: this.opts.extKvSyncs } : undefined), ...(this.opts.extraCodecs ?? [])]),
      cipher: Sync.createRecordCipher(u), transport: this.api.transport(), unlocked: u,
      hlc: Sync.createHlc(this.deviceId), status: this.status, modules: this.opts.modules ?? MODULES,
      ...(this.opts.pageSize ? { pageSize: this.opts.pageSize } : {}),
      ...(this.opts.pushLimits ? { pushLimits: this.opts.pushLimits } : {}),
    });
  }

  /** A fresh engine instance for the same unlocked account (retries opaque records, clears per-instance failures). */
  rebuildEngine(over: Partial<DeviceOptions> = {}): void {
    Object.assign(this.opts, over);
    if (over.trackedExtra || over.extraCodecs) this.tracker.install([...Sync.coreTrackedTables(), ...(this.opts.trackedExtra ?? [])]);
    const u = this.account.unlocked;
    if (!u) throw new Error('device is not unlocked');
    this.buildEngine(u);
  }

  sync(): Promise<Sync.SyncResult> {
    if (!this.engine) throw new Error('device has no engine (signed out)');
    return this.engine.syncNow();
  }

  notes(): Array<{ note_id: number; title: string; content: string; metadata: string | null }> {
    return this.sql.queryAll('SELECT note_id, title, content, metadata FROM user_note ORDER BY content');
  }
  addNote(content: string, title = 't'): number {
    return this.sql.execute('INSERT INTO user_note (title, content) VALUES (?, ?)', [title, content]).lastInsertRowId!;
  }
  setExt(ext: string, key: string, value: string): void {
    this.sql.execute(
      `INSERT INTO extension_storage (extension_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (extension_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [ext, key, value, Date.now()]);
  }
  ext(): Array<{ extension_id: string; key: string; value: string }> {
    return this.sql.queryAll('SELECT extension_id, key, value FROM extension_storage ORDER BY extension_id, key');
  }
  setContent(noteId: number, content: string): void {
    this.sql.execute('UPDATE user_note SET content = ? WHERE note_id = ?', [content, noteId]);
  }
  /** Pin the local change time (deterministic last-writer-wins between devices). */
  setChangedMs(kind: string, key: number, ms: number): void {
    this.sql.execute('UPDATE sync_record SET changed_ms = ? WHERE table_name = ? AND local_key = ?', [ms, kind, String(key)]);
  }
}

/** Waits for a mail the server sends after answering (dispatch is not awaited by the route). */
export async function mailTo(net: Net, to: string, subject: RegExp, after = 0): Promise<{ token: string; count: number }> {
  for (let i = 0; i < 100; i++) {
    const hits = net.t.mail.sent.filter((m, idx) => idx >= after && m.to === to && subject.test(m.subject));
    if (hits.length > 0) return { token: tokenIn(hits[hits.length - 1]), count: net.t.mail.sent.length };
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no mail to ${to} matching ${subject}`);
}

let counter = 0;
export function freshEmail(): string { return `e2e${++counter}-${Date.now().toString(36)}@example.com`; }

/** Device A signed up and verified; device B signed in with the same account. */
export async function twoDevices(net: Net): Promise<{ a: Device; b: Device; email: string }> {
  const email = freshEmail();
  const a = new Device(net, 0xa1);
  const b = new Device(net, 0xb2);
  await a.account.signUp(email, PASSWORD, CONSENT);
  const { token } = await mailTo(net, email, /Confirm/i);
  await a.api.verifyEmail({ token });
  await b.account.signIn(email, PASSWORD);
  return { a, b, email };
}

export function serverCounts(net: Net): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ['account', 'keyset', 'device', 'session', 'record', 'email_token']) {
    out[t] = net.t.sql.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
  }
  return out;
}

export function count(d: Device, table: string): number {
  return d.sql.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
}
/** Live server records per account id. */
export function recordsByAccount(net: Net): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of net.t.sql.queryAll<{ account_id: string; n: number }>('SELECT account_id, COUNT(*) AS n FROM record GROUP BY account_id')) out[r.account_id] = r.n;
  return out;
}
