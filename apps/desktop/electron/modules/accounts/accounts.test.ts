// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Sync } from '@bible/core';
import { IpcKnownError } from '../../ipc/result';
import type { MainModuleDeps, ModuleIpc } from '../FeatureMainModule';
import type { DesktopSyncService } from '../../services/sync/DesktopSyncService';
import { NetworkBlockedError } from '../../services/NetworkGateway';
import { accountsMainManifest } from './manifest';
import { ACCOUNTS_API_METHODS, createAccountsMainModule } from './index';
import { ACCOUNTS_IPC_ERROR_CODES } from './types';

function fakeIpc() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const sent: Array<{ name: string; args: unknown[] }> = [];
  const ipc: ModuleIpc = {
    id: 'accounts',
    handle: (m, fn) => { handlers.set(m, fn as never); },
    send: (name, ...args) => { sent.push({ name, args }); },
    channels: () => [...handlers.keys()],
    dispose() {},
  };
  return { ipc, handlers, sent };
}

const deps = { userDataPath: '/tmp/x', getWindows: () => [], log: { info() {}, warn: vi.fn(), error() {} } } as MainModuleDeps;

function fakeService() {
  const status = Sync.createSyncStatusStore({ state: 'signed-out' });
  const calls: Array<[string, unknown[]]> = [];
  const svc: Record<string, unknown> = {
    status,
    getStatus: async () => status.getSnapshot(),
    resumeIfSignedIn: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(),
    close: vi.fn(),
    fail: undefined,
  };
  for (const m of ACCOUNTS_API_METHODS) {
    if (m === 'status') continue;
    svc[m] = async (...args: unknown[]) => {
      calls.push([m, args]);
      if (svc.fail) throw svc.fail;
      return { ok: m };
    };
  }
  return { svc: svc as unknown as DesktopSyncService & { fail?: unknown }, calls, status };
}

function setup(over: Partial<Parameters<typeof createAccountsMainModule>[0]> = {}) {
  const f = fakeService();
  const restoring: Array<() => Promise<void>> = [];
  const restored: Array<() => void> = [];
  const createService = vi.fn(async () => f.svc);
  const mod = createAccountsMainModule({
    createService,
    onUserDataRestoring: (l) => { restoring.push(l as never); return () => undefined; },
    onUserDataRestored: (l) => { restored.push(l as never); return () => undefined; },
    resumeDelayMs: 20,
    ...over,
  });
  const io = fakeIpc();
  const disposable = mod.registerIpc(io.ipc, deps);
  return { ...f, ...io, mod, createService, restoring, restored, disposable };
}

describe('accounts main module', () => {
  it('has a flagged, desktop-only manifest', () => {
    expect(accountsMainManifest).toMatchObject({ id: 'accounts', flag: 'accounts', platforms: ['desktop'], activationEvents: ['onStartupFinished'] });
  });

  it('registers one handler per AccountsApi method without loading the service', () => {
    const s = setup({ resumeDelayMs: 60_000 });
    expect([...s.handlers.keys()].sort()).toEqual([...ACCOUNTS_API_METHODS].sort());
    expect(s.handlers.size).toBe(20);
    expect(s.createService).not.toHaveBeenCalled();
    s.mod.close?.();
  });

  it('creates the service on the first call and forwards arguments', async () => {
    const s = setup({ resumeDelayMs: 60_000 });
    expect(await s.handlers.get('signIn')!({ email: 'a@b.co', password: 'p', remember: true })).toEqual({ ok: 'signIn' });
    expect(s.calls[0]).toEqual(['signIn', [{ email: 'a@b.co', password: 'p', remember: true }]]);
    expect(await s.handlers.get('status')!()).toEqual({ state: 'signed-out', pending: 0, opaque: 0 });
    await s.handlers.get('info')!();
    expect(s.createService).toHaveBeenCalledTimes(1);
    s.mod.close?.();
  });

  it('pushes statusChanged to the window', async () => {
    const s = setup({ resumeDelayMs: 60_000 });
    await s.handlers.get('status')!();
    s.status.set({ state: 'syncing' });
    s.status.set({ state: 'idle', lastSyncedAt: 'now' });
    expect(s.sent.map((m) => m.name)).toEqual(['statusChanged', 'statusChanged']);
    expect(s.sent[1].args[0]).toMatchObject({ state: 'idle', lastSyncedAt: 'now' });
    s.mod.close?.();
  });

  it('maps failures to IpcKnownError tokens and maps unknown errors to a sanitised internal error', async () => {
    const s = setup({ resumeDelayMs: 60_000 });
    const handler = s.handlers.get('signIn')!;
    (s.svc as { fail?: unknown }).fail = new NetworkBlockedError('sync');
    await expect(handler({})).rejects.toMatchObject({ code: 'network_blocked', message: 'network_blocked' });
    (s.svc as { fail?: unknown }).fail = new Sync.SyncHttpError(429, null);
    const err = (await (handler({}) as Promise<unknown>).catch((e: unknown) => e)) as IpcKnownError;
    expect(err).toBeInstanceOf(IpcKnownError);
    expect(err.message).toBe('rate_limited');
    expect(err.code).toBe(ACCOUNTS_IPC_ERROR_CODES.rate_limited);
    const warn = deps.log.warn as ReturnType<typeof vi.fn>;
    warn.mockClear();
    (s.svc as { fail?: unknown }).fail = new Error('secret-pw');
    const internal = (await (handler({}) as Promise<unknown>).catch((e: unknown) => e)) as IpcKnownError;
    expect(internal).toBeInstanceOf(IpcKnownError);
    expect(internal.code).toBe('internal');
    expect(internal.message).toBe('internal');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-pw');
    expect(warn).toHaveBeenCalledWith('[accounts] signIn failed (Error)');
    s.mod.close?.();
  });

  it('resumes a signed-in account after the delay', async () => {
    const s = setup({ resumeDelayMs: 5 });
    await vi.waitFor(() => expect(s.svc.resumeIfSignedIn).toHaveBeenCalledTimes(1));
    s.mod.close?.();
  });

  it('a restore pauses the engine before it writes and resumes after', async () => {
    const s = setup({ resumeDelayMs: 5 });
    await vi.waitFor(() => expect(s.svc.resumeIfSignedIn).toHaveBeenCalled());
    await s.restoring[0]();
    expect(s.svc.pause).toHaveBeenCalledTimes(1);
    s.restored[0]();
    expect(s.svc.resume).toHaveBeenCalledTimes(1);
    s.mod.close?.();
  });

  it('a restore before the service exists does not create it', async () => {
    const s = setup({ resumeDelayMs: 60_000 });
    await s.restoring[0]();
    s.restored[0]();
    expect(s.createService).not.toHaveBeenCalled();
    s.mod.close?.();
  });

  it('close() stops the service and cancels the timer', async () => {
    const s = setup({ resumeDelayMs: 30 });
    await s.handlers.get('status')!();
    await s.mod.close?.();
    expect(s.svc.close).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 60));
    expect(s.svc.resumeIfSignedIn).not.toHaveBeenCalled();
  });

  it('retries after a failed start', async () => {
    let n = 0;
    const f = fakeService();
    const s = setup({ resumeDelayMs: 60_000, createService: async () => { if (++n === 1) throw new Error('db'); return f.svc; } });
    await expect(s.handlers.get('status')!()).rejects.toMatchObject({ code: 'internal', message: 'internal' });
    expect(await s.handlers.get('devices')!()).toEqual({ ok: 'devices' });
    s.mod.close?.();
  });
});
