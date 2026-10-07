import { describe, it, expect, vi } from 'vitest';

const exposed: Record<string, any> = {};
const ipcRenderer = { invoke: vi.fn(async () => ({ ok: true, value: 1 })), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() };
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (k: string, v: unknown) => void (exposed[k] = v) },
  ipcRenderer,
  webUtils: { getPathForFile: vi.fn() },
}));

describe('preload modules surface', () => {
  it('maps channels and rejects bad names', async () => {
    await import('../preload');
    const m = exposed.electron.modules;
    await m.invoke('fixture', 'add', 1, 2);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('module:fixture:add', 1, 2);
    await expect(m.invoke('a:b', 'add')).rejects.toThrow(/Invalid/);
    await expect(m.invoke('fixture', 'x:y')).rejects.toThrow(/Invalid/);
    await expect(m.invoke('fixture', '')).rejects.toThrow(/Invalid/);
    const cb = vi.fn();
    const off = m.on('fixture', 'ready', cb);
    expect(ipcRenderer.on.mock.calls.at(-1)![0]).toBe('module:fixture:event:ready');
    const listener = ipcRenderer.on.mock.calls.at(-1)![1];
    listener({}, 7);
    expect(cb).toHaveBeenCalledWith(7);
    off();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('module:fixture:event:ready', listener);
    expect(() => m.on('../x', 'e', cb)).toThrow(/Invalid/);
  });
});
