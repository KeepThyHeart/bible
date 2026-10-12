/**
 * The worker's sync host (S4, design §6): `{op:'sync'}` requests (configure/account/api/status/syncNow) over
 * SyncApiClient + AccountClient + SyncEngine, and local-write notifications for push scheduling.
 *
 * Security (keys live in this worker only):
 * - every `account` result is sanitised to `AccountResult` (`{ resumed }`, `{ recoveryCode }` or null), never keys;
 * - `api` results are plain server JSON (device names are opened here; the export is ciphertext + metadata);
 * - every error leaving `handle` is rebuilt as a `SyncHostError` with a fixed message and a code, so no password,
 *   key, token, recovery code or record content can ride along in a message;
 * - `syncStatus` events carry the core `SyncStatus` only (fixed error messages).
 *
 * State lives per opened database (`ctx.sql`): a wipe closes it, and the next request builds fresh state over the new
 * database. Persisted config: `setting` rows (category `web`, keys `sync.*`). With `remember` the keys are kept in
 * IndexedDB (`IndexedDbSecretStore`, `kth-secrets`); without, in memory only, so after a leader change (a new worker)
 * the session is `locked` until the user signs in again.
 *
 * Shape follows the desktop host (`DesktopSyncService`): resume only when signed in before; sign-out stops the engine,
 * uninstalls the tracker and deletes the secrets; key rotation runs `reencryptAll`; `onWipe` deletes local data (web
 * only: `ctx.wipe()`, then the handler's `onWipe` deletes `kth-secrets` and `kth-user-data`).
 * No side effects at module load.
 */
import { Sync } from '@bible/core/browser';
import type { ExtCtx } from '../handler';
import { IndexedDbSecretStore } from '../IndexedDbSecretStore';
import type { AccountClientMethods, AccountResult, ModuleRef, SyncApiMethod, UserDbRequest } from '../protocol';
import {
  cleanModuleRefs, createModuleResolver, planModuleRemap, remapModuleIds, MODULE_ID_TABLES, type WebModuleResolver,
} from './moduleResolver';
import { createWorkerScheduler } from './scheduler';

export interface SyncHost {
  handle(req: Extract<UserDbRequest, { op: 'sync' }>, ctx: ExtCtx): Promise<unknown>;
  notifyLocalChange(tables: string[]): void;
}

export interface SyncHostOptions {
  fetch: typeof fetch;
  indexedDB: IDBFactory;
  origin: string;
  now?: () => number;
  timers?: Sync.SyncTimers;
  online?: EventTarget;
  /** For the device name (browser + OS). Default `navigator.userAgent`. */
  userAgent?: string;
  /** Test seams for AccountClient (Argon2 cost, strength floor, random source, KDF). */
  account?: Pick<Sync.AccountClientDeps, 'kdfCost' | 'minStrength' | 'random' | 'kdf'>;
  /** Engine tuning (tests). */
  engine?: { debounceMs?: number; pageSize?: number };
}

/** A device as the account screens show it: the sealed name opened in the worker ('' when it does not open). */
export interface WebDevice {
  id: string; name: string; createdAt: string; lastSeenAt: string; userAgent: string | null; current: boolean;
}

/**
 * Codes a sync request can fail with (the `code` of the wire error):
 * AccountError codes (`invalid_credentials`, `damaged_keys`, `unsafe_kdf`, `invalid_recovery_code`, `not_signed_in`),
 * `weak_password`, server ApiErrorCodes (`bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict_email`,
 * `email_unverified`, `quota_exceeded`, `too_large`, `rate_limited`, `signup_closed`, `server_error`), `network`,
 * `not_configured`, `unknown_method`, `internal`.
 */
export type SyncHostErrorCode =
  | Sync.AccountErrorCode | Sync.ApiErrorCode | 'weak_password' | 'network' | 'not_configured' | 'unknown_method' | 'internal';

export class SyncHostError extends Error {
  constructor(readonly code: SyncHostErrorCode, message: string, name = 'SyncHostError') {
    super(message);
    this.name = name;
  }
}

