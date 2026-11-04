import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const listening = vi.hoisted(() => ({ value: false }));
const openApp = vi.hoisted(() => vi.fn<(...args: any[]) => any>());
const bindAppLinkHandler = vi.hoisted(() => vi.fn<(...args: any[]) => any>());
const addAppBinding = vi.hoisted(() => vi.fn<(...args: any[]) => any>());
const bindHandler = vi.hoisted(() => vi.fn<(...args: any[]) => any>());
const setBadge = vi.hoisted(() => vi.fn());
const activeApp = vi.hoisted(() => ({ id: 'study' }));
const addToast = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({
  on: vi.fn(),
  getStatus: vi.fn(),
  addVerses: vi.fn(),
  takeNotices: vi.fn(),
}));
const visibility = vi.hoisted(() => ({ value: 'visible' }));

vi.mock('../moduleHost', () => ({ featureModules: { isActive: () => listening.value } }));
vi.mock('../../apps/appHost', () => ({ addAppBinding, openApp, bindAppLinkHandler, appRegistry: { setBadge }, verseActions: { bindHandler }, isAppActive: (id: string) => activeApp.id === id }));
vi.mock('../../services/I18nService', () => ({
  i18nService: { t: (k: string, p?: { count?: number }) => `${k}:${p?.count ?? ''}` },
}));
vi.mock('../../stores/useToastStore', () => ({ useToastStore: { getState: () => ({ addToast }) } }));
vi.mock('./memoryClient', () => ({ memoryClient: client }));

import { memoryModule, requestMemoryCards, onMemoryCardsRequest, takePendingMemoryCards } from './memoryModule';
import { activate, collectNotices, startMemoryClickRouting, INITIAL_STATUS_DELAY_MS, STATUS_REFRESH_MS } from './module';

const subscriptions: Array<{ dispose(): void }> = [];
const installMemoryHost = (): (() => void) => {
  activate({ moduleId: 'memory', platform: 'desktop', activationEvent: 'onStartupFinished', subscriptions });
  return () => {
    for (const d of subscriptions.splice(0)) d.dispose();
  };
};

