import { describe, it, expect, vi } from 'vitest';
import { MEMORY_API_METHODS } from '@bible/memory/api';
import type { MemoryPush } from '@bible/memory/api';
import type { UserDbEvent } from '../../../userdb/protocol';
import type { UserDbClient } from '../../../userdb/client';
import { createWebMemoryApi } from '../webMemoryApi';

function fakeClient() {
  const listeners = new Set<(e: UserDbEvent) => void>();
  const call = vi.fn(async (_repo: string, method: string, ..._args: unknown[]) => `ok:${method}`);
  const client = { call, onEvent: (cb: (e: UserDbEvent) => void) => (listeners.add(cb), () => listeners.delete(cb)) } as unknown as UserDbClient;
  return { client, call, emit: (e: UserDbEvent) => listeners.forEach((l) => l(e)), listeners };
}

describe('webMemoryApi', () => {
  it('maps every MemoryApi method to a memory repo call, omitting the argument when there is none', async () => {
    const f = fakeClient();
    const { api } = createWebMemoryApi(async () => f.client);
    for (const m of MEMORY_API_METHODS) {
      expect(await (api as unknown as Record<string, (a?: unknown) => Promise<unknown>>)[m]!()).toBe(`ok:${m}`);
    }
    expect(f.call).toHaveBeenCalledTimes(MEMORY_API_METHODS.length);
    expect(f.call.mock.calls.every((c) => c[0] === 'memory' && c.length === 2)).toBe(true);
    await api.addPassage({ reference: 'John 3:16' });
    expect(f.call).toHaveBeenLastCalledWith('memory', 'addPassage', { reference: 'John 3:16' });
  });

  it('subscribe forwards memoryPush events only, and unsubscribes', async () => {
    const f = fakeClient();
    const { subscribe } = createWebMemoryApi(async () => f.client);
    const seen: MemoryPush[] = [];
    const off = subscribe((p) => seen.push(p));
    await vi.waitFor(() => expect(f.listeners.size).toBe(1));
    f.emit({ event: 'changed', tables: ['memory_passage'] } as UserDbEvent);
    f.emit({ event: 'memoryPush', push: { type: 'notice', message: 'hi' } });
    expect(seen).toEqual([{ type: 'notice', message: 'hi' }]);
    off();
    expect(f.listeners.size).toBe(0);
  });

  it('unsubscribing before the client is ready never attaches', async () => {
    const f = fakeClient();
    const { subscribe } = createWebMemoryApi(async () => f.client);
    subscribe(() => undefined)();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.listeners.size).toBe(0);
  });
});
