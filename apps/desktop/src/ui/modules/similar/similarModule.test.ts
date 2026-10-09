/**
 * The Similar feature module through the real desktop host (task 0126): manifest, "on by default
 * loads nothing", the off switch (boot and runtime), activation, the verse action, the
 * availability key and the follow-the-verse listener.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { similarManifest } from './manifest';

const status = vi.hoisted(() => vi.fn());
vi.mock('./similarAPI', () => ({ similarAPI: { status, find: vi.fn(), explain: vi.fn(), reset: vi.fn() } }));

async function boot(override = '') {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  const { similarModule } = await import('./binding');
  const loadSpy = vi.spyOn(similarModule.binding!, 'load');
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const apps = await import('../../apps/appHost');
  const listeners = await import('../host/hostListeners');
  const store = await import('./useSimilarStore');
  const { whenContextService } = await import('../../services/WhenContextService');
  registerBuiltinModules();
  return { ...host, verseActions: apps.verseActions, loadSpy, listeners, store, whenContextService };
}

function fakeCommandRegistry() {
  const all = new Set<string>();
  const similarIds = () => [...all].filter((id) => id.startsWith('similar.'));
  return {
    ids: similarIds,
    registry: {
      register: vi.fn((cmd: { id: string }) => {
        all.add(cmd.id);
        return { dispose: () => void all.delete(cmd.id) };
      }),
    } as never,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

// Warm the transform cache once: the first import of the host graph is slow on a cold or busy machine.
beforeAll(async () => {
  await import('../builtinModules');
}, 300_000);

beforeEach(() => {
  window.localStorage.clear();
  status.mockReset().mockResolvedValue({ table: 'ready', live: false });
});

describe('similar manifest', () => {
  it('validates and keeps the persisted ids, orders and label keys', () => {
    expect(validateBuiltinManifest(similarManifest)).toEqual([]);
    expect(similarManifest.id).toBe('similar');
    expect(similarManifest.flag).toBeUndefined();
    expect(similarManifest.platforms).toEqual(['desktop']);
    const c = similarManifest.contributes;
    expect(c.panelTypes).toEqual([{ id: 'similar', title: { key: 'paneName.similar', fallback: 'Similar' }, order: 64 }]);
    expect(c.verseActions).toMatchObject([
      { id: 'similar.find', title: { key: 'ui.verseContextMenu.findSimilar' }, group: 'study', when: 'similarAvailable' },
    ]);
    expect(c.i18nNamespace).toBe('similar');
    expect(similarManifest.activationEvents).toEqual(['onStartupFinished']);
  });
});

describe('similar module in the desktop host', () => {
  it('is on by default: contributions exist and no module code has loaded at boot', async () => {
    const { modulePoints, verseActions, loadSpy, featureModules } = await boot('');
    expect(modulePoints.panelTypes.has('similar')).toBe(true);
    expect(modulePoints.views.resolve('panel:similar')).toBeTypeOf('function');
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'similar')).toBe(true);
    expect(verseActions.has('similar.find')).toBe(true);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(featureModules.isActive('similar')).toBe(false);
  }, 120_000);

  it('activates after startup, detects availability and sets the when-context key', async () => {
    const { featureModules, whenContextService } = await boot('');
    await tick();
    expect(featureModules.isActive('similar')).toBe(true);
    await vi.waitFor(() => expect(whenContextService.get('similarAvailable')).toBe(true));
    expect(status).toHaveBeenCalled();
  }, 120_000);

  it('off switch: no panel type, view, verse action, command or namespace; it never activates', async () => {
    const { modulePoints, verseActions, loadSpy, featureModules, bindModuleCommands, whenContextService } = await boot('-similar');
    const { registry, ids } = fakeCommandRegistry();
    bindModuleCommands(registry);
    await tick();
    expect(modulePoints.panelTypes.has('similar')).toBe(false);
    expect(modulePoints.views.resolve('panel:similar')).toBeUndefined();
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'similar')).toBe(false);
    expect(verseActions.has('similar.find')).toBe(false);
    expect(ids()).toEqual([]);
    expect(featureModules.list().find((m) => m.id === 'similar')).toMatchObject({ enabled: false, offReason: 'override' });
    expect(modulePoints.panelTypes.has('bible')).toBe(true);
    await featureModules.fire('onPanel:similar');
    expect(loadSpy).not.toHaveBeenCalled();
    expect(whenContextService.get('similarAvailable')).toBeUndefined();
  }, 120_000);

  it('registers its command while on and removes everything when switched off at runtime', async () => {
    const { modulePoints, verseActions, reconcileModules, bindModuleCommands, listeners, store } = await boot('');
    const { registry, ids } = fakeCommandRegistry();
    bindModuleCommands(registry);
    expect(ids()).toEqual(['similar.open']);
    await tick();
    const follow = vi.spyOn(store.useSimilarStore.getState(), 'followVerse');
    listeners.verseFollowers.emit(43003016);
    expect(follow).toHaveBeenCalledWith(43003016);
    window.localStorage.setItem('kth.modules', '-similar');
    reconcileModules();
    expect(ids()).toEqual([]);
    expect(modulePoints.panelTypes.has('similar')).toBe(false);
    expect(verseActions.has('similar.find')).toBe(false);
    follow.mockClear();
    listeners.verseFollowers.emit(43003017);
    expect(follow).not.toHaveBeenCalled();
    window.localStorage.setItem('kth.modules', '');
    reconcileModules();
    expect(ids()).toEqual(['similar.open']);
    expect(modulePoints.panelTypes.has('similar')).toBe(true);
  }, 120_000);

  it('refreshes availability when the library changes or the verse menu opens', async () => {
    const { listeners } = await boot('');
    await tick();
    status.mockClear();
    listeners.libraryChangeListeners.emit();
    listeners.verseMenuOpenListeners.emit();
    expect(status).toHaveBeenCalledTimes(2);
  }, 120_000);

  it('the verse action opens the Similar panel on the selected passage, activating the module', async () => {
    const { verseActions, featureModules, store } = await boot('');
    const openFor = vi.spyOn(store.useSimilarStore.getState(), 'openFor').mockImplementation(() => {});
    await verseActions.run('similar.find', { verseId: 43003018, verseIds: [43003016, 43003018], module: 'KJV', surface: 'reader' });
    expect(openFor).toHaveBeenCalledWith({ startVerseId: 43003016, endVerseId: 43003018 });
    expect(featureModules.isActive('similar')).toBe(true);
  }, 120_000);

  it('activates on onPanel:similar', async () => {
    const a = await boot('');
    await a.featureModules.fire('onPanel:similar');
    expect(a.featureModules.isActive('similar')).toBe(true);
    expect(a.loadSpy).toHaveBeenCalledTimes(1);
  }, 120_000);
});
