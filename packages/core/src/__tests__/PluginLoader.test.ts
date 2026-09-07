import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginLoader } from '../Plugin/PluginLoader';
import type { PluginManifest, PluginModule } from '../Plugin/PluginTypes';

// Simple test context
interface TestContext {
  pluginId: string;
}

function makeManifest(overrides: Partial<PluginManifest> & { id: string }): PluginManifest {
  return {
    displayName: overrides.id,
    description: 'Test plugin',
    version: '1.0.0',
    activationTarget: 'server',
    ...overrides,
  };
}

function makeModule(overrides?: Partial<PluginModule<TestContext>>): PluginModule<TestContext> {
  return {
    activate: overrides?.activate ?? vi.fn(),
    deactivate: overrides?.deactivate,
  };
}

describe('PluginLoader', () => {
  let loader: PluginLoader<TestContext>;
  const contextFactory = (m: PluginManifest): TestContext => ({ pluginId: m.id });

  beforeEach(() => {
    loader = new PluginLoader<TestContext>();
    // Suppress console output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ==========================================================================
  // Registration
  // ==========================================================================

  describe('register', () => {
    it('should register a plugin manifest', () => {
      const manifest = makeManifest({ id: 'test-plugin' });
      loader.register(manifest);

      expect(loader.getState('test-plugin')).toBe('discovered');
      expect(loader.getManifest('test-plugin')).toEqual(manifest);
    });

    it('should skip duplicate registrations', () => {
      const manifest = makeManifest({ id: 'test-plugin' });
      loader.register(manifest);
      loader.register(makeManifest({ id: 'test-plugin', version: '2.0.0' }));

      // Original manifest kept
      expect(loader.getManifest('test-plugin')!.version).toBe('1.0.0');
    });

    it('should return undefined for unregistered plugin', () => {
      expect(loader.getState('nonexistent')).toBeUndefined();
      expect(loader.getManifest('nonexistent')).toBeUndefined();
    });
  });

  // ==========================================================================
  // Activation
  // ==========================================================================

  describe('activateAll', () => {
    it('should activate a single plugin', async () => {
      const activate = vi.fn();
      const mod = makeModule({ activate });
      loader.register(makeManifest({ id: 'alpha' }));

      await loader.activateAll(contextFactory, async () => mod);

      expect(activate).toHaveBeenCalledWith({ pluginId: 'alpha' });
      expect(loader.getState('alpha')).toBe('active');
    });

    it('should activate multiple independent plugins', async () => {
      const modules: Record<string, PluginModule<TestContext>> = {
        alpha: makeModule(),
        beta: makeModule(),
      };
      loader.register(makeManifest({ id: 'alpha' }));
      loader.register(makeManifest({ id: 'beta' }));

      await loader.activateAll(contextFactory, async (m) => modules[m.id]);

      expect(loader.getState('alpha')).toBe('active');
      expect(loader.getState('beta')).toBe('active');
    });

    it('should activate dependencies before dependents', async () => {
      const order: string[] = [];
      const makeTrackedModule = (id: string) => makeModule({
        activate: vi.fn(() => { order.push(id); }),
      });

      const modules: Record<string, PluginModule<TestContext>> = {
        dep: makeTrackedModule('dep'),
        main: makeTrackedModule('main'),
      };

      loader.register(makeManifest({ id: 'main', dependencies: ['dep'] }));
      loader.register(makeManifest({ id: 'dep' }));

      await loader.activateAll(contextFactory, async (m) => modules[m.id]);

      expect(order).toEqual(['dep', 'main']);
      expect(loader.getState('dep')).toBe('active');
      expect(loader.getState('main')).toBe('active');
    });

    it('should set error state when dependency is not active', async () => {
      const failingMod = makeModule({
        activate: vi.fn(() => { throw new Error('fail'); }),
      });
      const dependentMod = makeModule();

      const modules: Record<string, PluginModule<TestContext>> = {
        dep: failingMod,
        main: dependentMod,
      };

      loader.register(makeManifest({ id: 'dep' }));
      loader.register(makeManifest({ id: 'main', dependencies: ['dep'] }));

      await loader.activateAll(contextFactory, async (m) => modules[m.id]);

      expect(loader.getState('dep')).toBe('error');
      expect(loader.getState('main')).toBe('error');
    });

    it('should set error state when activate throws', async () => {
      const mod = makeModule({ activate: vi.fn(() => { throw new Error('boom'); }) });
      loader.register(makeManifest({ id: 'bad' }));

      await loader.activateAll(contextFactory, async () => mod);

      expect(loader.getState('bad')).toBe('error');
      const all = loader.getAll();
      expect(all[0].error).toBe('boom');
    });

    it('should throw on circular dependencies', async () => {
      loader.register(makeManifest({ id: 'a', dependencies: ['b'] }));
      loader.register(makeManifest({ id: 'b', dependencies: ['a'] }));

      await expect(
        loader.activateAll(contextFactory, async () => makeModule())
      ).rejects.toThrow(/Circular dependency/);
    });

    it('should warn and skip unknown dependencies', async () => {
      const mod = makeModule();
      loader.register(makeManifest({ id: 'orphan', dependencies: ['missing'] }));

      await loader.activateAll(contextFactory, async () => mod);

      // Plugin should error because dependency is not active
      expect(loader.getState('orphan')).toBe('error');
    });
  });

  // ==========================================================================
  // Deactivation
  // ==========================================================================

  describe('deactivateAll', () => {
    it('should deactivate plugins in reverse activation order', async () => {
      const order: string[] = [];
      const makeTrackedModule = (id: string) => makeModule({
        activate: vi.fn(),
        deactivate: vi.fn(() => { order.push(id); }),
      });

      const modules: Record<string, PluginModule<TestContext>> = {
        dep: makeTrackedModule('dep'),
        main: makeTrackedModule('main'),
      };

      loader.register(makeManifest({ id: 'main', dependencies: ['dep'] }));
      loader.register(makeManifest({ id: 'dep' }));

      await loader.activateAll(contextFactory, async (m) => modules[m.id]);
      await loader.deactivateAll();

      // main deactivated before dep (reverse of activation)
      expect(order).toEqual(['main', 'dep']);
      expect(loader.getState('dep')).toBe('inactive');
      expect(loader.getState('main')).toBe('inactive');
    });

    it('should handle plugins without deactivate method', async () => {
      const mod = makeModule(); // no deactivate
      loader.register(makeManifest({ id: 'simple' }));

      await loader.activateAll(contextFactory, async () => mod);
      await loader.deactivateAll();

      expect(loader.getState('simple')).toBe('inactive');
    });

    it('should set error state if deactivate throws', async () => {
      const mod = makeModule({
        activate: vi.fn(),
        deactivate: vi.fn(() => { throw new Error('cleanup fail'); }),
      });
      loader.register(makeManifest({ id: 'messy' }));

      await loader.activateAll(contextFactory, async () => mod);
      await loader.deactivateAll();

      expect(loader.getState('messy')).toBe('error');
      const all = loader.getAll();
      expect(all[0].error).toBe('cleanup fail');
    });
  });

  describe('deactivateOne', () => {
    it('should deactivate a single active plugin', async () => {
      const deactivate = vi.fn();
      const mod = makeModule({ activate: vi.fn(), deactivate });
      loader.register(makeManifest({ id: 'target' }));

      await loader.activateAll(contextFactory, async () => mod);
      await loader.deactivateOne('target');

      expect(deactivate).toHaveBeenCalled();
      expect(loader.getState('target')).toBe('inactive');
    });

    it('should do nothing for non-active or unknown plugins', async () => {
      loader.register(makeManifest({ id: 'discovered-only' }));

      // Should not throw
      await loader.deactivateOne('discovered-only');
      await loader.deactivateOne('nonexistent');

      expect(loader.getState('discovered-only')).toBe('discovered');
    });
  });

  // ==========================================================================
  // Query
  // ==========================================================================

  describe('getAll / getActive', () => {
    it('should return all registered plugins with state', () => {
      loader.register(makeManifest({ id: 'a' }));
      loader.register(makeManifest({ id: 'b' }));

      const all = loader.getAll();
      expect(all).toHaveLength(2);
      expect(all[0]).toHaveProperty('manifest');
      expect(all[0]).toHaveProperty('state');
    });

    it('should return only active plugins from getActive', async () => {
      const goodMod = makeModule();
      const badMod = makeModule({ activate: vi.fn(() => { throw new Error('fail'); }) });

      const modules: Record<string, PluginModule<TestContext>> = {
        good: goodMod,
        bad: badMod,
      };

      loader.register(makeManifest({ id: 'good' }));
      loader.register(makeManifest({ id: 'bad' }));

      await loader.activateAll(contextFactory, async (m) => modules[m.id]);

      const active = loader.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('good');
    });

    it('should return empty arrays when nothing registered', () => {
      expect(loader.getAll()).toHaveLength(0);
      expect(loader.getActive()).toHaveLength(0);
    });
  });
});
