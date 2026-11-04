import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { INDEX_PROGRESS_CHANNEL, invokeBuildIndex } from '../indexProgress';
import type { IndexProgress, ProgressIpcRenderer } from '../indexProgress';

/** Fake ipcRenderer that structured-clones invoke arguments exactly as Electron does. */
function fakeIpc(handler: (args: unknown[], push: (p: IndexProgress) => void) => Promise<unknown>) {
  const bus = new EventEmitter();
  const ipc: ProgressIpcRenderer = {
    invoke: async (_channel, ...args) => {
      const cloned = structuredClone(args); // throws DataCloneError on a function
      return handler(cloned, (p) => bus.emit(INDEX_PROGRESS_CHANNEL, {}, p));
    },
    on: (c, l) => bus.on(c, l),
    removeListener: (c, l) => bus.removeListener(c, l),
  };
  return { ipc, bus };
}

describe('invokeBuildIndex (re-index IPC path)', () => {
  it('ignores progress that belongs to another module build', async () => {
    const { ipc } = fakeIpc(async (_a, push) => {
      push({ module: 'ESV', current: 1, total: 66, bookName: 'Genesis' });
      push({ module: 'KJV', current: 1, total: 66, bookName: 'Genesis' });
    });
    const seen: IndexProgress[] = [];
    await invokeBuildIndex(ipc, ['KJV'], (p) => seen.push(p));
    expect(seen.map((p) => p.module)).toEqual(['KJV']);
  });

  it('does not put the callback in the invoke arguments (functions are not cloneable)', async () => {
    const { ipc } = fakeIpc(async (args) => args);
    const seen: IndexProgress[] = [];
    await expect(invokeBuildIndex(ipc, ['KJV'], (p) => seen.push(p))).resolves.toEqual([['KJV']]);
  });

  it('reproduces the original bug: passing the callback through invoke fails to clone', async () => {
    const { ipc } = fakeIpc(async () => undefined);
    await expect(ipc.invoke('search:buildIndex', ['KJV'], () => {})).rejects.toThrow();
  });

  it('relays pushed progress to the callback and unsubscribes afterwards', async () => {
    const { ipc, bus } = fakeIpc(async (_a, push) => {
      push({ module: 'KJV', current: 1, total: 66, bookName: 'Genesis' });
      push({ module: 'KJV', current: 2, total: 66, bookName: 'Exodus' });
    });
    const seen: IndexProgress[] = [];
    await invokeBuildIndex(ipc, ['KJV'], (p) => seen.push(p));
    expect(seen.map((p) => p.bookName)).toEqual(['Genesis', 'Exodus']);
    expect(bus.listenerCount(INDEX_PROGRESS_CHANNEL)).toBe(0);
  });

  it('unsubscribes and rethrows when the invoke fails', async () => {
    const { ipc, bus } = fakeIpc(async () => { throw new Error('boom'); });
    await expect(invokeBuildIndex(ipc, ['KJV'], () => {})).rejects.toThrow('boom');
    expect(bus.listenerCount(INDEX_PROGRESS_CHANNEL)).toBe(0);
  });
});
