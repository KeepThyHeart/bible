/**
 * The accounts store (lazy chunk): what the header badge, the account dialog and the Settings tab show, and every
 * action behind their buttons. It talks to the worker's sync host only through an `AccountsTransport` (the user-DB
 * client in the page, a fake in tests); the worker holds all keys, so nothing secret passes through here except the
 * passwords the user types (sent once, never stored, never logged) and the recovery code shown on screen.
 *
 * Actions never reject: a failure sets `error` (a scope and a token the UI localizes) and the action resolves `false`.
 */
import type { Sync } from '@bible/core/browser';
import type { ModuleRef, UserDbEvent, UserDbRequest } from '../../userdb/protocol';
import { failureToken } from './errors';
import type { AccountsFailureToken } from './errors';

export interface AccountsTransport {
  request(req: UserDbRequest): Promise<unknown>;
  onEvent(cb: (event: UserDbEvent) => void): () => void;
}

export type AccountDialogId =
  | 'signUp' | 'recovery' | 'signIn' | 'recover' | 'startOver' | 'resetPassword' | 'unlock'
  | 'account' | 'changePassword' | 'newRecoveryCode' | 'privacy' | 'exportPassword';

export type ErrorScope = 'signUp' | 'signIn' | 'recover' | 'resetPassword' | 'unlock' | 'account' | 'changePassword' | 'privacy' | 'recoveryCode';

export interface DeviceRow { id: string; name: string; lastSeenAt: string; current: boolean }

export type NoticeId = 'verified' | 'verifyFailed' | 'resent' | 'resetStarted' | 'exported' | 'signedOut';

export interface AccountState {
  /** The worker could be reached (false: unsupported browser, or the worker never opened). */
  available: boolean;
  status: Sync.SyncStatus;
  info?: Sync.InfoResponse;
  account?: Sync.AccountResponse;
  devices: DeviceRow[];
  dialog: AccountDialogId | null;
  /** Shown on the recovery step until the user confirms it. */
  recoveryCode?: string;
  busy: boolean;
  error?: { scope: ErrorScope; token: AccountsFailureToken };
  notice?: { id: NoticeId; token?: AccountsFailureToken };
}

export const REMEMBER_KEY = 'kth.accounts.remember';
export const SYNC_THROTTLE_MS = 60_000;

export interface AccountStoreDeps {
  connect(): Promise<AccountsTransport>;
  /** Defaults to `location.origin`. */
  baseUrl?: string;
  /** The module catalog (server ids + abbreviations); `subscribe` fires when it changes (loads). */
  modules?: { list(): ModuleRef[]; subscribe(cb: () => void): () => void };
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
  /** Save a file the user asked for (a Blob download in the page). */
  saveFile?(name: string, mime: string, text: string): void;
  /** The existing web user-data backup (until full backups land). */
  backup?(password?: string): Promise<unknown>;
}

const SIGNED_OUT: Sync.SyncStatus = { state: 'signed-out', pending: 0, opaque: 0 };

export class AccountStore {
  private state: AccountState = { available: true, status: SIGNED_OUT, devices: [], dialog: null, busy: false };
  private readonly listeners = new Set<() => void>();
  private transport: AccountsTransport | null = null;
  private started: Promise<void> | null = null;
  private offEvents: (() => void) | null = null;
  private offModules: (() => void) | null = null;
  private lastVisibleSync = -Infinity;
  private resetToken: string | null = null;
  private lastEmail = '';
  private remember: boolean;

  constructor(private readonly deps: AccountStoreDeps) {
    this.remember = this.readRemember();
  }

  // --- external store ------------------------------------------------------------------------------------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };
  getSnapshot = (): AccountState => this.state;

