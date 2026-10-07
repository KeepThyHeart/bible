import { describe, it, expect, vi } from 'vitest';
import { createModuleClient, type ModulesBridge } from './moduleClient';
import { IpcResultError } from './ipcResult';

interface FixtureApi { add(a: number, b: number): Promise<number>; fail(): Promise<void> }
interface FixtureEvents { ready: [n: number] }

describe('createModuleClient', () => {
  it('maps calls, unwraps results, and rejects failures', async () => {
    const invoke = vi.fn(async (_ns: string, method: string, ...args: unknown[]) =>
      method === 'add'
        ? { ok: true, value: (args[0] as number) + (args[1] as number) }
        : { ok: false, error: { code: 'not_found', message: 'nope' } },
    );
    const off = vi.fn();
    const on = vi.fn(() => off);
    const bridge = { invoke, on } as unknown as ModulesBridge;
    const c = createModuleClient<FixtureApi, FixtureEvents>('fixture', () => bridge);
    expect(await c.add(1, 2)).toBe(3);
    expect(invoke).toHaveBeenCalledWith('fixture', 'add', 1, 2);
    await expect(c.fail()).rejects.toBeInstanceOf(IpcResultError);
    const cb = vi.fn();
    expect(c.on('ready', cb)).toBe(off);
    expect(on).toHaveBeenCalledWith('fixture', 'ready', cb);
  });
});
