/**
 * Accounts renderer state (task 0150): the sync status pushed by main, the settings/server info, the device list
 * and the one-off UI state of the Account section. Nothing secret is kept except `pendingRecoveryCode`, which lives
 * in memory only until the user confirms they saved it (it is never persisted or logged).
 */
import { create } from 'zustand';
import type { Sync } from '@bible/core/browser';
import type { AccountDevice, AccountsInfo } from '../../../../electron/modules/accounts/types';
import { accountsClient } from './accountsClient';
import { failureToken, type AccountsFailureToken } from './errors';

/** Which part of the section an error belongs to, so a failure shows next to the form that caused it. */
export type AccountsErrorScope =
  | 'server' | 'signIn' | 'signUp' | 'recover' | 'unlock' | 'changePassword' | 'account' | 'recoveryCode';

export interface AccountsState {
  status: Sync.SyncStatus | null;
  info: AccountsInfo | null;
  devices: AccountDevice[];
  /** A request is in flight (disables the forms). */
  busy: boolean;
  error: { scope: AccountsErrorScope; token: AccountsFailureToken } | null;
  /** Shown by the RecoveryCodeStep after signUp/recover/newRecoveryCode/rotate; cleared only by `confirmRecoveryCode`. */
  pendingRecoveryCode: string | null;
  setStatus(status: Sync.SyncStatus): void;
  refreshStatus(): Promise<void>;
  refresh(): Promise<void>;
  clearError(): void;
  confirmRecoveryCode(): void;
  setServerUrl(url: string): Promise<void>;
  setAskPasswordEachLaunch(on: boolean): Promise<void>;
  signUp(v: { email: string; password: string; consent: Sync.SignupRequest['consent'] }): Promise<void>;
  signIn(v: { email: string; password: string; remember: boolean }): Promise<void>;
  unlock(password: string): Promise<void>;
  recover(v: { email: string; code: string; newPassword: string }): Promise<void>;
  requestStartOver(email: string): Promise<void>;
  changePassword(v: { current: string; next: string; signOutOthers: boolean }): Promise<void>;
  newRecoveryCode(currentPassword: string): Promise<void>;
  signOut(wipeLocal: boolean): Promise<void>;
  syncNow(): Promise<void>;
  revokeDevice(id: string): Promise<void>;
  resendVerification(): Promise<void>;
  saveRecoveryCode(): Promise<void>;
  exportServerData(): Promise<void>;
  deleteAccount(password: string): Promise<void>;
}

export const useAccountsStore = create<AccountsState>((set, get) => {
  /** Runs one request: busy flag, error capture (scoped), then a refresh of what a state change may have altered. */
  async function run<T>(scope: AccountsErrorScope, fn: () => Promise<T>, opts: { rethrow?: boolean } = {}): Promise<T | undefined> {
    set({ busy: true, error: null });
    try {
      const out = await fn();
      return out;
    } catch (err) {
      set({ error: { scope, token: failureToken(err) } });
      if (opts.rethrow) throw err;
      return undefined;
    } finally {
      set({ busy: false });
    }
  }

  return {
    status: null,
    info: null,
    devices: [],
    busy: false,
    error: null,
    pendingRecoveryCode: null,

    setStatus(status) {
      const was = get().status;
      set({ status });
      // Signing in/out (or an unlock) changes what the section shows: re-read info and devices.
      if (!was || was.state !== status.state && (was.state === 'signed-out' || was.state === 'locked' || status.state === 'signed-out' || status.state === 'locked')) {
        void get().refresh();
      }
    },

    async refreshStatus() {
      try {
        set({ status: await accountsClient.status() });
      } catch {
        /* no bridge or main not ready: the section shows its loading state */
      }
    },

    async refresh() {
      try {
        const [status, info] = await Promise.all([accountsClient.status(), accountsClient.info()]);
        set({ status, info });
        if (status.state !== 'signed-out' && status.state !== 'locked') {
          set({ devices: await accountsClient.devices().catch(() => get().devices) });
        } else {
          set({ devices: [] });
        }
      } catch (err) {
        set({ error: { scope: 'account', token: failureToken(err) } });
      }
    },

    clearError() { set({ error: null }); },
    confirmRecoveryCode() { set({ pendingRecoveryCode: null }); },

    async setServerUrl(url) {
      const settings = await run('server', () => accountsClient.setServerUrl(url));
      if (settings) await get().refresh();
    },

    async setAskPasswordEachLaunch(on) {
      const settings = await run('account', () => accountsClient.setAskPasswordEachLaunch(on));
      if (settings) await get().refresh();
    },

    async signUp(v) {
      const out = await run('signUp', () => accountsClient.signUp(v));
      if (out) set({ pendingRecoveryCode: out.recoveryCode });
      await get().refresh();
    },

    async signIn(v) {
      const ok = await run('signIn', async () => { await accountsClient.signIn(v); return true; });
      if (ok) await get().refresh();
    },

    async unlock(password) {
      const ok = await run('unlock', async () => { await accountsClient.unlock({ password }); return true; });
      if (ok) await get().refresh();
    },

    async recover(v) {
      const out = await run('recover', () => accountsClient.recover(v));
      if (out) set({ pendingRecoveryCode: out.recoveryCode });
      await get().refresh();
    },

    async requestStartOver(email) {
      await run('recover', () => accountsClient.requestStartOver({ email }), { rethrow: true });
    },

    async changePassword(v) {
      const ok = await run('changePassword', async () => { await accountsClient.changePassword(v); return true; });
      if (ok) await get().refresh();
    },

    async newRecoveryCode(currentPassword) {
      const out = await run('changePassword', () => accountsClient.newRecoveryCode({ currentPassword }));
      if (out) set({ pendingRecoveryCode: out.recoveryCode });
    },

    async signOut(wipeLocal) {
      const ok = await run('account', async () => { await accountsClient.signOut({ wipeLocal }); return true; });
      if (ok) set({ pendingRecoveryCode: null });
      await get().refresh();
    },

    async syncNow() {
      await run('account', () => accountsClient.syncNow());
      await get().refresh();
    },

    async revokeDevice(id) {
      await run('account', () => accountsClient.revokeDevice(id));
      await get().refresh();
    },

    async resendVerification() {
      await run('account', () => accountsClient.resendVerification());
    },

    async saveRecoveryCode() {
      const code = get().pendingRecoveryCode;
      if (!code) return;
      await run('recoveryCode', () => accountsClient.saveRecoveryCode({ code }));
    },

    async exportServerData() {
      await run('account', () => accountsClient.exportServerData());
    },

    async deleteAccount(password) {
      const ok = await run('account', async () => { await accountsClient.deleteAccount({ password }); return true; });
      if (ok) set({ pendingRecoveryCode: null });
      await get().refresh();
    },
  };
});
