import { describe, expect, it, vi } from 'vitest';
import type { UserDbEvent, UserDbRequest } from '../../userdb/protocol';
import { AccountStore, REMEMBER_KEY, SYNC_THROTTLE_MS } from './accountStore';
import type { AccountsTransport } from './accountStore';
import { failureToken } from './errors';

const SIGNED_OUT = { state: 'signed-out', pending: 0, opaque: 0 } as const;

function fakeTransport(handler: (req: UserDbRequest) => unknown) {
  const listeners = new Set<(e: UserDbEvent) => void>();
  const requests: UserDbRequest[] = [];
  const transport: AccountsTransport = {
    async request(req) {
      requests.push(req);
      const out = handler(req);
      if (out instanceof Error) throw out;
      return out;
    },
    onEvent(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };
  return { transport, requests, emit: (e: UserDbEvent) => listeners.forEach((l) => l(e)) };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
}

function codeError(code: string): Error {
  return Object.assign(new Error('raw server text that must never show'), { code });
}

function setup(over: Partial<ConstructorParameters<typeof AccountStore>[0]> = {}, handler?: (req: UserDbRequest) => unknown) {
  const fake = fakeTransport(handler ?? ((req) => {
    if (req.op !== 'sync') return null;
    if (req.action === 'configure' || req.action === 'status') return SIGNED_OUT;
    if (req.action === 'account') {
      if (req.method === 'signUp' || req.method === 'signInWithRecoveryCode' || req.method === 'regenerateRecoveryCode' || req.method === 'startOver') {
        return { recoveryCode: 'AAAA-BBBB' };
      }
      return null;
    }
    if (req.action === 'api') {
      if (req.method === 'info') return { apiVersion: 1, signupOpen: true, quotaBytes: 1000, minKdf: { m: 1, t: 1 }, minAge: 13 };
      if (req.method === 'account') return { email: 'a@b.c', emailVerified: false, bytesUsed: 5, quotaBytes: 1000, createdAt: '', recordCount: 0 };
      if (req.method === 'devices') return { devices: [{ id: 'd1', name: 'Chrome', createdAt: '', lastSeenAt: '2026-01-01T00:00:00Z', userAgent: null, current: true }] };
      if (req.method === 'exportAll') return { format: 'kth-sync-export', version: 1 };
      return null;
    }
    return null;
  }));
  const storage = memoryStorage();
  const saved: Array<{ name: string; text: string }> = [];
  const store = new AccountStore({
    connect: async () => fake.transport,
    baseUrl: 'http://localhost:3000',
    storage,
    saveFile: (name, _mime, text) => { saved.push({ name, text }); },
    backup: vi.fn(async () => undefined),
    ...over,
  });
  return { store, storage, saved, ...fake };
}

describe('start', () => {
  it('sends configure with the origin, remember default off and the catalog, then reflects status events', async () => {
    const modules = { list: () => [{ id: 7, abbr: 'KJV' }], subscribe: vi.fn(() => () => undefined) };
    const { store, requests, emit } = setup({ modules });
    await store.start();
    const configure = requests.find((r) => r.op === 'sync' && r.action === 'configure');
    expect(configure).toEqual({ op: 'sync', action: 'configure', baseUrl: 'http://localhost:3000', remember: false, modules: [{ id: 7, abbr: 'KJV' }] });
    emit({ event: 'syncStatus', status: { state: 'idle', accountEmail: 'a@b.c', pending: 2, opaque: 0 } });
    expect(store.getSnapshot().status.state).toBe('idle');
  });

  it('re-sends configure when the catalog loads', async () => {
    let cb: () => void = () => undefined;
    let list: Array<{ id: number; abbr: string }> = [];
    const modules = { list: () => list, subscribe: (f: () => void) => { cb = f; return () => undefined; } };
    const { store, requests } = setup({ modules });
    await store.start();
    list = [{ id: 1, abbr: 'ESV' }];
    cb();
    await vi.waitFor(() => expect(requests.filter((r) => r.op === 'sync' && r.action === 'configure')).toHaveLength(2));
    expect((requests[requests.length - 1] as { modules: unknown }).modules).toEqual([{ id: 1, abbr: 'ESV' }]);
  });

  it('reads the remembered choice from localStorage', async () => {
    const { store, requests } = setup({ storage: memoryStorage({ [REMEMBER_KEY]: 'true' }) });
    await store.start();
    expect((requests[0] as { remember: boolean }).remember).toBe(true);
  });

  it('reports unavailable when the worker cannot open', async () => {
    const store = new AccountStore({ connect: async () => { throw codeError('unsupported'); }, storage: memoryStorage() });
    await store.start();
    expect(store.getSnapshot().available).toBe(false);
  });
});

describe('sign-up flow', () => {
  it('sign-up shows the recovery step; confirming moves to the account and keeps no code', async () => {
    const { store, requests } = setup();
    store.openDialog('signUp');
    expect(await store.signUp({ email: 'a@b.c', password: 'correct horse battery' })).toBe(true);
    expect(store.getSnapshot().dialog).toBe('recovery');
    expect(store.getSnapshot().recoveryCode).toBe('AAAA-BBBB');
    expect(requests).toContainEqual({ op: 'sync', action: 'account', method: 'signUp', args: ['a@b.c', 'correct horse battery', { terms: true, ageConfirmed: true }] });
    store.close(); // refused while the code is unconfirmed
    expect(store.getSnapshot().dialog).toBe('recovery');
    store.confirmRecoveryCode();
    expect(store.getSnapshot().recoveryCode).toBeUndefined();
    expect(store.getSnapshot().dialog).toBe('account');
  });

  it('a failure sets a scoped error token, never the raw message', async () => {
    const { store } = setup({}, (req) => (req.op === 'sync' && req.action === 'account' ? codeError('conflict_email') : SIGNED_OUT));
    expect(await store.signUp({ email: 'a@b.c', password: 'x' })).toBe(false);
    expect(store.getSnapshot().error).toEqual({ scope: 'signUp', token: 'conflict_email' });
    expect(JSON.stringify(store.getSnapshot())).not.toContain('raw server text');
    expect(store.getSnapshot().busy).toBe(false);
  });

  it('saves the recovery code as a text file on request', async () => {
    const { store, saved } = setup();
    await store.signUp({ email: 'a@b.c', password: 'pw' });
    store.saveRecoveryCode();
    expect(saved[0].name).toBe('kth-recovery-code.txt');
    expect(saved[0].text).toContain('AAAA-BBBB');
  });
});

describe('sign-in', () => {
  it('persists a changed remember choice and re-configures before signing in', async () => {
    const { store, storage, requests } = setup();
    await store.start();
    await store.signIn({ email: 'a@b.c', password: 'pw', remember: true });
    expect(storage.data[REMEMBER_KEY]).toBe('true');
    const order = requests.filter((r) => r.op === 'sync').map((r) => (r as { action: string }).action);
    expect(order.slice(0, 3)).toEqual(['configure', 'configure', 'account']);
    expect((requests.filter((r) => r.op === 'sync' && r.action === 'configure')[1] as { remember: boolean }).remember).toBe(true);
    expect(store.getSnapshot().dialog).toBe('account');
  });

  it('keeps remember off by default (no write, no second configure)', async () => {
    const { store, storage, requests } = setup();
    await store.start();
    await store.signIn({ email: 'a@b.c', password: 'pw', remember: false });
    expect(storage.data[REMEMBER_KEY]).toBeUndefined();
    expect(requests.filter((r) => r.op === 'sync' && r.action === 'configure')).toHaveLength(1);
  });

  it('unlock is a sign-in with the remembered e-mail', async () => {
    const { store, requests, emit } = setup();
    await store.start();
    emit({ event: 'syncStatus', status: { state: 'locked', accountEmail: 'me@x.org', pending: 0, opaque: 0 } });
    store.open();
    expect(store.getSnapshot().dialog).toBe('unlock');
    await store.unlock('pw');
    expect(requests).toContainEqual({ op: 'sync', action: 'account', method: 'signIn', args: ['me@x.org', 'pw'] });
  });

  it('open() routes by state', async () => {
    const { store, emit } = setup();
    await store.start();
    store.open();
    expect(store.getSnapshot().dialog).toBe('signIn');
    store.close();
    emit({ event: 'syncStatus', status: { state: 'idle', accountEmail: 'a@b.c', pending: 0, opaque: 0 } });
    store.open();
    expect(store.getSnapshot().dialog).toBe('account');
  });
});

describe('recovery, reset and handoffs', () => {
  it('recover with a code leads to a fresh recovery code', async () => {
    const { store, requests } = setup();
    await store.recover({ email: 'a@b.c', code: 'CODE', newPassword: 'new' });
    expect(requests).toContainEqual({ op: 'sync', action: 'account', method: 'signInWithRecoveryCode', args: ['a@b.c', 'CODE', 'new'] });
    expect(store.getSnapshot().dialog).toBe('recovery');
  });

  it('start over by e-mail calls api reset', async () => {
    const { store, requests } = setup();
    await store.requestStartOver('a@b.c');
    expect(requests).toContainEqual({ op: 'sync', action: 'api', method: 'reset', args: ['a@b.c'] });
  });

  it('a reset link opens the new-password screen; submitting calls startOver(token, password)', async () => {
    const { store, requests } = setup();
    store.beginReset('tok');
    expect(store.getSnapshot().dialog).toBe('resetPassword');
    await store.resetPassword('new-pass');
    expect(requests).toContainEqual({ op: 'sync', action: 'account', method: 'startOver', args: ['tok', 'new-pass'] });
    expect(store.getSnapshot().dialog).toBe('recovery');
  });

  it('a verify link calls api verifyEmail and sets a notice; a bad token sets a failure notice', async () => {
    const ok = setup();
    expect(await ok.store.verifyEmail('t1')).toBe(true);
    expect(ok.requests).toContainEqual({ op: 'sync', action: 'api', method: 'verifyEmail', args: ['t1'] });
    expect(ok.store.getSnapshot().notice).toEqual({ id: 'verified' });
    const bad = setup({}, (req) => (req.op === 'sync' && req.action === 'api' ? codeError('bad_request') : SIGNED_OUT));
    expect(await bad.store.verifyEmail('t2')).toBe(false);
    expect(bad.store.getSnapshot().notice).toEqual({ id: 'verifyFailed', token: 'bad_request' });
  });
});

describe('signed-in actions', () => {
  it('sign-out with wipe sends signOut {wipeLocal:true}', async () => {
    const { store, requests } = setup();
    await store.signOut(true);
    expect(requests).toContainEqual({ op: 'sync', action: 'account', method: 'signOut', args: [{ wipeLocal: true }] });
    expect(store.getSnapshot().dialog).toBeNull();
  });

  it('sign-out and keep sends wipeLocal false', async () => {
    const { store, requests } = setup();
    await store.signOut(false);
    expect(requests).toContainEqual({ op: 'sync', action: 'account', method: 'signOut', args: [{ wipeLocal: false }] });
  });

  it('change password, new recovery code, revoke and delete go to the host', async () => {
    const { store, requests } = setup();
    await store.changePassword({ current: 'a', next: 'b', signOutOthers: true });
    expect(requests).toContainEqual({ op: 'sync', action: 'account', method: 'changePassword', args: ['a', 'b', true] });
    expect(store.getSnapshot().dialog).toBe('account');
    await store.newRecoveryCode('pw');
    expect(requests).toContainEqual({ op: 'sync', action: 'account', method: 'regenerateRecoveryCode', args: ['pw'] });
    await store.revokeDevice('d1');
    expect(requests).toContainEqual({ op: 'sync', action: 'api', method: 'revokeDevice', args: ['d1'] });
    await store.deleteAccount('pw');
    expect(requests).toContainEqual({ op: 'sync', action: 'account', method: 'deleteAccount', args: ['pw'] });
  });

  it('loads devices and usage when the account dialog opens while signed in', async () => {
    const { store, emit } = setup();
    await store.start();
    emit({ event: 'syncStatus', status: { state: 'idle', accountEmail: 'a@b.c', pending: 0, opaque: 0 } });
    store.openDialog('account');
    await vi.waitFor(() => expect(store.getSnapshot().devices).toHaveLength(1));
    expect(store.getSnapshot().account?.emailVerified).toBe(false);
    expect(store.getSnapshot().devices[0]).toEqual({ id: 'd1', name: 'Chrome', lastSeenAt: '2026-01-01T00:00:00Z', current: true });
  });

  it('resend verification calls api resendVerification', async () => {
    const { store, requests } = setup();
    await store.resendVerification();
    expect(requests).toContainEqual({ op: 'sync', action: 'api', method: 'resendVerification', args: [] });
    expect(store.getSnapshot().notice?.id).toBe('resent');
  });
});

describe('exports', () => {
  it('server export downloads the exportAll JSON', async () => {
    const { store, saved } = setup({ now: () => Date.UTC(2026, 9, 12) });
    expect(await store.exportServerData()).toBe(true);
    expect(saved[0].name).toBe('kth-sync-export-2026-10-12.json');
    expect(JSON.parse(saved[0].text)).toEqual({ format: 'kth-sync-export', version: 1 });
  });

  it('plain and encrypted exports use the existing user-data backup', async () => {
    const backup = vi.fn(async () => undefined);
    const { store } = setup({ backup });
    await store.exportPlain();
    expect(backup).toHaveBeenLastCalledWith();
    await store.exportEncrypted('secret');
    expect(backup).toHaveBeenLastCalledWith('secret');
  });
});

describe('visibility sync', () => {
  it('syncs when visible, at most once per minute, only while signed in', async () => {
    let now = 1_000_000;
    const { store, requests, emit } = setup({ now: () => now });
    await store.start();
    store.onVisible();
    expect(requests.some((r) => r.op === 'sync' && r.action === 'syncNow')).toBe(false);
    emit({ event: 'syncStatus', status: { state: 'idle', accountEmail: 'a@b.c', pending: 0, opaque: 0 } });
    const count = () => requests.filter((r) => r.op === 'sync' && r.action === 'syncNow').length;
    store.onVisible();
    await vi.waitFor(() => expect(count()).toBe(1));
    now += SYNC_THROTTLE_MS - 1;
    store.onVisible();
    expect(count()).toBe(1);
    now += 2;
    store.onVisible();
    await vi.waitFor(() => expect(count()).toBe(2));
  });
});

describe('failureToken', () => {
  it('maps worker codes, aliases and unknowns', () => {
    expect(failureToken(codeError('invalid_credentials'))).toBe('invalid_credentials');
    expect(failureToken(codeError('not_configured'))).toBe('unavailable');
    expect(failureToken(codeError('open_timeout'))).toBe('unavailable');
    expect(failureToken(codeError('weird'))).toBe('internal');
    expect(failureToken(new Error('x'))).toBe('internal');
    expect(failureToken('rate_limited')).toBe('rate_limited');
  });
});