const SETTING_CATEGORY = 'web';
const K = {
  baseUrl: 'sync.baseUrl', remember: 'sync.remember', modules: 'sync.modules', deviceId: 'sync.deviceId',
  signedIn: 'sync.signedIn', email: 'sync.email',
} as const;

const ACCOUNT_METHODS: ReadonlySet<string> = new Set<keyof AccountClientMethods>([
  'signUp', 'signIn', 'signInWithRecoveryCode', 'resume', 'changePassword', 'regenerateRecoveryCode', 'rotateKeys',
  'startOver', 'signOut', 'deleteAccount',
]);
const API_METHODS: ReadonlySet<string> = new Set<SyncApiMethod>([
  'info', 'account', 'devices', 'revokeDevice', 'exportAll', 'reset', 'resendVerification', 'verifyEmail', 'setDeviceName',
]);
const API_ERROR_CODES: ReadonlySet<string> = new Set<Sync.ApiErrorCode>([
  'bad_request', 'unauthorized', 'forbidden', 'not_found', 'conflict_email', 'email_unverified', 'quota_exceeded',
  'too_large', 'rate_limited', 'signup_closed', 'server_error',
]);
const STATUS_CODES: Record<number, Sync.ApiErrorCode> = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict_email', 413: 'too_large',
  429: 'rate_limited',
};

/** Tracked user tables (sync kind -> table), for `notifyLocalChange` and `changed` events. */
const TRACKED = Sync.coreTrackedTables();
const TRACKED_TABLES: ReadonlySet<string> = new Set(TRACKED.map((t) => t.table));
const TABLE_OF_KIND: ReadonlyMap<string, string> = new Map(TRACKED.map((t) => [t.kind, t.table]));

/** Rebuild any error as a SyncHostError with a fixed message (never the original message: it may echo input). */
export function sanitizeSyncError(err: unknown): SyncHostError {
  if (err instanceof SyncHostError) return err;
  if (err instanceof Sync.AccountError) return new SyncHostError(err.code, err.message, 'AccountError');
  if (err instanceof Sync.WeakPasswordError) return new SyncHostError('weak_password', 'Password is too weak', 'WeakPasswordError');
  if (err instanceof Sync.SyncHttpError) {
    const body = err.body?.error;
    const code: Sync.ApiErrorCode = body && API_ERROR_CODES.has(body)
      ? body
      : STATUS_CODES[err.status] ?? (err.status >= 500 ? 'server_error' : 'bad_request');
    return new SyncHostError(code, `The server refused the request (${code})`, 'SyncHttpError');
  }
  if (err instanceof Sync.SyncNetworkError) return new SyncHostError('network', 'Network request failed', 'SyncNetworkError');
  if (err instanceof Sync.SyncResponseError) return new SyncHostError('server_error', 'Malformed server response', 'SyncResponseError');
  return new SyncHostError('internal', 'Sync request failed');
}

const bad = (what: string): never => { throw new SyncHostError('bad_request', `Invalid ${what}`); };
function str(v: unknown, what: string): string { return typeof v === 'string' ? v : bad(what); }
function bool(v: unknown, what: string): boolean { return typeof v === 'boolean' ? v : bad(what); }
/** `x` or `{ [key]: x }` (both shapes are accepted for the one-field API requests). */
function field(v: unknown, key: string, what: string): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>)[key] === 'string') {
    return (v as Record<string, string>)[key];
  }
  return bad(what);
}

/** "Firefox on Linux" style, without version numbers. */
export function deviceNameFromUserAgent(ua: string | undefined): string {
  const s = ua ?? '';
  const browser =
    /Edg(e|A|iOS)?\//.test(s) ? 'Edge'
      : /OPR\/|Opera/.test(s) ? 'Opera'
        : /SamsungBrowser\//.test(s) ? 'Samsung Internet'
          : /Firefox\/|FxiOS\//.test(s) ? 'Firefox'
            : /Chrome\/|CriOS\/|Chromium\//.test(s) ? 'Chrome'
              : /Safari\//.test(s) ? 'Safari'
                : 'Browser';
  const os =
    /iPhone|iPad|iPod/.test(s) ? 'iOS'
      : /Android/.test(s) ? 'Android'
        : /CrOS/.test(s) ? 'ChromeOS'
          : /Windows/.test(s) ? 'Windows'
            : /Mac OS X|Macintosh/.test(s) ? 'macOS'
              : /Linux/.test(s) ? 'Linux'
                : '';
  return os ? `${browser} on ${os}` : browser;
}

