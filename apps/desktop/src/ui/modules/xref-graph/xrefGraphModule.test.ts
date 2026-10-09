/**
 * The Cross-ref graph module through the real desktop host: manifest, "on by default loads
 * nothing", the off switch (boot and runtime), activation by the verse action, the overlay slot.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { xrefGraphManifest } from './manifest';

const activate = vi.fn();

async function boot(override = '') {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  activate.mockClear();
  vi.doMock('./module', () => ({ activate }));
  const { xrefGraphModule } = await import('./binding');
  const loadSpy = vi.spyOn(xrefGraphModule.binding!, 'load');
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const apps = await import('../../apps/appHost');
  registerBuiltinModules();
  return { ...host, verseActions: apps.verseActions, loadSpy };
}

function fakeCommandRegistry() {
  const all = new Set<string>();
  const ids = () => [...all].filter((id) => id.startsWith('xrefGraph.'));
  return {
    ids,
    registry: {
      register: vi.fn((cmd: { id: string }) => {
        all.add(cmd.id);
        return { dispose: () => void all.delete(cmd.id) };
      }),
    } as never,
  };
}

const ctx = { verseId: 43003016, verseIds: [43003016], module: 'KJV', surface: 'reader' };

beforeEach(() => window.localStorage.clear());

describe('xref-graph manifest', () => {
  it('validates and keeps the old label key, icon and position', () => {
    expect(validateBuiltinManifest(xrefGraphManifest)).toEqual([]);
    expect(xrefGraphManifest.id).toBe('xref-graph');
    expect(xrefGraphManifest.flag).toBeUndefined();
    expect(xrefGraphManifest.platforms).toEqual(['desktop']);
    expect(xrefGraphManifest.contributes.verseActions).toEqual([
      {
        id: 'xrefGraph.connections',
        title: { key: 'xrefGraph.showConnections', fallback: 'Show connections' },
        icon: { kind: 'builtin', name: 'diagram-project' },
        order: 10,
        group: 'study',
      },
    ]);
    expect(xrefGraphManifest.contributes.i18nNamespace).toBe('xrefGraph');
  });
});

describe('xref-graph module in the desktop host', () => {
  it('is on by default: the verse action and namespace exist and no module code has loaded', async () => {
    const { verseActions, modulePoints, loadSpy, featureModules } = await boot('');
    expect(verseActions.get('xrefGraph.connections')).toMatchObject({ group: 'study' });
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'xrefGraph')).toBe(true);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(featureModules.isActive('xref-graph')).toBe(false);
  }, 180_000);

  it('off switch: no verse action, namespace or command; running the action fails; nothing loads', async () => {
    const { verseActions, modulePoints, loadSpy, featureModules, bindModuleCommands } = await boot('-xref-graph');
    const { registry, ids } = fakeCommandRegistry();
    bindModuleCommands(registry);
    expect(verseActions.get('xrefGraph.connections')).toBeUndefined();
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'xrefGraph')).toBe(false);
    expect(ids()).toEqual([]);
    expect(featureModules.list().find((m) => m.id === 'xref-graph')).toMatchObject({ enabled: false, offReason: 'override' });
    await expect(verseActions.run('xrefGraph.connections', ctx)).rejects.toThrow();
    expect(loadSpy).not.toHaveBeenCalled();
  }, 180_000);

  it('registers its command while on and removes everything when switched off at runtime', async () => {
    const { verseActions, modulePoints, reconcileModules, bindModuleCommands } = await boot('');
    const { registry, ids } = fakeCommandRegistry();
    bindModuleCommands(registry);
    expect(ids()).toEqual(['xrefGraph.open']);
    window.localStorage.setItem('kth.modules', '-xref-graph');
    reconcileModules();
    expect(ids()).toEqual([]);
    expect(verseActions.get('xrefGraph.connections')).toBeUndefined();
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'xrefGraph')).toBe(false);
    window.localStorage.setItem('kth.modules', '');
    reconcileModules();
    expect(ids()).toEqual(['xrefGraph.open']);
    expect(verseActions.get('xrefGraph.connections')).toBeDefined();
  }, 180_000);

  it('running the verse action fires onVerseAction, activates the module and opens the graph', async () => {
    const h = await boot('');
    vi.doUnmock('./module');
    await h.verseActions.run('xrefGraph.connections', ctx);
    expect(h.featureModules.isActive('xref-graph')).toBe(true);
    expect(h.loadSpy).toHaveBeenCalledTimes(1);
    const { useXrefGraphStore } = await import('./useXrefGraphStore');
    expect(useXrefGraphStore.getState()).toMatchObject({ isOpen: true, anchor: 43003016 });
  }, 180_000);
});

describe('the overlay slot', () => {
  it('fills when the real module activates and empties when it is switched off', async () => {
    const h = await boot('');
    vi.doUnmock('./module');
    const slots = await import('../host/slots');
    expect(slots.shellOverlays.list()).toHaveLength(0);
    await h.featureModules.fire('onVerseAction:xrefGraph.connections');
    expect(slots.shellOverlays.list()).toHaveLength(1);
    window.localStorage.setItem('kth.modules', '-xref-graph');
    h.reconcileModules();
    expect(slots.shellOverlays.list()).toHaveLength(0);
  }, 180_000);
});
