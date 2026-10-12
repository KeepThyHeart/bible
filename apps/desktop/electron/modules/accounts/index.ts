/**
 * Accounts and sync, desktop main half (task 0150 M3).
 *
 * Registers one `module:accounts:<method>` handler per `AccountsApi` method and pushes `statusChanged` on
 * `module:accounts:event:statusChanged`. The renderer calls `createModuleClient<AccountsApi, AccountsEvents>('accounts')`.
 *
 * Cheap at startup: only the handlers, a restore listener and one deferred timer exist. The sync stack (`./service`,
 * `DesktopSyncService`) loads on the first call or when the timer fires 5 s after launch to resume a signed-in account.
 * A backup restore pauses the engine (and waits for a running sync) before it writes, and restarts it afterwards.
 *
 * Failures are `IpcKnownError`s whose message is the `AccountsFailure` token (see `toAccountsError`).
 */
import type { UserDataRestoredEvent } from '../../services/userDataEvents';
import type { FeatureMainModule, MainModuleDeps, ModuleIpc } from '../FeatureMainModule';
import type { DesktopSyncService } from '../../services/sync/DesktopSyncService';
import type { AccountsApi } from './types';

export const ACCOUNTS_MODULE_ID = 'accounts';

/** Every `AccountsApi` method, in the order of types.ts. */
export const ACCOUNTS_API_METHODS = [
  'status', 'info', 'signUp', 'signIn', 'unlock', 'recover', 'signOut', 'changePassword', 'newRecoveryCode', 'rotate',
  'devices', 'revokeDevice', 'syncNow', 'setServerUrl', 'setAskPasswordEachLaunch', 'requestStartOver',
  'resendVerification', 'saveRecoveryCode', 'deleteAccount', 'exportServerData',
] as const satisfies ReadonlyArray<keyof AccountsApi>;

type ApiMethod = (typeof ACCOUNTS_API_METHODS)[number];

export interface AccountsMainEnv {
  createService(deps: MainModuleDeps): Promise<DesktopSyncService>;
  onUserDataRestoring(listener: (event: UserDataRestoredEvent) => void | Promise<void>): () => void;
  onUserDataRestored(listener: (event: UserDataRestoredEvent) => void): () => void;
  /** Delay before a signed-in account is resumed after launch. Default 5 s. */
  readonly resumeDelayMs?: number;
}

function lazyEvents(subscribe: (m: typeof import('../../services/userDataEvents')) => () => void): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  void import('../../services/userDataEvents').then((m) => {
    if (!cancelled) off = subscribe(m);
  });
  return () => {
    cancelled = true;
    off?.();
  };
}

const defaultEnv: AccountsMainEnv = {
  createService: async (deps) => (await import('./service')).createAccountsService(deps),
  onUserDataRestoring: (listener) => lazyEvents((m) => m.onUserDataRestoring(listener)),
  onUserDataRestored: (listener) => lazyEvents((m) => m.onUserDataRestored(listener)),
};

export function createAccountsMainModule(envOverrides: Partial<AccountsMainEnv> = {}): FeatureMainModule {
  const env: AccountsMainEnv = { ...defaultEnv, ...envOverrides };
  let servicePromise: Promise<DesktopSyncService> | null = null;
  let service: DesktopSyncService | null = null;
  let unsubscribeStatus: (() => void) | null = null;
  const cleanups: Array<() => void> = [];
  let closed = false;

  const register = (ipc: ModuleIpc, deps: MainModuleDeps): void => {
    const get = (): Promise<DesktopSyncService> => {
      if (!servicePromise) {
        servicePromise = env
          .createService(deps)
          .then((svc) => {
            if (closed) {
              svc.close();
              throw new Error('accounts module closed');
            }
            service = svc;
            unsubscribeStatus = svc.status.subscribe(() => ipc.send('statusChanged', svc.status.getSnapshot()));
            return svc;
          })
          .catch((err: unknown) => {
            servicePromise = null; // a failed start is retried on the next call
            throw err;
          });
      }
      return servicePromise;
    };

    const call = async (method: ApiMethod, svc: DesktopSyncService, args: unknown[]): Promise<unknown> => {
      if (method === 'status') return svc.getStatus();
      return (svc[method] as (...a: unknown[]) => Promise<unknown>)(...args);
    };

    for (const method of ACCOUNTS_API_METHODS) {
      ipc.handle(method, async (...args: unknown[]) => {
        try {
          return await call(method, await get(), args);
        } catch (err) {
          throw (await import('../../services/sync/DesktopSyncService')).toAccountsError(err);
        }
      });
    }

    cleanups.push(
      env.onUserDataRestoring(async () => {
        if (service) await service.pause();
      }),
      env.onUserDataRestored(() => {
        service?.resume();
      }),
    );

    // Resume a signed-in account a little after launch (locked when the keys are not available).
    const timer = setTimeout(() => {
      void get()
        .then((svc) => svc.resumeIfSignedIn())
        .catch((err: unknown) => deps.log.warn('[accounts] startup resume failed:', err instanceof Error ? err.name : err));
    }, env.resumeDelayMs ?? 5_000);
    (timer as { unref?: () => void }).unref?.();
    cleanups.push(() => clearTimeout(timer));
  };

  const close = (): void => {
    closed = true;
    for (const c of cleanups.splice(0)) c();
    unsubscribeStatus?.();
    unsubscribeStatus = null;
    service?.close();
    service = null;
    servicePromise = null;
  };

  return {
    id: ACCOUNTS_MODULE_ID,
    registerIpc(ipc, deps) {
      register(ipc, deps);
      return { dispose: close };
    },
    close,
  };
}

export default createAccountsMainModule();
