import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker, resetAppCache, unregisterServiceWorkers } from './appUpdate';
import { updateStore } from '../stores/updateStore';
import * as bootGuard from './bootGuard';

type Listener = () => void;

function installFakeServiceWorker(hasController: boolean) {
  const listeners: Record<string, Listener[]> = {};
  const registration = { update: vi.fn().mockResolvedValue(undefined), unregister: vi.fn().mockResolvedValue(true) };
  const sw = {
    controller: hasController ? {} : null,
    addEventListener: (type: string, fn: Listener) => { (listeners[type] ??= []).push(fn); },
    register: vi.fn().mockResolvedValue(registration),
    getRegistrations: vi.fn().mockResolvedValue([registration]),
  };
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  return { sw, registration, fire: (type: string) => listeners[type]?.forEach(fn => fn()) };
}

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

    it('silent mode reloads once when a new worker takes over an open page', () => {
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      const { fire } = installFakeServiceWorker(true);
      registerServiceWorker({ updateMode: 'silent' });
      fire('controllerchange');
      expect(reload).toHaveBeenCalledTimes(1);
      expect(updateStore.available).toBe(false);
    });

    it('prompt mode shows the banner instead of reloading', () => {
      const reload = vi.spyOn(bootGuard, 'reloadForUpdateOnce').mockReturnValue(true);
      const { fire } = installFakeServiceWorker(true);
      registerServiceWorker({ updateMode: 'prompt' });
      fire('controllerchange');
      expect(updateStore.available).toBe(true);
      expect(reload).not.toHaveBeenCalled();
    });

    it('is a no-op where service workers do not exist', () => {
      expect(() => registerServiceWorker()).not.toThrow();
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