let push: (p: unknown) => void;
let dispose: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  listening.value = false;
  visibility.value = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility.value });
  for (const m of [addAppBinding, bindHandler, setBadge, addToast, client.on, client.getStatus, client.addVerses, client.takeNotices]) m.mockReset();
  client.takeNotices.mockResolvedValue([]);
  addAppBinding.mockReturnValue({ dispose: vi.fn() });
  bindAppLinkHandler.mockReset();
  bindAppLinkHandler.mockReturnValue({ dispose: vi.fn() });
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
  it('is a desktop module whose pieces register with it (so it can be switched at runtime)', () => {
    expect(memoryModule.manifest.id).toBe('memory');
    expect(memoryModule.manifest.activationEvents).toEqual(['onStartupFinished']);
    expect(memoryModule.manifest.contributes.i18nNamespace).toBe('memory');
    expect(memoryModule.apps?.map((x) => x.id)).toEqual(['memory']);
    expect(memoryModule.verseActionHandlers?.map((x) => x.id)).toEqual(['memorize'.replace('memorize', 'memory.memorize')]);
  });

  it('the verse handler adds the selected verses', async () => {
    const binding = memoryModule.verseActionHandlers![0]!;
    client.addVerses.mockResolvedValue({ outcome: 'added', passageId: 1 });
    const handler = await binding.load();
    await handler.run({ verseId: 43003016, verseIds: [43003016, 43003017], module: 'KJV', surface: 'reader' });
    expect(client.addVerses).toHaveBeenCalledWith({ verseIds: [43003016, 43003017], module: 'KJV' });
  });

  it('disposing the activation clears the badge and every subscription', async () => {
    dispose = installMemoryHost();
    push({ type: 'status', status: { due: 1, waiting: 0 } });
    const unsub = client.on.mock.results[0]!.value as ReturnType<typeof vi.fn>;
    dispose();
    expect(unsub).toHaveBeenCalled();
    expect(setBadge).toHaveBeenLastCalledWith('memory', undefined);
    expect(bindAppLinkHandler.mock.results[0]!.value.dispose).toHaveBeenCalled();
  });

  it('shows queued notices as toasts, only while a window is visible, and each is taken once', async () => {
    client.takeNotices.mockResolvedValue([{ id: 'retired', message: 'English' }]);
    visibility.value = 'hidden';
    await collectNotices(client);
    expect(client.takeNotices).not.toHaveBeenCalled();
    visibility.value = 'visible';
    await collectNotices(client);
    expect(addToast).toHaveBeenCalledWith('memory.notice.retired:', 'info');
  });

  it('a status push (the retirement queued a notice) collects notices', async () => {
    client.takeNotices.mockResolvedValue([{ id: 'skipped', message: 'English' }]);
    dispose = installMemoryHost();
    push({ type: 'status', status: { due: 0, waiting: 0 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(addToast).toHaveBeenCalledWith('memory.notice.skipped:', 'info');
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
    expect(src).not.toMatch(/^import .*['"]\.\/(MemoryAppView|module)['"]/m);
    expect(src).not.toMatch(/^import .*@bible\/memory\/ui/m);
    expect(src).toMatch(/import\('\.\/MemoryAppView'\)/);
  });
});

describe('click routing (works with the Notifications module off)', () => {
  const setup = (notificationsOn: boolean) => {
    let emit: (t: unknown) => void = () => undefined;
    const off = vi.fn();
    const c = {
      on: vi.fn((_e: string, cb: (t: unknown) => void) => {
        emit = cb;
        return off;
      }),
    };
    openApp.mockReset();
    openApp.mockResolvedValue({ status: 'activated' });
    const handle = startMemoryClickRouting(c as never, () => notificationsOn);
    return { c, emit: (t: unknown) => emit(t), handle, off };
  };

  it('opens Memory and its cards on an app:memory/cards click, with Notifications off', async () => {
    const { emit } = setup(false);
    const listener = vi.fn();
    const unregister = onMemoryCardsRequest(listener);
    emit({ kind: 'route', route: 'app:memory/cards' });
    await Promise.resolve();
    await Promise.resolve();
    expect(openApp).toHaveBeenCalledWith('memory');
    expect(listener).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('ignores other targets and other apps', async () => {
    const { emit } = setup(false);
    emit({ kind: 'verse', verseId: 1 });
    emit({ kind: 'route', route: 'app:quiz/cards' });
    await Promise.resolve();
    expect(openApp).not.toHaveBeenCalled();
  });

  it('does not open the cards when the app failed to open', async () => {
    const { emit } = setup(false);
    openApp.mockResolvedValue({ status: 'failed' });
    const listener = vi.fn();
    const unregister = onMemoryCardsRequest(listener);
    emit({ kind: 'route', route: 'app:memory/cards' });
    await Promise.resolve();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    unregister();
  });

  it('with Notifications on, the live event is left to its routing and the app link handler opens the cards once', async () => {
    const { emit } = setup(true);
    emit({ kind: 'route', route: 'app:memory/cards' });
    await Promise.resolve();
    expect(openApp).not.toHaveBeenCalled();
    const handler = bindAppLinkHandler.mock.calls.at(-1)![1] as (route: string) => void;
    const listener = vi.fn();
    const unregister = onMemoryCardsRequest(listener);
    handler('cards');
    await Promise.resolve();
    await Promise.resolve();
    expect(openApp).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('asks whether Notifications is listening when the click arrives, not at activation', async () => {
    const { emit } = setup(false);
    listening.value = true; // Notifications activated later
    const c2 = setup(false);
    emit({ kind: 'route', route: 'app:memory' });
    await Promise.resolve();
    expect(c2.handle).toBeDefined();
  });
});