function randomHex(bytes: number): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// --- persisted settings ----------------------------------------------------------------------------------------

function readSetting(sql: Sync.ISql, key: string): string | null {
  const row = sql.queryOne<{ value: string | null }>(
    'SELECT value FROM setting WHERE category = ? AND key = ?', [SETTING_CATEGORY, key]);
  return row?.value ?? null;
}
function writeSetting(sql: Sync.ISql, key: string, value: string | null, type: 'string' | 'bool' | 'json' = 'string'): void {
  if (value === null) {
    sql.execute('DELETE FROM setting WHERE category = ? AND key = ?', [SETTING_CATEGORY, key]);
    return;
  }
  sql.execute(
    `INSERT INTO setting (category, key, value, value_type) VALUES (?, ?, ?, ?)
     ON CONFLICT (category, key) DO UPDATE SET value = excluded.value, value_type = excluded.value_type`,
    [SETTING_CATEGORY, key, value, type],
  );
}

interface SyncConfig { baseUrl: string; remember: boolean; modules: ModuleRef[] }

function readConfig(sql: Sync.ISql): SyncConfig | null {
  const baseUrl = readSetting(sql, K.baseUrl);
  if (!baseUrl) return null;
  let modules: ModuleRef[] = [];
  try { modules = cleanModuleRefs(JSON.parse(readSetting(sql, K.modules) ?? '[]')); } catch { modules = []; }
  return { baseUrl, remember: readSetting(sql, K.remember) === 'true', modules };
}
function writeConfig(sql: Sync.ISql, c: SyncConfig): void {
  sql.transaction(() => {
    writeSetting(sql, K.baseUrl, c.baseUrl);
    writeSetting(sql, K.remember, c.remember ? 'true' : 'false', 'bool');
    writeSetting(sql, K.modules, JSON.stringify(c.modules), 'json');
  });
}

// --- secrets ---------------------------------------------------------------------------------------------------

const SECRET_NAMES: readonly Sync.SecretName[] = ['sync.unlocked', 'sync.token'];

/**
 * `remember` on: IndexedDB (`kth-secrets`); off: memory. Switching carries the current values across and deletes them
 * from the old place. IndexedDB is never opened while `remember` has been off for this database's whole session.
 */
class WebSecretStore implements Sync.ISecretStore {
  private readonly memory = new Sync.MemorySecretStore();
  private persistentStore: IndexedDbSecretStore | null = null;
  private persistentUsed: boolean;

  constructor(private readonly idb: IDBFactory, private remember: boolean) {
    this.persistentUsed = remember;
  }

  private get persistent(): IndexedDbSecretStore {
    this.persistentUsed = true;
    this.persistentStore ??= new IndexedDbSecretStore({ indexedDB: this.idb });
    return this.persistentStore;
  }
  private get active(): Sync.ISecretStore { return this.remember ? this.persistent : this.memory; }

  get persistence(): 'persistent' | 'memory' { return this.remember ? 'persistent' : 'memory'; }
  get(name: Sync.SecretName) { return this.active.get(name); }
  set(name: Sync.SecretName, value: Uint8Array) { return this.active.set(name, value); }
  async delete(name: Sync.SecretName): Promise<void> {
    await this.memory.delete(name);
    if (this.persistentUsed) await this.persistent.delete(name);
  }

  /** Sign-out: every value, and the IndexedDB wrapping key with them. */
  async deleteAll(): Promise<void> {
    for (const n of SECRET_NAMES) await this.memory.delete(n);
    if (this.persistentUsed) await this.persistent.deleteAll();
  }