  private set(patch: Partial<AccountState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of [...this.listeners]) fn();
  }

  private readRemember(): boolean {
    try { return (this.deps.storage ?? localStorage).getItem(REMEMBER_KEY) === 'true'; } catch { return false; }
  }

  /** The persisted "keep me signed in" choice (default off). */
  get rememberChoice(): boolean { return this.remember; }

  private writeRemember(v: boolean): void {
    this.remember = v;
    try { (this.deps.storage ?? localStorage).setItem(REMEMBER_KEY, String(v)); } catch { /* per-visit only */ }
  }

  // --- lifecycle -----------------------------------------------------------------------------------------------

  /** Connect, send `configure` (which resumes a remembered session in the worker) and read the status. Idempotent. */
  start(): Promise<void> {
    this.started ??= this.doStart();
    return this.started;
  }

  private async doStart(): Promise<void> {
    try {
      this.transport = await this.deps.connect();
    } catch {
      this.set({ available: false });
      return;
    }
    this.offEvents = this.transport.onEvent((e) => {
      if (e.event === 'syncStatus') this.onStatus(e.status);
    });
    const mods = this.deps.modules;
    if (mods) this.offModules = mods.subscribe(() => { void this.configure(); });
    try {
      const status = await this.configure();
      if (status) this.onStatus(status);
    } catch {
      this.set({ available: false });
    }
  }

  /** Send `configure` with the current catalog; re-sent when the catalog loads or `remember` changes. */
  private async configure(): Promise<Sync.SyncStatus | null> {
    if (!this.transport) return null;
    try {
      const status = (await this.transport.request({
        op: 'sync', action: 'configure',
        baseUrl: this.deps.baseUrl ?? location.origin,
        remember: this.remember,
        modules: this.deps.modules?.list() ?? [],
      })) as Sync.SyncStatus;
      return status;
    } catch (err) {
      this.set({ error: { scope: 'account', token: failureToken(err) } });
      return null;
    }
  }

  dispose(): void {
    this.offEvents?.();
    this.offModules?.();
    this.offEvents = this.offModules = null;
    this.transport = null;
    this.started = null;
  }

  private onStatus(status: Sync.SyncStatus): void {
    const wasSignedIn = isSignedIn(this.state.status);
    const nowSignedIn = isSignedIn(status);
    this.set({ status });
    if (nowSignedIn && !wasSignedIn && this.state.dialog === 'account') void this.loadAccount();
    if (!nowSignedIn && wasSignedIn) this.set({ account: undefined, devices: [] });
  }

  /** The page became visible: sync, at most once a minute. */
  onVisible(): void {
    const t = (this.deps.now ?? Date.now)();
    if (t - this.lastVisibleSync < SYNC_THROTTLE_MS) return;
    if (!isSignedIn(this.state.status)) return;
    this.lastVisibleSync = t;
    void this.syncNow();
  }

  // --- requests ------------------------------------------------------------------------------------------------

  private async api(method: Extract<UserDbRequest, { action: 'api' }>['method'], ...args: unknown[]): Promise<unknown> {
    await this.start();
    if (!this.transport) throw { code: 'unavailable' };
    return this.transport.request({ op: 'sync', action: 'api', method, args });
  }

  private async accountCall(method: Extract<UserDbRequest, { action: 'account' }>['method'], ...args: unknown[]): Promise<unknown> {
    await this.start();
    if (!this.transport) throw { code: 'unavailable' };
    return this.transport.request({ op: 'sync', action: 'account', method, args });
  }

  /** Run an action: busy flag, error capture. Resolves true on success. */
  private async run(scope: ErrorScope, fn: () => Promise<void>): Promise<boolean> {
    this.set({ busy: true, error: undefined });
    try {
      await fn();
      return true;
    } catch (err) {
      this.set({ error: { scope, token: failureToken(err) } });
      return false;
    } finally {
      this.set({ busy: false });
    }
  }

  // --- dialog routing ------------------------------------------------------------------------------------------

  /** Open the account dialog on the screen that fits the current state. */
  open(): void {
    const s = this.state.status;
    this.openDialog(s.state === 'signed-out' ? 'signIn' : s.state === 'locked' ? 'unlock' : 'account');
  }

  openDialog(dialog: AccountDialogId): void {
    this.set({ dialog, error: undefined });
    void this.start().then(() => {
      if (dialog === 'account' || dialog === 'privacy') void this.loadAccount();
      if (dialog === 'signUp' || dialog === 'signIn' || dialog === 'recover' || dialog === 'startOver' || dialog === 'resetPassword') void this.loadInfo();
    });
  }

  close(): void {
    // A recovery code is only dismissed by confirming it.
    if (this.state.dialog === 'recovery' && this.state.recoveryCode) return;
    this.set({ dialog: null, error: undefined });
  }

  clearError(): void { if (this.state.error) this.set({ error: undefined }); }
  dismissNotice(): void { if (this.state.notice) this.set({ notice: undefined }); }

  // --- loading -------------------------------------------------------------------------------------------------

  async loadInfo(): Promise<void> {
    if (this.state.info) return;
    try { this.set({ info: (await this.api('info')) as Sync.InfoResponse }); } catch { /* the forms still work */ }
  }

  async loadAccount(): Promise<void> {
    if (!isSignedIn(this.state.status)) return;
    await this.loadInfo();
    try { this.set({ account: (await this.api('account')) as Sync.AccountResponse }); } catch { /* shown without usage */ }
    await this.loadDevices();
  }

  private async loadDevices(): Promise<void> {
    try {
      const r = (await this.api('devices')) as { devices: Array<DeviceRow & { name: string }> };
      this.set({ devices: r.devices.map((d) => ({ id: d.id, name: d.name, lastSeenAt: d.lastSeenAt, current: d.current })) });
    } catch { /* an empty list */ }
  }

  // --- sign up / in / recover ----------------------------------------------------------------------------------

  signUp(v: { email: string; password: string }): Promise<boolean> {
    return this.run('signUp', async () => {
      const r = (await this.accountCall('signUp', v.email, v.password, { terms: true, ageConfirmed: true })) as { recoveryCode: string };
      this.lastEmail = v.email;
      this.set({ recoveryCode: r.recoveryCode, dialog: 'recovery' });
    });
  }

  /** The user typed the recovery code's check characters correctly. */
  confirmRecoveryCode(): void {
    this.set({ recoveryCode: undefined, dialog: 'account', error: undefined });
    void this.loadAccount();
  }

  signIn(v: { email: string; password: string; remember: boolean }): Promise<boolean> {
    return this.run('signIn', async () => {
      await this.applyRemember(v.remember);
      await this.accountCall('signIn', v.email, v.password);
      this.lastEmail = v.email;
      this.set({ dialog: 'account' });
      void this.loadAccount();
    });
  }

  /** Unlock a locked session: a sign-in with the remembered e-mail. */
  unlock(password: string): Promise<boolean> {
    return this.run('unlock', async () => {
      const email = this.state.status.accountEmail;
      if (!email) throw { code: 'not_signed_in' };
      await this.accountCall('signIn', email, password);
      this.set({ dialog: 'account' });
      void this.loadAccount();
    });
  }

  private async applyRemember(next: boolean): Promise<void> {
    if (next === this.remember) return;
    this.writeRemember(next);
    await this.configure(); // the worker moves the stored secrets
  }

  recover(v: { email: string; code: string; newPassword: string }): Promise<boolean> {
    return this.run('recover', async () => {
      const r = (await this.accountCall('signInWithRecoveryCode', v.email, v.code, v.newPassword)) as { recoveryCode: string };
      this.lastEmail = v.email;
      this.set({ recoveryCode: r.recoveryCode, dialog: 'recovery' });
    });
  }

  /** "I do not have my code": e-mail a reset link. Always looks successful to the user (no enumeration). */
  requestStartOver(email: string): Promise<boolean> {
    return this.run('recover', async () => {
      await this.api('reset', email);
      this.set({ notice: { id: 'resetStarted' } });
    });
  }

  /** The reset e-mail's link: a new password plus the token starts over with an empty account. */
  beginReset(token: string): void {
    this.resetToken = token;
    this.openDialog('resetPassword');
  }

  resetPassword(password: string): Promise<boolean> {
    return this.run('resetPassword', async () => {
      const token = this.resetToken;
      if (!token) throw { code: 'bad_request' };
      const r = (await this.accountCall('startOver', token, password)) as { recoveryCode: string };
      this.resetToken = null;
      this.set({ recoveryCode: r.recoveryCode, dialog: 'recovery' });
    });
  }

  // --- signed-in actions ---------------------------------------------------------------------------------------

  changePassword(v: { current: string; next: string; signOutOthers: boolean }): Promise<boolean> {
    return this.run('changePassword', async () => {
      await this.accountCall('changePassword', v.current, v.next, v.signOutOthers);
      this.set({ dialog: 'account' });
      void this.loadDevices();
    });
  }

  newRecoveryCode(password: string): Promise<boolean> {
    return this.run('changePassword', async () => {
      const r = (await this.accountCall('regenerateRecoveryCode', password)) as { recoveryCode: string };
      this.set({ recoveryCode: r.recoveryCode, dialog: 'recovery' });
    });
  }

  revokeDevice(id: string): Promise<boolean> {
    return this.run('account', async () => {
      await this.api('revokeDevice', id);
      await this.loadDevices();
    });
  }

  signOut(wipeLocal: boolean): Promise<boolean> {
    return this.run('account', async () => {
      await this.accountCall('signOut', { wipeLocal });
      this.set({ dialog: null, account: undefined, devices: [], notice: { id: 'signedOut' } });
    });
  }

  deleteAccount(password: string): Promise<boolean> {
    return this.run('privacy', async () => {
      await this.accountCall('deleteAccount', password);
      this.set({ dialog: null, account: undefined, devices: [], notice: { id: 'signedOut' } });
    });
  }

  async syncNow(): Promise<void> {
    await this.start();
    try { await this.transport?.request({ op: 'sync', action: 'syncNow' }); } catch { /* the status shows it */ }
  }

  resendVerification(): Promise<boolean> {
    return this.run('account', async () => {
      await this.api('resendVerification');
      this.set({ notice: { id: 'resent' } });
    });
  }

  /** The verification e-mail's link. */
  async verifyEmail(token: string): Promise<boolean> {
    try {
      await this.api('verifyEmail', token);
      this.set({ notice: { id: 'verified' } });
      if (isSignedIn(this.state.status)) void this.loadAccount();
      return true;
    } catch (err) {
      this.set({ notice: { id: 'verifyFailed', token: failureToken(err) } });
      return false;
    }
  }

  // --- privacy exports -----------------------------------------------------------------------------------------

  exportServerData(): Promise<boolean> {
    return this.run('privacy', async () => {
      const data = await this.api('exportAll');
      const day = new Date((this.deps.now ?? Date.now)()).toISOString().slice(0, 10);
      this.deps.saveFile?.(`kth-sync-export-${day}.json`, 'application/json', JSON.stringify(data, null, 2));
      this.set({ notice: { id: 'exported' } });
    });
  }

  /** Readable (zip) backup: the existing web user-data backup until full backups land. */
  exportPlain(): Promise<boolean> {
    return this.run('privacy', async () => {
      await this.deps.backup?.();
      this.set({ notice: { id: 'exported' } });
    });
  }

  exportEncrypted(password: string): Promise<boolean> {
    return this.run('privacy', async () => {
      await this.deps.backup?.(password);
      this.set({ dialog: 'privacy', notice: { id: 'exported' } });
    });
  }

  /** Offer the recovery code as a text file (the code is also on screen). */
  saveRecoveryCode(): void {
    const code = this.state.recoveryCode;
    if (!code) return;
    const text = `Keep Thy Heart recovery code\n${this.knownEmail}\n\n${code}\n\nAnyone with this code can recover your account. Keep it private.\n`;
    this.deps.saveFile?.('kth-recovery-code.txt', 'text/plain', text);
  }

  /** The e-mail typed last (for the password-strength dictionary). */
  get knownEmail(): string { return this.state.status.accountEmail ?? this.lastEmail; }
}

export function isSignedIn(status: Sync.SyncStatus): boolean {
  return status.state !== 'signed-out' && status.state !== 'locked';
}
