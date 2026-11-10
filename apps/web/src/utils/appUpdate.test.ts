import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyUpdateIfStale,
  CLIENT_BUILD_ID,
  registerServiceWorker,
  resetAppCache,
  unregisterServiceWorkers,
} from './appUpdate';
import { updateStore } from '../stores/updateStore';
import * as bootGuard from './bootGuard';

type Listener = () => void;

function installFakeServiceWorker(hasController: boolean) {
  const listeners: Record<string, Listener[]> = {};
  const registration = {
    update: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(true),
    waiting: null as null | { postMessage: (msg: unknown) => void },
  };
  const sw = {
    controller: hasController ? {} : null,
    addEventListener: (type: string, fn: Listener) => { (listeners[type] ??= []).push(fn); },
    removeEventListener: (type: string, fn: Listener) => {
      listeners[type] = (listeners[type] ?? []).filter(l => l !== fn);
    },
    register: vi.fn().mockResolvedValue(registration),
    getRegistration: vi.fn().mockResolvedValue(registration),
    getRegistrations: vi.fn().mockResolvedValue([registration]),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  return { sw, registration, fire: (type: string) => listeners[type]?.forEach(fn => fn()) };
}

/** Stub `/api/version`: the server's build id, or a network failure. */
function serverBuild(buildId: string | Error) {
  const fetchMock = vi.fn(async () => {
    if (buildId instanceof Error) throw buildId;
    return new Response(JSON.stringify({ version: 'x', buildId }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Let the async controllerchange handler finish. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function installFakeCaches(names: string[]) {
  const store = new Set(names);
  Object.defineProperty(window, 'caches', {
    configurable: true,
    value: {
      keys: async () => [...store],
      delete: async (n: string) => store.delete(n),
    },
  });
  return store;
}

describe('appUpdate', () => {
  beforeEach(() => { updateStore.setAvailable(false); });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    // @ts-expect-error test cleanup
    delete navigator.serviceWorker;
  });

  describe('registerServiceWorker', () => {
    it('registers /sw.js', () => {
      const { sw } = installFakeServiceWorker(false);
      registerServiceWorker();
      expect(sw.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });

    it('ignores the controllerchange of the very first install', () => {
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      const { fire } = installFakeServiceWorker(false);
      registerServiceWorker({ updateMode: 'prompt' });
      fire('controllerchange');
      expect(updateStore.available).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    });

    it('silent mode reloads once when a new worker takes over a stale page', async () => {
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      const fetchMock = serverBuild('a-newer-build');
      const { fire } = installFakeServiceWorker(true);
      registerServiceWorker({ updateMode: 'silent' });
      fire('controllerchange');
      await settle();
      expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/version$/), { cache: 'no-store' });
      expect(reload).toHaveBeenCalledTimes(1);
      expect(updateStore.available).toBe(false);
    });

    it('does not reload a page that already runs the build the server serves', async () => {
      // The first load after a deploy: the page came from the network while the
      // new worker was still precaching, and the worker takes over afterwards.
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      serverBuild(CLIENT_BUILD_ID);
      const { fire } = installFakeServiceWorker(true);
      registerServiceWorker({ updateMode: 'silent' });
      fire('controllerchange');
      await settle();
      expect(reload).not.toHaveBeenCalled();
      expect(updateStore.available).toBe(false);
    });

    it('reloads when the server cannot be asked', async () => {
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      serverBuild(new TypeError('Failed to fetch'));
      const { fire } = installFakeServiceWorker(true);
      registerServiceWorker({ updateMode: 'silent' });
      fire('controllerchange');
      await settle();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('prompt mode shows the banner instead of reloading', async () => {
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      serverBuild('a-newer-build');
      const { fire } = installFakeServiceWorker(true);
      registerServiceWorker({ updateMode: 'prompt' });
      fire('controllerchange');
      await settle();
      expect(updateStore.available).toBe(true);
      expect(reload).not.toHaveBeenCalled();
    });

    it('prompt mode shows no banner when the page is current', async () => {
      serverBuild(CLIENT_BUILD_ID);
      const { fire } = installFakeServiceWorker(true);
      registerServiceWorker({ updateMode: 'prompt' });
      fire('controllerchange');
      await settle();
      expect(updateStore.available).toBe(false);
    });

    it('is a no-op where service workers do not exist', () => {
      expect(() => registerServiceWorker()).not.toThrow();
    });
  });

  describe('applyUpdateIfStale', () => {
    it('does nothing when the builds match or the server gave none', async () => {
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      const { registration } = installFakeServiceWorker(true);
      expect(await applyUpdateIfStale(CLIENT_BUILD_ID)).toBe(false);
      expect(await applyUpdateIfStale(undefined)).toBe(false);
      expect(registration.update).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });

    it('reloads once the new worker takes control', async () => {
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      const { fire } = installFakeServiceWorker(true);
      const done = applyUpdateIfStale('a-newer-build');
      await settle();
      fire('controllerchange');
      await done;
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not wait for an install that is still precaching', async () => {
      // update() queues behind a running install and settles only when the
      // whole precache has downloaded. The boot splash must not wait for that.
      vi.useFakeTimers();
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      const { registration } = installFakeServiceWorker(true);
      registration.update.mockReturnValue(new Promise(() => {}));
      const done = applyUpdateIfStale('a-newer-build');
      await vi.advanceTimersByTimeAsync(4000);
      await done;
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('still reloads when the update itself fails', async () => {
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { registration } = installFakeServiceWorker(true);
      registration.update.mockRejectedValue(new Error('network'));
      await applyUpdateIfStale('a-newer-build');
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });

  describe('unregisterServiceWorkers / resetAppCache', () => {
    it('unregisters every worker and deletes caches except the large ones', async () => {
      const { registration } = installFakeServiceWorker(true);
      const store = installFakeCaches([
        'workbox-precache-v2-https://x/', 'commentary-text-v1', 'old-legacy',
        'embedding-model-v1', 'semantic-index-v1', 'transformers-cache',
      ]);
      await unregisterServiceWorkers();
      expect(registration.unregister).toHaveBeenCalled();
      expect([...store].sort()).toEqual(['embedding-model-v1', 'semantic-index-v1', 'transformers-cache']);
    });

    it('a full reset also drops our large caches but never transformers-cache', async () => {
      installFakeServiceWorker(true);
      const store = installFakeCaches(['embedding-model-v1', 'semantic-index-v1', 'transformers-cache', 'x']);
      await unregisterServiceWorkers({ includeLarge: true });
      expect([...store]).toEqual(['transformers-cache']);
    });

    it('resetAppCache clears, then reloads', async () => {
      installFakeServiceWorker(true);
      installFakeCaches(['a']);
      const reload = vi.fn();
      vi.stubGlobal('location', { ...window.location, reload });
      await resetAppCache();
      expect(reload).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
  });
});
