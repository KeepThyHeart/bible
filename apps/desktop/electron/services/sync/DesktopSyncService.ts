/**
 * Desktop sync host (task 0150 M3, subtask A): the accounts module's brain, with no Electron import. Everything the
 * outside world provides arrives through `DesktopSyncDeps` (user DB, safeStorage, fetch, KDF, settings file, dialogs,
 * timers), so tests drive it with fakes. `modules/accounts/service.ts` builds the real deps.
 *
 * Shape: one `AccountClient` per server URL over a `SyncApiClient` (bearer token from the secret store, fetch from the
 * network gateway). When an account is unlocked (sign-up, sign-in, recovery, resume, key rotation) the host installs the
 * change tracker over the user DB, builds a `SyncEngine` (core tables + the `.bn` file adapter) and starts it with the
 * desktop scheduler. Sign-out stops the engine, removes the triggers and `sync_*` tables and deletes the stored secrets.
 * Wiping local data is NOT done on desktop (`onWipe` does nothing): the user's notes stay on disk.
 *
 * Secrets: `SafeStorageSecretStore` unless the OS keyring is weak (Linux basic_text) or the user asked to be asked for the
 * password at each launch; then keys live in memory only and the next launch is `locked` until `unlock({password})`.
 *
 * Nothing here logs or puts a key, password, recovery code, token or record content in a message.
 */
import { rmSync } from 'fs';
import { Sync } from '@bible/core';
import { IpcKnownError, type IpcErrorCode } from '../../ipc/result';
import { ACCOUNTS_IPC_ERROR_CODES } from '../../modules/accounts/types';
import type {
  AccountDevice, AccountsFailure, AccountsInfo, DesktopSyncSettings,
} from '../../modules/accounts/types';
import { NetworkBlockedError } from '../NetworkGateway';
import { createBnFileSyncAdapter, type BnFileSyncAdapter } from './BnFileSyncAdapter';
import { SafeStorageSecretStore, type SafeStorageLike } from './SafeStorageSecretStore';
import { createLocalChangePoller, type SchedulerTimers } from './scheduler';
import type { SyncSettingsStore } from './syncSettings';
import { normalizeServerUrl } from './syncSettings';

