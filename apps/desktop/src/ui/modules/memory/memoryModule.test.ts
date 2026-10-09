import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const enabled = vi.hoisted(() => ({ value: true }));
const addAppBinding = vi.hoisted(() => vi.fn<(...args: any[]) => any>());
const bindHandler = vi.hoisted(() => vi.fn<(...args: any[]) => any>());
const setBadge = vi.hoisted(() => vi.fn());
const activeApp = vi.hoisted(() => ({ id: 'study' }));
const addToast = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({
  on: vi.fn(),
  getStatus: vi.fn(),
  addVerses: vi.fn(),
}));

vi.mock('../moduleHost', () => ({ featureModules: { isEnabled: () => enabled.value } }));
vi.mock('../../apps/appHost', () => ({ addAppBinding, appRegistry: { setBadge }, verseActions: { bindHandler }, isAppActive: (id: string) => activeApp.id === id }));
vi.mock('../../services/I18nService', () => ({
  i18nService: { t: (k: string, p?: { count?: number }) => `${k}:${p?.count ?? ''}` },
}));
vi.mock('../../stores/useToastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock('./memoryClient', () => ({ memoryClient: client }));

import { installMemoryHost, INITIAL_STATUS_DELAY_MS, STATUS_REFRESH_MS, memoryModule, requestMemoryCards, onMemoryCardsRequest, takePendingMemoryCards } from './memoryModule';

let push: (p: unknown) => void;
let dispose: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  enabled.value = true;
  for (const m of [addAppBinding, bindHandler, setBadge, addToast, client.on, client.getStatus, client.addVerses]) m.mockReset();
  addAppBinding.mockReturnValue({ dispose: vi.fn() });
  bindHandler.mockReturnValue({ dispose: vi.fn() });
  client.on.mockImplementation((_e: string, cb: (p: unknown) => void) => {
    push = cb;
    return vi.fn();
  });
  client.getStatus.mockResolvedValue({ due: 0, waiting: 0 });
});
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});

describe('installMemoryHost', () => {
  it('pairs the manifest with a binding', () => {
    expect(memoryModule[0].id).toBe('memory');
    expect(memoryModule[1]).toEqual({ id: 'memory' });
  });

  it('registers nothing when the module is disabled', () => {
    enabled.value = false;
    dispose = installMemoryHost();
    expect(addAppBinding).not.toHaveBeenCalled();
    expect(bindHandler).not.toHaveBeenCalled();
    expect(client.on).not.toHaveBeenCalled();
  });

  it('registers the app binding and the verse handler when enabled', () => {
    dispose = installMemoryHost();
    expect(addAppBinding).toHaveBeenCalledWith(expect.objectContaining({ id: 'memory' }));
    expect(bindHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'memory.memorize' }));
  });

  it('the verse handler adds the selected verses', async () => {
    dispose = installMemoryHost();
    const binding = bindHandler.mock.calls[0]![0] as { load(): Promise<{ run(ctx: unknown): Promise<void> }> };
    client.addVerses.mockResolvedValue({ outcome: 'added', passageId: 1 });
    const handler = await binding.load();
    await handler.run({ verseIds: [43003016, 43003017], module: 'KJV' });
    expect(client.addVerses).toHaveBeenCalledWith({ verseIds: [43003016, 43003017], module: 'KJV' });
  });

  it('status pushes set and clear the badge', () => {
    dispose = installMemoryHost();
    push({ type: 'status', status: { due: 3, waiting: 2 } });
    expect(setBadge).toHaveBeenLastCalledWith('memory', {
      kind: 'count',
      value: 3,
      tone: 'attention',
      label: 'memory.badge.due:3, memory.badge.waiting:2',
    });
    push({ type: 'status', status: { due: 0, waiting: 0 } });
    expect(setBadge).toHaveBeenLastCalledWith('memory', undefined);
  });

  it('notice pushes show a toast, except while the Memory app is on screen (it shows them itself)', () => {
    dispose = installMemoryHost();
    push({ type: 'notice', message: 'Added John 3:16' });
    expect(addToast).toHaveBeenCalledWith('Added John 3:16', 'info');
    activeApp.id = 'memory';
    push({ type: 'notice', message: 'again' });
    expect(addToast).toHaveBeenCalledTimes(1);
    activeApp.id = 'study';
  });

  it('re-reads the badge periodically and on window focus', async () => {
    dispose = installMemoryHost();
    await vi.advanceTimersByTimeAsync(INITIAL_STATUS_DELAY_MS);
    expect(client.getStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(STATUS_REFRESH_MS);
    expect(client.getStatus).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('focus'));
    expect(client.getStatus).toHaveBeenCalledTimes(3);
    dispose();
    window.dispatchEvent(new Event('focus'));
    expect(client.getStatus).toHaveBeenCalledTimes(3);
  });

  it('shows waiting push cards on the badge when nothing is due', () => {
    dispose = installMemoryHost();
    push({ type: 'status', status: { due: 0, waiting: 2 } });
    expect(setBadge).toHaveBeenLastCalledWith('memory', expect.objectContaining({ value: 2, label: 'memory.badge.waiting:2' }));
  });

  it('defers the initial status fetch', async () => {
    client.getStatus.mockResolvedValue({ due: 4, waiting: 0 });
    dispose = installMemoryHost();
    expect(client.getStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INITIAL_STATUS_DELAY_MS);
    expect(client.getStatus).toHaveBeenCalledTimes(1);
    expect(setBadge).toHaveBeenCalledWith('memory', expect.objectContaining({ value: 4 }));
  });

  it('tolerates a failed initial status fetch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    client.getStatus.mockRejectedValue(new Error('no main'));
    dispose = installMemoryHost();
    await vi.advanceTimersByTimeAsync(INITIAL_STATUS_DELAY_MS);
    expect(setBadge).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('cards requests', () => {
  it('calls the mounted view, or is held until one mounts', () => {
    requestMemoryCards();
    expect(takePendingMemoryCards()).toBe(true);
    expect(takePendingMemoryCards()).toBe(false);
    const listener = vi.fn();
    const off = onMemoryCardsRequest(listener);
    requestMemoryCards();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takePendingMemoryCards()).toBe(false);
    off();
  });
});

describe('laziness', () => {
  it('memoryModule.ts imports neither the view nor the UI package statically', () => {
    const src = readFileSync(join(__dirname, 'memoryModule.ts'), 'utf8');
    expect(src).not.toMatch(/^import .*['"]\.\/MemoryAppView['"]/m);
    expect(src).not.toMatch(/^import .*@bible\/memory\/ui/m);
    expect(src).toMatch(/import\('\.\/MemoryAppView'\)/);
  });
});
