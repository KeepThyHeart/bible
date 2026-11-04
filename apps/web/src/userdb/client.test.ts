// @vitest-environment node
import { afterEach, describe, it, expect, vi } from 'vitest';
import { getUserDbClient, hostApiLookupForTests, isUserDbSupported, registerHostApi, resetUserDbClientForTests } from './client';
import type { LocksLike, UserDbBackend } from './leader';
import { UserDbClient } from './UserDbClient';

afterEach(() => {
  resetUserDbClientForTests();
  vi.unstubAllGlobals();
});

const locks = (): LocksLike => ({ request: (_n, _o, cb) => cb() });
const channel = () => ({ postMessage: () => undefined, addEventListener: () => undefined, close: () => undefined });
const backend = (send: UserDbBackend['send']): UserDbBackend => ({ send, onEvent: () => () => undefined, terminate: () => undefined });

describe('userdb client singleton', () => {
  it('detects missing browser support', () => {
    expect(isUserDbSupported()).toBe(false); // node: no locks / OPFS
    vi.stubGlobal('navigator', { locks: {}, storage: { getDirectory: () => undefined } });
    vi.stubGlobal('BroadcastChannel', class {});
    vi.stubGlobal('Worker', class {});
    expect(isUserDbSupported()).toBe(true);
  });

  it('rejects with unsupported where the browser lacks locks / OPFS', async () => {
    await expect(getUserDbClient()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('opens once and returns the same client', async () => {
    const send = vi.fn(async () => null);
    resetUserDbClientForTests({
      create: () => new UserDbClient({ locks: locks(), createChannel: channel, createBackend: () => backend(send) }),
    });
    const [c1, c2] = await Promise.all([getUserDbClient(), getUserDbClient()]);
    expect(c1).toBe(c2);
    expect(send).toHaveBeenCalledWith({ op: 'open' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('repo() proxy is not thenable: awaiting it sends no request, real methods still call the worker', async () => {
    const send = vi.fn(async () => 'v');
    const client = new UserDbClient({ locks: locks(), createChannel: channel, createBackend: () => backend(send) });
    await new Promise((r) => setTimeout(r, 0));
    const proxy = client.repo('annotations');
    expect((proxy as { then?: unknown }).then).toBeUndefined();
    expect(await Promise.resolve(proxy)).toBe(proxy);
    expect(await (async () => proxy)()).toBe(proxy);
    expect(send).not.toHaveBeenCalled();
    expect(await proxy.getChapter(1, 1)).toBe('v');
    expect(send).toHaveBeenCalledWith({ op: 'call', repo: 'annotations', method: 'getChapter', args: [1, 1] });
    client.close();
  });

  it('times out the first open, closes that client and retries on the next call', async () => {
    let closed = 0;
    let attempts = 0;
    resetUserDbClientForTests({
      openTimeoutMs: 20,
      create: () => {
        attempts++;
        // never becomes leader: requests hang, as without navigator.locks
        const c = new UserDbClient({ locks: { request: () => new Promise(() => undefined) }, createChannel: channel, createBackend: () => backend(async () => null) });
        const close = c.close.bind(c);
        c.close = () => { closed++; close(); };
        return c;
      },
    });
    await expect(getUserDbClient()).rejects.toMatchObject({ code: 'open_timeout' });
    expect(closed).toBe(1);
    await expect(getUserDbClient()).rejects.toMatchObject({ code: 'open_timeout' });
    expect(attempts).toBe(2);
  });

  it('registerHostApi adds and removes a host API', () => {
    const impl = { listModules: async () => [] };
    const off = registerHostApi('memory.bible', impl);
    expect(hostApiLookupForTests('memory.bible')).toBe(impl);
    off();
    expect(hostApiLookupForTests('memory.bible')).toBeUndefined();
  });
});