export interface DesktopSyncLog {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface SaveTextFileRequest {
  kind: 'recovery-code' | 'server-export';
  suggestedName: string;
  /** Produced after the user picked a destination, so a cancelled dialog costs nothing (no download). */
  content: () => Promise<string>;
}

export interface DesktopSyncDeps {
  getUserDb(): Promise<Sync.ISql>;
  /** Folder for the encrypted secret files (`<userData>/secrets`). */
  secretDir: string;
  safeStorage: SafeStorageLike;
  /** The network gateway's fetch (`createGatewayFetch`). */
  fetch: typeof fetch;
  kdf?: ConstructorParameters<typeof Sync.AccountClient>[0]['kdf'];
  moduleResolver: Sync.ModuleRefResolver;
  notesDir(): string;
  /** `<userData>/sync/bn-state.json`. */
  bnStateFile: string;
  settings: SyncSettingsStore;
  /** The app-wide "Allow web requests" switch. */
  networkAllowed(): boolean;
  /** Extension key-value opt-in (`ModuleExtensionsPort.kvSyncOptIn`). */
  extKvSyncs?(extensionId: string): boolean;
  scheduler: Sync.SyncScheduler;
  saveTextFile(req: SaveTextFileRequest): Promise<{ path: string } | null>;
  deviceName(): string;
  log: DesktopSyncLog;
  /** `.bn` files the engine changed (the app refreshes its watcher / lists). */
  onFilesChanged?(changed: Array<{ localKey: string; deleted: boolean }>): void;
  // Tuning and test seams.
  pollTimers?: SchedulerTimers;
  engineTimers?: Sync.SyncTimers;
  debounceMs?: number;
  pageSize?: number;
  kdfCost?: ConstructorParameters<typeof Sync.AccountClient>[0]['kdfCost'];
  minStrength?: number;
  random?: ConstructorParameters<typeof Sync.AccountClient>[0]['random'];
  now?(): number;
  /** How long `pause()` waits for a running sync to stop. Default 10 s. */
  pauseTimeoutMs?: number;
}

/** A failure of a known class (the message is the `AccountsFailure` token). */
export class AccountsServiceError extends Error {
  constructor(readonly failure: AccountsFailure) {
    super(failure);
    this.name = 'AccountsServiceError';
  }
}

const STATUS_TO_FAILURE: Record<number, AccountsFailure> = {
  400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict_email',
  413: 'too_large', 429: 'rate_limited',
};

const API_FAILURES: readonly string[] = [
  'bad_request', 'unauthorized', 'forbidden', 'not_found', 'conflict_email', 'email_unverified', 'quota_exceeded',
  'too_large', 'rate_limited', 'signup_closed', 'server_error',
];

/** The failure class of an error thrown by the sync stack, or null when it is not one of ours. */
export function failureOf(err: unknown): AccountsFailure | null {
  if (err instanceof AccountsServiceError) return err.failure;
  if (err instanceof Sync.WeakPasswordError) return 'weak_password';
  if (err instanceof Sync.AccountError) {
    switch (err.code) {
      case 'invalid_credentials':
      case 'not_signed_in':
        return 'unauthorized';
      case 'damaged_keys':
      case 'unsafe_kdf':
        return 'crypto';
      case 'invalid_recovery_code':
        return 'bad_request';
    }
  }
  if (err instanceof Sync.SyncHttpError) {
    const code = err.body?.error;
    if (code && API_FAILURES.includes(code)) return code;
    return STATUS_TO_FAILURE[err.status] ?? (err.status >= 500 ? 'server_error' : 'bad_request');
  }
  if (err instanceof NetworkBlockedError) return 'network_blocked';
  if (err instanceof Sync.SyncNetworkError) return 'network';
  if (err instanceof Sync.SyncResponseError) return 'server_error';
  return null;
}

/**
 * Turn a sync-stack error into the `IpcKnownError` the renderer expects (the message is the `AccountsFailure` token; the
 * renderer localises `accounts.error.<token>`). Anything unrecognised becomes an error with code `internal` and the bare
 * message `internal`: the original message and stack never reach the renderer or the log (R2 L3). `onUnknown` receives
 * only the error's name.
 */
export function toAccountsError(err: unknown, onUnknown?: (errorName: string) => void): IpcKnownError {
  if (err instanceof IpcKnownError) return err;
  const failure = failureOf(err);
  if (failure !== null && failure !== 'internal') {
    return new IpcKnownError(ACCOUNTS_IPC_ERROR_CODES[failure] as Exclude<IpcErrorCode, 'internal'>, failure);
  }
  onUnknown?.(err instanceof Error && /^\w{1,64}$/.test(err.name) ? err.name : 'UnknownError');
  // IpcKnownError's constructor refuses 'internal'; moduleIpc then logs one `warn` line (`internal: internal`) and
  // sends `{ code: 'internal', message: 'internal' }`, with no stack.
  const e = new IpcKnownError('unavailable', 'internal');
  Object.defineProperty(e, 'code', { value: 'internal' });
  e.stack = undefined;
  return e;
}

const SECRET_NAMES: readonly Sync.SecretName[] = ['sync.unlocked', 'sync.token'];

/** Delegates to the OS-keyring store or to a memory store; moves the values when the choice changes. */
class SwitchableSecretStore implements Sync.ISecretStore {
  private memoryMode: boolean;
  private readonly memory = new Sync.MemorySecretStore();
  constructor(private readonly persistent: SafeStorageSecretStore, memoryMode: boolean) {
    this.memoryMode = memoryMode;
  }
  private get active(): Sync.ISecretStore { return this.memoryMode ? this.memory : this.persistent; }
  get persistence(): 'persistent' | 'memory' { return this.active.persistence; }
  get(name: Sync.SecretName) { return this.active.get(name); }
  set(name: Sync.SecretName, value: Uint8Array) { return this.active.set(name, value); }
  async delete(name: Sync.SecretName): Promise<void> {
    await this.memory.delete(name);
    await this.persistent.delete(name);
  }
  /** Delete every secret from both stores (sign-out). */
  async deleteAll(): Promise<void> {
    for (const n of SECRET_NAMES) await this.delete(n);
  }
  /** Switch where secrets live, carrying the current values across (and removing them from the old place). */
  async useMemory(on: boolean): Promise<void> {
    if (on === this.memoryMode) return;
    const from = this.active;
    const to = on ? this.memory : this.persistent;
    for (const n of SECRET_NAMES) {
      let v: Uint8Array | null = null;
      try { v = await from.get(n); } catch { v = null; }
      if (v) {
        try { await to.set(n, v); } finally { v.fill(0); }
      }
    }
    this.memoryMode = on;
    for (const n of SECRET_NAMES) {
      try { await (on ? this.persistent : this.memory).delete(n); } catch { /* nothing stored */ }
    }
  }
}

interface ClientBundle {
  url: string;
  api: Sync.SyncApiClient;
  account: Sync.AccountClient;
}

const MAX_BN_WARNINGS = 50;
const DEFAULT_PAGE_SIZE = 200;
const ZERO_RESULT: Sync.SyncResult = { pulled: 0, pushed: 0, conflicts: 0, conflictCopies: 0, opaque: 0 };

export class DesktopSyncService {
  readonly status: Sync.SyncStatusStore;
  private readonly secrets: SwitchableSecretStore;
  private readonly persistent: SafeStorageSecretStore;
  private bundle: ClientBundle | null = null;
  private tracker: Sync.ChangeTracker | null = null;
  private engine: Sync.SyncEngine | null = null;
  private stopPoll: (() => void) | null = null;
  private paused = false;
  private closed = false;
  private readonly bnWarnings = new Map<string, { path: string; reason: string }>();

