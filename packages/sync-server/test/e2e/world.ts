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
const MODULES = { toPortable: (id: number | string) => ({ 1: 'KJV', 2: 'ESV' } as Record<number, string>)[Number(id)] ?? null,
  toLocal: (ref: string) => ({ KJV: 1, ESV: 2 } as Record<string, number>)[ref] ?? null };

export interface Net { t: TestServer & { mail: Mailbox }; baseUrl: string; close(): Promise<void> }

export async function startNet(): Promise<Net> {
  const t = makeMailServer();
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
  readonly sql = new TestSql();
  readonly secrets = new Sync.MemorySecretStore();
  readonly status = Sync.createSyncStatusStore({ state: 'signed-out' });
  readonly tracker: Sync.ChangeTracker;
  readonly api: Sync.SyncApiClient;
  readonly account: Sync.AccountClient;
  readonly deviceId: string;
  engine: Sync.SyncEngine | null = null;
  wiped = false;

  constructor(net: Net, n: number) {
    this.deviceId = n.toString(16).repeat(16).slice(0, 16);
    createUserSchema(this.sql);
    fixNoteFtsTriggers(this.sql);
    this.tracker = Sync.createChangeTracker(this.sql);
    this.tracker.install(Sync.coreTrackedTables());
    this.tracker.state.set('device_id', this.deviceId);
    this.api = new Sync.SyncApiClient({
      baseUrl: net.baseUrl,
      auth: { kind: 'bearer', token: () => Sync.loadSyncToken(this.secrets) },
      fetch: globalThis.fetch,
    });
    this.account = new Sync.AccountClient({
      api: this.api, secrets: this.secrets, status: this.status, deviceId: this.deviceId,
      deviceName: () => `Device ${this.deviceId.slice(0, 2)}`, wantToken: true, kdfCost: FLOOR_KDF,
      onUnlocked: (u) => {
        this.engine = new Sync.SyncEngine({
          sql: this.sql, tracker: this.tracker, codecs: Sync.createCodecRegistry(Sync.createCoreCodecs()),
          cipher: Sync.createRecordCipher(u), transport: this.api.transport(), unlocked: u,
          hlc: Sync.createHlc(this.deviceId), status: this.status, modules: MODULES,
        });
      },
      onSignedOut: () => { this.engine = null; },
      onWipe: async () => { this.wiped = true; },
    });
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