  async setRemember(on: boolean): Promise<void> {
    if (on === this.remember) return;
    const from = this.active;
    const to = on ? this.persistent : this.memory;
    for (const n of SECRET_NAMES) {
      let v: Uint8Array | null = null;
      try { v = await from.get(n); } catch { v = null; }
      if (v) {
        try { await to.set(n, v); } finally { v.fill(0); }
      }
    }
    this.remember = on;
    if (on) {
      for (const n of SECRET_NAMES) await this.memory.delete(n);
    } else {
      try { await this.persistent.deleteAll(); } catch { /* nothing stored, or the store is gone */ }
    }
  }

  close(): void {
    this.persistentStore?.close();
  }
}

// --- per-database state ----------------------------------------------------------------------------------------

interface Bundle { baseUrl: string; api: Sync.SyncApiClient; account: Sync.AccountClient }

interface DbState {
  sql: Sync.ISql;
  ctx: ExtCtx;
  status: Sync.SyncStatusStore;
  secrets: WebSecretStore;
  resolver: WebModuleResolver;
  deviceId: string;
  config: SyncConfig | null;
  bundle: Bundle | null;
  tracker: Sync.ChangeTracker | null;
  engine: Sync.SyncEngine | null;
  ready: Promise<void>;
  unsubscribe: () => void;
  disposed: boolean;
}

const SIGNED_OUT: Partial<Sync.SyncStatus> = {
  state: 'signed-out', accountEmail: undefined, lastSyncedAt: undefined, error: undefined, pending: 0, opaque: 0,
};