  constructor(private readonly d: DesktopSyncDeps) {
    this.persistent = new SafeStorageSecretStore(d.safeStorage, d.secretDir);
    const s = d.settings.get();
    this.secrets = new SwitchableSecretStore(this.persistent, s.askPasswordEachLaunch || this.persistent.persistence === 'memory');
    this.status = Sync.createSyncStatusStore(
      s.signedIn ? { state: 'locked', accountEmail: s.email ?? undefined } : { state: 'signed-out' },
    );
  }

  // --- settings --------------------------------------------------------------------------------------------------

  private publicSettings(): DesktopSyncSettings {
    const s = this.d.settings.get();
    return {
      serverUrl: s.serverUrl,
      askPasswordEachLaunch: s.askPasswordEachLaunch,
      secretStoreWeak: this.persistent.persistence === 'memory',
      networkAllowed: this.d.networkAllowed(),
    };
  }

  async setServerUrl(url: string): Promise<DesktopSyncSettings> {
    if (this.d.settings.get().signedIn) throw new AccountsServiceError('bad_request');
    const normalized = normalizeServerUrl(url);
    if (normalized === null) throw new AccountsServiceError('bad_request');
    this.d.settings.update({ serverUrl: normalized });
    this.bundle = null;
    return this.publicSettings();
  }

  async setAskPasswordEachLaunch(on: boolean): Promise<DesktopSyncSettings> {
    this.d.settings.update({ askPasswordEachLaunch: on === true });
    await this.secrets.useMemory(on === true || this.persistent.persistence === 'memory');
    return this.publicSettings();
  }

  // --- client ----------------------------------------------------------------------------------------------------

  private requireNetwork(): void {
    if (!this.d.networkAllowed()) throw new NetworkBlockedError('sync');
  }

