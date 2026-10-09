/**
 * The Cross-ref graph module through the REAL web host: manifest, the off switch, lazy
 * activation by the "Show connections" verse action, and the overlay slot.
 * Each test boots a fresh module graph, as builtinModules.test.ts does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { xrefGraphManifest } from '../manifest';

const spies = vi.hoisted(() => ({
  moduleLoaded: vi.fn(),
  moduleActivate: vi.fn(),
  adopt: vi.fn(),
}));

vi.mock('../module', () => {
  spies.moduleLoaded();
  return { activate: spies.moduleActivate, hooks: {} };
});
vi.mock('../../../stores/bibleStore', () => ({ bibleStore: { adoptPreviewAsStudy: spies.adopt } }));
vi.mock('../../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../i18n')>()),
  loadNamespace: async () => {},
}));
vi.mock('../../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

async function boot(opts: { override?: string; disabled?: string[] } = {}) {
  vi.resetModules();
  localStorage.setItem('kth.modules', opts.override ?? '');
  const { setClientConfig } = await import('../../../utils/clientConfig');
  setClientConfig({ ...(opts.disabled ? { modules: { disabled: opts.disabled } } : {}) } as never);
  const { registerBuiltinModules } = await import('../../builtinModules');
  const host = await import('../../moduleHost');
  const apps = await import('../../../host/appHost');
  registerBuiltinModules();
  return { ...host, ...apps };
}

function xref(h: Awaited<ReturnType<typeof boot>>) {
  return {
    action: h.verseActions.get('xrefGraph.connections'),
    ns: JSON.stringify(h.modulePoints.i18nNamespace.list()).includes('xrefGraph'),
  };
}

const ctx = { verseId: 43003016, verseIds: [43003016], module: 'KJV', surface: 'reader' };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('the Cross-ref graph manifest', () => {
  it('validates and keeps the old label key, icon and position', () => {
    expect(validateBuiltinManifest(xrefGraphManifest)).toEqual([]);
    expect(xrefGraphManifest.id).toBe('xref-graph');
    expect(xrefGraphManifest.contributes.verseActions).toEqual([
      {
        id: 'xrefGraph.connections',
        title: { key: 'xrefGraph.showConnections', fallback: 'Show connections' },
        icon: { kind: 'builtin', name: 'fa-diagram-project' },
        order: 10,
        group: 'study',
      },
    ]);
    expect(xrefGraphManifest.contributes.i18nNamespace).toBe('xrefGraph');
    expect(xrefGraphManifest.contributes.serverRoutes).toEqual([{ id: 'xref-graph-api', path: '/api/xref-graph' }]);
  });
});

describe('the Cross-ref graph module: on', () => {
  it('contributes the verse action and namespace by default and loads no code', async () => {
    const h = await boot();
    expect(xref(h).action).toMatchObject({ id: 'xrefGraph.connections', group: 'study' });
    expect(xref(h).ns).toBe(true);
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    expect(h.featureModules.isActive('xref-graph')).toBe(false);
  }, 60_000);

  it('running the verse action fires onVerseAction, activates the module, selects the verse and opens the graph', async () => {
    const h = await boot();
    await h.verseActions.run('xrefGraph.connections', ctx);
    expect(h.featureModules.isActive('xref-graph')).toBe(true);
    expect((spies.moduleActivate.mock.calls[0] as unknown[])[0]).toMatchObject({ activationEvent: 'onVerseAction:xrefGraph.connections' });
    expect(spies.adopt).toHaveBeenCalledWith(ctx.verseId);
    const { xrefGraphStore } = await import('../xrefGraphStore');
    expect(xrefGraphStore.isOpen).toBe(true);
    expect(xrefGraphStore.anchor).toBe(ctx.verseId);
  }, 60_000);
});

describe.each([
  ['the dev override', { override: '-xref-graph' }],
  ['the server config', { disabled: ['xref-graph'] }],
])('the Cross-ref graph module: off via %s', (_name, opts) => {
  it('has no verse action or namespace; nothing activates; the rest stays', async () => {
    const h = await boot(opts);
    expect(xref(h)).toEqual({ action: undefined, ns: false });
    await expect(h.verseActions.run('xrefGraph.connections', ctx)).rejects.toThrow();
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    expect(h.featureModules.isActive('xref-graph')).toBe(false);
    expect(h.appRegistry.get('present')).toBeDefined();
  }, 60_000);
});

describe('the Cross-ref graph module: switched off at runtime', () => {
  it('override + reconcileModules() removes the verse action, and back on restores it', async () => {
    const h = await boot();
    expect(xref(h).action).toBeDefined();
    localStorage.setItem('kth.modules', '-xref-graph');
    h.reconcileModules();
    expect(xref(h)).toEqual({ action: undefined, ns: false });
    localStorage.setItem('kth.modules', '');
    h.reconcileModules();
    expect(xref(h).action).toBeDefined();
  }, 60_000);
});

describe('the overlay slot', () => {
  it('fills when the real module activates and empties when it is switched off', async () => {
    vi.doUnmock('../module');
    const h = await boot();
    const slots = await import('../../../host/slots');
    expect(slots.shellOverlays.list()).toHaveLength(0);
    h.setShellContext({ providers: { bible: {} } } as never);
    await h.featureModules.fire('onVerseAction:xrefGraph.connections');
    expect(slots.shellOverlays.list()).toHaveLength(1);
    localStorage.setItem('kth.modules', '-xref-graph');
    h.reconcileModules();
    expect(slots.shellOverlays.list()).toHaveLength(0);
  }, 60_000);
});