export function createSyncHost(o: SyncHostOptions): SyncHost {
  let state: DbState | null = null;
  /** The last configuration, kept across a wipe so the fresh database gets it back. */
  let lastConfig: SyncConfig | null = null;
  const scheduler = createWorkerScheduler({ timers: o.timers, online: o.online });
  const deviceName = (): string => deviceNameFromUserAgent(o.userAgent ?? globalThis.navigator?.userAgent);

  const isOpen = (s: DbState): boolean => {
    try { return s.sql.isOpen(); } catch { return false; }
  };

  function dispose(s: DbState): void {
    if (s.disposed) return;
    s.disposed = true;
    try { s.engine?.stop(); } catch { /* engine already stopped */ }
    s.engine = null;
    s.unsubscribe();
    s.secrets.close();
    if (state === s) state = null;
  }

  function emitStatus(s: DbState): void {
    if (s.disposed) return;
    // The database went away under us (a wipe that did not come through the account flow): drop this state.
    if (!isOpen(s)) { dispose(s); return; }
    s.ctx.emit({ event: 'syncStatus', status: s.status.getSnapshot() });
  }

  function deviceIdFor(sql: Sync.ISql): string {
    let id = readSetting(sql, K.deviceId);
    if (!id || !/^[0-9a-f]{16}$/.test(id)) {
      id = randomHex(8);
      writeSetting(sql, K.deviceId, id);
    }
    return id;
  }

  function ensureState(ctx: ExtCtx): DbState {
    if (state && state.sql === ctx.sql && !state.disposed) {
      state.ctx = ctx;
      return state;
    }
    if (state) dispose(state);
    const sql = ctx.sql;
    let config = readConfig(sql);
    if (!config && lastConfig) {
      config = { ...lastConfig, modules: [...lastConfig.modules] };
      writeConfig(sql, config);
    }
    if (config) lastConfig = config;
    const signedIn = config !== null && readSetting(sql, K.signedIn) === 'true';
    const email = readSetting(sql, K.email) ?? undefined;
    const s: DbState = {
      sql, ctx,
      status: Sync.createSyncStatusStore(signedIn ? { state: 'locked', accountEmail: email } : { state: 'signed-out' }),
      secrets: new WebSecretStore(o.indexedDB, config?.remember ?? false),
      resolver: createModuleResolver(config?.modules ?? []),
      deviceId: deviceIdFor(sql),
      config, bundle: null, tracker: null, engine: null,
      ready: Promise.resolve(), unsubscribe: () => undefined, disposed: false,
    };
    state = s;
    s.unsubscribe = s.status.subscribe(() => emitStatus(s));
    if (config) buildBundle(s, config.baseUrl);
    if (signedIn) s.ready = resumeOnce(s).then(() => undefined);
    emitStatus(s);
    return s;
  }

  /** Signed in before: try the stored keys; without them the session is `locked` until the user signs in again. */
  async function resumeOnce(s: DbState): Promise<boolean> {
    const email = readSetting(s.sql, K.email) ?? undefined;
    try {
      const u = await s.bundle!.account.resume();
      if (!u && !s.disposed) s.status.set({ state: 'locked', accountEmail: email });
      return u !== null;
    } catch {
      if (!s.disposed) s.status.set({ state: 'locked', accountEmail: email });
      return false;
    }
  }

  function buildBundle(s: DbState, baseUrl: string): void {
    const ref: { current: Bundle | null } = { current: null };
    const api = new Sync.SyncApiClient({
      baseUrl,
      auth: { kind: 'cookie' },
      fetch: o.fetch,
      // A 401 on an authenticated call means the server dropped the session; a failed sign-in is not a lock.
      onUnauthorized: () => {
        if (ref.current?.account.unlocked && !s.disposed) s.status.set({ state: 'locked' });
      },
    });
    const account = new Sync.AccountClient({
      api, secrets: s.secrets, status: s.status, deviceId: s.deviceId, deviceName,
      kdf: o.account?.kdf, kdfCost: o.account?.kdfCost, minStrength: o.account?.minStrength, random: o.account?.random,
      onUnlocked: (u) => onUnlocked(s, u),
      onSignedOut: () => onSignedOut(s),
      onWipe: () => onWipe(s),
    });
    ref.current = { baseUrl, api, account };
    s.bundle = ref.current;
  }

  async function onUnlocked(s: DbState, u: Sync.UnlockedAccount): Promise<void> {
    if (s.disposed) return;
    const bundle = s.bundle!;
    try { s.engine?.stop(); } catch { /* see dispose */ }
    const tracker = Sync.createChangeTracker(s.sql);
    tracker.install(TRACKED);
    tracker.state.set('device_id', s.deviceId);
    s.tracker = tracker;
    const engine = new Sync.SyncEngine({
      sql: s.sql, tracker,
      codecs: Sync.createCodecRegistry(Sync.createCoreCodecs({ extKvSyncs: () => false })),
      cipher: Sync.createRecordCipher(u, o.account?.random), transport: bundle.api.transport(), unlocked: u,
      hlc: Sync.createHlc(s.deviceId, tracker.state.get('hlc_last') as Sync.HlcString | undefined),
      status: s.status, modules: s.resolver, now: o.now, random: o.account?.random,
      timers: o.timers, debounceMs: o.engine?.debounceMs, pageSize: o.engine?.pageSize,
      onApplied: (rows) => {
        const tables = [...new Set(rows.map((r) => TABLE_OF_KIND.get(r.kind) ?? r.kind))];
        if (tables.length > 0 && !s.disposed) s.ctx.emit({ event: 'changed', tables });
      },
    });
    s.engine = engine;
    const email = s.status.getSnapshot().accountEmail ?? readSetting(s.sql, K.email) ?? undefined;
    writeSetting(s.sql, K.signedIn, 'true', 'bool');
    writeSetting(s.sql, K.email, email ?? null);
    if (email) s.status.set({ accountEmail: email });
    else void fillEmail(s, bundle);
    engine.start(scheduler);
    if (bundle.account.consumeReencrypt()) void engine.reencryptAll().catch(() => undefined);
  }

  /** After a start-over in a fresh session the email is not known locally: ask the server once (best effort). */
  async function fillEmail(s: DbState, bundle: Bundle): Promise<void> {
    try {
      const { email } = await bundle.api.account();
      if (s.disposed || s.bundle !== bundle || !bundle.account.unlocked) return;
      writeSetting(s.sql, K.email, email);
      s.status.set({ accountEmail: email });
    } catch { /* cosmetic */ }
  }

  async function onSignedOut(s: DbState): Promise<void> {
    try { s.engine?.stop(); } catch { /* see dispose */ }
    s.engine = null;
    if (isOpen(s)) {
      try { (s.tracker ?? Sync.createChangeTracker(s.sql)).uninstall(); } catch { /* no sync tables */ }
      try {
        writeSetting(s.sql, K.signedIn, null);
        writeSetting(s.sql, K.email, null);
      } catch { /* database closing */ }
    }
    s.tracker = null;
    try { await s.secrets.deleteAll(); } catch { /* the store may already be gone */ }
    s.status.set(SIGNED_OUT);
  }

  async function onWipe(s: DbState): Promise<void> {
    const ctx = s.ctx;
    dispose(s);
    await ctx.wipe();
  }

  // --- actions -------------------------------------------------------------------------------------------------

  async function configure(s: DbState, req: Extract<UserDbRequest, { action: 'configure' }>): Promise<Sync.SyncStatus> {
    let url: URL;
    try { url = new URL(str(req.baseUrl, 'baseUrl')); } catch { return bad('baseUrl'); }
    if (url.origin !== o.origin || (url.protocol !== 'https:' && url.protocol !== 'http:')) bad('baseUrl');
    const baseUrl = url.origin + url.pathname.replace(/\/+$/, '');
    const remember = bool(req.remember, 'remember');
    const incoming = cleanModuleRefs(req.modules);
    await s.ready;
    const previous = s.config;
    // A catalog that is not loaded yet (empty) keeps the last known one.
    const modules = incoming.length > 0 ? incoming : previous?.modules ?? [];
    if (previous) {
      const moves = planModuleRemap(previous.modules, modules);
      if (moves.length > 0 && remapModuleIds(s.sql, moves) > 0) s.ctx.emit({ event: 'changed', tables: [...MODULE_ID_TABLES] });
    }
    s.resolver.update(modules);
    const config: SyncConfig = { baseUrl, remember, modules };
    writeConfig(s.sql, config);
    s.config = config;
    lastConfig = config;
    await s.secrets.setRemember(remember);
    if (!s.bundle || s.bundle.baseUrl !== baseUrl) {
      const hadSession = readSetting(s.sql, K.signedIn) === 'true';
      try { s.engine?.stop(); } catch { /* see dispose */ }
      s.engine = null;
      buildBundle(s, baseUrl);
      if (hadSession) {
        const ready = resumeOnce(s).then(() => undefined);
        s.ready = ready;
        await ready;
      }
    }
    return s.status.getSnapshot();
  }

  function requireBundle(s: DbState): Bundle {
    if (!s.bundle) throw new SyncHostError('not_configured', 'Sync is not configured');
    return s.bundle;
  }

  async function account(s: DbState, method: string, args: unknown[]): Promise<AccountResult> {
    if (!ACCOUNT_METHODS.has(method)) throw new SyncHostError('unknown_method', 'Unknown account method');
    const a = requireBundle(s).account;
    const code = (r: { recoveryCode: string }): AccountResult => ({ recoveryCode: String(r.recoveryCode) });
    switch (method as keyof AccountClientMethods) {
      case 'signUp': {
        const consent = args[2] as { terms?: unknown; ageConfirmed?: unknown } | undefined;
        if (consent?.terms !== true || consent.ageConfirmed !== true) bad('consent');
        return code(await a.signUp(str(args[0], 'email'), str(args[1], 'password'), { terms: true, ageConfirmed: true }));
      }
      case 'signIn':
        await a.signIn(str(args[0], 'email'), str(args[1], 'password'));
        return null;
      case 'signInWithRecoveryCode':
        return code(await a.signInWithRecoveryCode(str(args[0], 'email'), str(args[1], 'recovery code'), str(args[2], 'password')));
      case 'resume': {
        if (a.unlocked) return { resumed: true };
        // Never signed in on this database: nothing to resume (and the status stays signed-out, not locked).
        if (readSetting(s.sql, K.signedIn) !== 'true') return { resumed: false };
        return { resumed: await resumeOnce(s) };
      }
      case 'changePassword':
        await a.changePassword(str(args[0], 'password'), str(args[1], 'password'), bool(args[2] ?? false, 'signOutOthers'));
        return null;
      case 'regenerateRecoveryCode':
        return code(await a.regenerateRecoveryCode(str(args[0], 'password')));
      case 'rotateKeys':
        return code(await a.rotateKeys(str(args[0], 'password')));
      case 'startOver':
        return code(await a.startOver(str(args[0], 'token'), str(args[1], 'password')));
      case 'signOut': {
        const opts = args[0] as { wipeLocal?: unknown } | undefined;
        await a.signOut({ wipeLocal: opts?.wipeLocal === true });
        return null;
      }
      case 'deleteAccount':
        await a.deleteAccount(str(args[0], 'password'));
        return null;
    }
    throw new SyncHostError('unknown_method', 'Unknown account method');
  }

  async function api(s: DbState, method: string, args: unknown[]): Promise<unknown> {
    if (!API_METHODS.has(method)) throw new SyncHostError('unknown_method', 'Unknown API method');
    const { api: client, account: acct } = requireBundle(s);
    const unlocked = (): Sync.UnlockedAccount => {
      const u = acct.unlocked;
      if (!u) throw new Sync.AccountError('not_signed_in');
      return u;
    };
    switch (method as SyncApiMethod) {
      case 'info':
        return client.info();
      case 'account':
        return client.account();
      case 'devices': {
        const u = unlocked();
        const res = await client.devices();
        const out: WebDevice[] = [];
        for (const d of res.devices) {
          let name = '';
          try { name = await Sync.openDeviceName(u, d.id, d.nameSealed); } catch { name = ''; }
          out.push({ id: d.id, name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, userAgent: d.userAgent, current: d.current });
        }
        return { devices: out };
      }
      case 'revokeDevice':
        await client.revokeDevice(str(args[0], 'device id'));
        return null;
      case 'exportAll':
        unlocked();
        return client.exportAll();
      case 'reset':
        await client.reset({ email: field(args[0], 'email', 'email').trim() });
        return null;
      case 'resendVerification': {
        const email = args[0] === undefined
          ? s.status.getSnapshot().accountEmail ?? readSetting(s.sql, K.email)
          : field(args[0], 'email', 'email');
        if (!email) throw new Sync.AccountError('not_signed_in');
        await client.resendVerification({ email: email.trim() });
        return null;
      }
      case 'verifyEmail':
        await client.verifyEmail({ token: field(args[0], 'token', 'token') });
        return null;
      case 'setDeviceName': {
        const u = unlocked();
        const name = field(args[0], 'name', 'device name').trim().slice(0, 100);
        await client.setDeviceName({ nameSealed: await Sync.sealDeviceName(u, s.deviceId, name || deviceName(), o.account?.random) });
        return null;
      }
    }
    throw new SyncHostError('unknown_method', 'Unknown API method');
  }

  async function dispatch(req: Extract<UserDbRequest, { op: 'sync' }>, ctx: ExtCtx): Promise<unknown> {
    const s = ensureState(ctx);
    switch (req.action) {
      case 'configure':
        return configure(s, req);
      case 'status':
        await s.ready;
        return s.status.getSnapshot();
      case 'syncNow': {
        await s.ready;
        if (!s.engine) return null;
        try { return await s.engine.syncNow(); } catch { return null; }
      }
      case 'account':
        await s.ready;
        return account(s, String(req.method), Array.isArray(req.args) ? req.args : []);
      case 'api':
        await s.ready;
        return api(s, String(req.method), Array.isArray(req.args) ? req.args : []);
      default:
        throw new SyncHostError('unknown_method', 'Unknown sync action');
    }
  }

  return {
    async handle(req, ctx) {
      try {
        return await dispatch(req, ctx);
      } catch (err) {
        throw sanitizeSyncError(err);
      }
    },
    notifyLocalChange(tables) {
      const s = state;
      if (!s?.engine || s.disposed || !isOpen(s)) return;
      if (!tables.some((t) => TRACKED_TABLES.has(t))) return;
      try { s.engine.notifyLocalChange(); } catch { /* the engine reports through its status */ }
    },
  };
}