  /** Run a call that talks to the server: SyncNetworkError while the switch is off means "blocked", not "offline". */
  private async net<T>(fn: () => Promise<T>): Promise<T> {
    this.requireNetwork();
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Sync.SyncNetworkError && !this.d.networkAllowed()) throw new NetworkBlockedError('sync');
      throw err;
    }
  }

  private client(): ClientBundle {
    const url = this.d.settings.get().serverUrl;
    if (url === '') throw new AccountsServiceError('bad_request');
    if (this.bundle?.url === url) return this.bundle;
    const api = new Sync.SyncApiClient({
      baseUrl: url,
      auth: { kind: 'bearer', token: () => Sync.loadSyncToken(this.secrets) },
      fetch: this.d.fetch,
    });
    const account = new Sync.AccountClient({
      api, secrets: this.secrets, status: this.status, kdf: this.d.kdf,
      deviceId: this.d.settings.get().deviceId, deviceName: () => this.d.deviceName(), wantToken: true,
      kdfCost: this.d.kdfCost, minStrength: this.d.minStrength, random: this.d.random,
      onUnlocked: (u) => this.onUnlocked(u),
      onSignedOut: () => this.onSignedOut(),
      onWipe: async () => { /* desktop keeps the user's data: wipe means sync bookkeeping only (see onSignedOut) */ },
    });
    this.bundle = { url, api, account };
    return this.bundle;
  }

  // --- unlock / sign-out hooks -------------------------------------------------------------------------------------

  private async onUnlocked(u: Sync.UnlockedAccount): Promise<void> {
    const db = await this.d.getUserDb();
    this.stopEngine();
    const settings = this.d.settings.get();
    const tracker = Sync.createChangeTracker(db);
    tracker.install(Sync.coreTrackedTables());
    tracker.state.set('device_id', settings.deviceId);
    this.tracker = tracker;
    const bn = this.makeBnAdapter(tracker);
    const bundle = this.client();
    const email = this.status.getSnapshot().accountEmail ?? settings.email ?? undefined;
    const engine = new Sync.SyncEngine({
      sql: db, tracker,
      codecs: Sync.createCodecRegistry(Sync.createCoreCodecs({ extKvSyncs: (id) => this.d.extKvSyncs?.(id) ?? false })),
      cipher: Sync.createRecordCipher(u, this.d.random), transport: bundle.api.transport(), unlocked: u,
      hlc: Sync.createHlc(settings.deviceId, tracker.state.get('hlc_last') as Sync.HlcString | undefined),
      status: this.status, modules: this.d.moduleResolver, adapters: [bn],
      pageSize: this.d.pageSize ?? DEFAULT_PAGE_SIZE, now: this.d.now, random: this.d.random,
      timers: this.d.engineTimers, debounceMs: this.d.debounceMs,
      onApplied: () => { /* the UI refreshes through the app's own change events */ },
    });
    this.engine = engine;
    this.d.settings.update({ signedIn: true, email: email ?? null });
    if (email) this.status.set({ accountEmail: email });
    this.paused = false;
    this.startEngine();
    if (bundle.account.consumeReencrypt()) void engine.reencryptAll().catch((err: unknown) => this.d.log.warn('[accounts] re-encrypt failed', errName(err)));
  }

  private async onSignedOut(): Promise<void> {
    this.stopEngine();
    let tracker = this.tracker;
    this.tracker = null;
    try {
      tracker ??= Sync.createChangeTracker(await this.d.getUserDb());
      tracker.uninstall();
    } catch (err) {
      this.d.log.warn('[accounts] could not remove the sync tables', errName(err));
    }
    this.engine = null;
    try { rmSync(this.d.bnStateFile, { force: true }); } catch { /* best effort */ }
    this.bnWarnings.clear();
    try { await this.secrets.deleteAll(); } catch (err) { this.d.log.warn('[accounts] could not delete the stored secrets', errName(err)); }
    this.d.settings.update({ signedIn: false, email: null });
  }

  private makeBnAdapter(tracker: Sync.ChangeTracker): BnFileSyncAdapter {
    this.bnWarnings.clear();
    const bn = createBnFileSyncAdapter({
      notesDir: this.d.notesDir(),
      markDirty: (kind, key, deleted) => tracker.touch(kind, key, { deleted }),
      warn: (path, reason) => {
        if (this.bnWarnings.size < MAX_BN_WARNINGS) this.bnWarnings.set(`${reason}\u0000${path}`, { path, reason });
      },
      stateFile: this.d.bnStateFile,
      onFilesChanged: (c) => { try { this.d.onFilesChanged?.(c); } catch { /* host callback */ } },
    });
    const collect = bn.collect?.bind(bn);
    if (collect) {
      bn.collect = async () => {
        this.bnWarnings.clear(); // the scan reports again whatever is still wrong
        await collect();
      };
    }
    return bn;
  }

  private startEngine(): void {
    const engine = this.engine;
    const tracker = this.tracker;
    if (!engine || !tracker) return;
    engine.start(this.d.scheduler);
    this.stopPoll?.();
    this.stopPoll = createLocalChangePoller({
      pendingCount: () => tracker.pendingCount(),
      notify: () => engine.notifyLocalChange(),
      timers: this.d.pollTimers,
    });
  }

  private stopEngine(): void {
    this.stopPoll?.();
    this.stopPoll = null;
    this.engine?.stop();
  }

  // --- lifecycle -------------------------------------------------------------------------------------------------

  /** At launch: signed in before? Try the stored keys; without them the account is `locked` until `unlock`. */
  async resumeIfSignedIn(): Promise<void> {
    const s = this.d.settings.get();
    if (!s.signedIn) {
      this.status.set({ state: 'signed-out', accountEmail: undefined });
      return;
    }
    this.status.set({ state: 'locked', accountEmail: s.email ?? undefined });
    if (s.serverUrl === '') return;
    try {
      const u = await this.client().account.resume();
      if (!u) this.status.set({ state: 'locked', accountEmail: s.email ?? undefined });
    } catch (err) {
      this.d.log.warn('[accounts] could not resume the account', errName(err));
      this.status.set({ state: 'locked', accountEmail: s.email ?? undefined });
    }
  }

  /** Before a backup restore writes: stop the engine and wait (bounded) for a running sync to end. */
  async pause(): Promise<void> {
    this.paused = true;
    this.stopEngine();
    await this.waitNotSyncing(this.d.pauseTimeoutMs ?? 10_000);
  }

  /** After a restore: restart the engine and tell it the data changed. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.closed || !this.engine) return;
    this.startEngine();
    this.engine.notifyLocalChange();
  }

  private waitNotSyncing(timeoutMs: number): Promise<void> {
    if (this.status.getSnapshot().state !== 'syncing') return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const off = this.status.subscribe(() => {
        if (this.status.getSnapshot().state === 'syncing') return;
        off();
        if (timer) clearTimeout(timer);
        resolve();
      });
      timer = setTimeout(() => { off(); resolve(); }, timeoutMs);
      (timer as { unref?: () => void }).unref?.();
    });
  }

  /** App quit: stop timers and the engine; keep the stored secrets and the tracker tables. */
  close(): void {
    this.closed = true;
    this.stopEngine();
  }

  /** Nudge the engine after something outside it changed the data. */
  notifyLocalChange(): void {
    if (!this.paused) this.engine?.notifyLocalChange();
  }

  // --- AccountsApi -----------------------------------------------------------------------------------------------

  async getStatus(): Promise<Sync.SyncStatus> {
    return this.status.getSnapshot();
  }

  async info(): Promise<AccountsInfo> {
    const settings = this.publicSettings();
    const stored = this.d.settings.get();
    let server: Sync.InfoResponse | null = null;
    let account: Sync.AccountResponse | null = null;
    if (stored.serverUrl !== '' && settings.networkAllowed) {
      const { api, account: client } = this.client();
      try { server = await api.info(); } catch { server = null; }
      if (stored.signedIn && client.unlocked) {
        try { account = await api.account(); } catch { account = null; }
      }
    }
    return {
      settings, server, account, email: stored.signedIn ? stored.email : null,
      bnWarnings: [...this.bnWarnings.values()],
    };
  }

  async signUp(v: { email: string; password: string; consent: Sync.SignupRequest['consent'] }): Promise<{ recoveryCode: string }> {
    return this.net(() => this.client().account.signUp(v.email, v.password, v.consent));
  }

  async signIn(v: { email: string; password: string; remember: boolean }): Promise<void> {
    const before = this.d.settings.get().askPasswordEachLaunch;
    const ask = v.remember !== true;
    this.d.settings.update({ askPasswordEachLaunch: ask });
    await this.secrets.useMemory(ask || this.persistent.persistence === 'memory');
    try {
      await this.net(() => this.client().account.signIn(v.email, v.password));
    } catch (err) {
      if (!this.d.settings.get().signedIn) {
        this.d.settings.update({ askPasswordEachLaunch: before });
        await this.secrets.useMemory(before || this.persistent.persistence === 'memory');
      }
      throw err;
    }
  }

  async unlock(v: { password: string }): Promise<void> {
    const email = this.d.settings.get().email;
    if (!email || !this.d.settings.get().signedIn) throw new AccountsServiceError('unauthorized');
    await this.net(() => this.client().account.signIn(email, v.password));
  }

  async recover(v: { email: string; code: string; newPassword: string }): Promise<{ recoveryCode: string }> {
    return this.net(() => this.client().account.signInWithRecoveryCode(v.email, v.code, v.newPassword));
  }

  async signOut(v: { wipeLocal: boolean }): Promise<void> {
    if (this.d.settings.get().serverUrl === '') {
      await this.onSignedOut();
      this.status.set({ state: 'signed-out', accountEmail: undefined, lastSyncedAt: undefined, error: undefined, pending: 0, opaque: 0 });
      return;
    }
    await this.client().account.signOut({ wipeLocal: v.wipeLocal === true });
  }

  async changePassword(v: { current: string; next: string; signOutOthers: boolean }): Promise<void> {
    await this.net(() => this.client().account.changePassword(v.current, v.next, v.signOutOthers === true));
  }

  async newRecoveryCode(v: { currentPassword: string }): Promise<{ recoveryCode: string }> {
    return this.net(() => this.client().account.regenerateRecoveryCode(v.currentPassword));
  }

  async rotate(v: { currentPassword: string }): Promise<{ recoveryCode: string }> {
    return this.net(() => this.client().account.rotateKeys(v.currentPassword));
  }

  async devices(): Promise<AccountDevice[]> {
    const { api, account } = this.client();
    const u = account.unlocked;
    if (!u) throw new AccountsServiceError('unauthorized');
    const res = await this.net(() => api.devices());
    const out: AccountDevice[] = [];
    for (const dev of res.devices) {
      let name = '';
      try { name = await Sync.openDeviceName(u, dev.id, dev.nameSealed); } catch { name = ''; }
      out.push({ id: dev.id, name, createdAt: dev.createdAt, lastSeenAt: dev.lastSeenAt, userAgent: dev.userAgent, current: dev.current });
    }
    return out;
  }

  async revokeDevice(id: Sync.DeviceId): Promise<void> {
    await this.net(() => this.client().api.revokeDevice(id));
  }

  async syncNow(): Promise<Sync.SyncResult> {
    if (this.paused) return { ...ZERO_RESULT };
    if (!this.engine) throw new AccountsServiceError('unauthorized');
    return this.engine.syncNow();
  }

  async requestStartOver(v: { email: string }): Promise<void> {
    await this.net(() => this.client().api.reset({ email: String(v.email).trim() }));
  }

  async resendVerification(): Promise<void> {
    const { api, account } = this.client();
    const email = this.d.settings.get().email;
    if (!email || !account.unlocked) throw new AccountsServiceError('unauthorized');
    await this.net(() => api.resendVerification({ email }));
  }

  async saveRecoveryCode(v: { code: string }): Promise<{ path: string } | null> {
    const code = String(v.code);
    return this.d.saveTextFile({
      kind: 'recovery-code',
      suggestedName: 'keep-thy-heart-recovery-code.txt',
      content: async () =>
        `Keep Thy Heart account recovery code\n\n${code}\n\nKeep this file somewhere safe and private. With this code you can sign in and set a new password if you forget yours. Anyone who has it can do the same.\n`,
    });
  }

  async deleteAccount(v: { password: string }): Promise<void> {
    await this.net(() => this.client().account.deleteAccount(v.password));
  }

  async exportServerData(): Promise<{ path: string } | null> {
    const { api, account } = this.client();
    if (!account.unlocked) throw new AccountsServiceError('unauthorized');
    this.requireNetwork();
    const day = new Date((this.d.now ?? Date.now)()).toISOString().slice(0, 10);
    return this.d.saveTextFile({
      kind: 'server-export',
      suggestedName: `keep-thy-heart-server-export-${day}.json`,
      content: async () => JSON.stringify(await this.net(() => api.exportAll())),
    });
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'error';
}
