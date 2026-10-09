/**
 * The Word study module through the REAL web host: manifest, the off switch,
 * lazy activation (the pane tab / phone view) and the pane request seam
 * (`openPane`). Each test boots a fresh module graph, as builtinModules.test.ts does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { wordStudyManifest } from '../manifest';

const spies = vi.hoisted(() => ({
  moduleLoaded: vi.fn(),
  moduleActivate: vi.fn(),
}));

vi.mock('../module', () => {
  spies.moduleLoaded();
  return { activate: spies.moduleActivate, hooks: {} };
});
vi.mock('../WordStudyPaneView', () => ({ default: () => null }));
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
  registerBuiltinModules();
  return host;
}

function wordStudy(h: Awaited<ReturnType<typeof boot>>) {
  return {
    pane: h.modulePoints.paneModes.get('wordStudy'),
    view: h.modulePoints.views.resolve('pane:wordStudy'),
    ns: JSON.stringify(h.modulePoints.i18nNamespace.list()).includes('wordStudy'),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('the Word study manifest', () => {
  it('validates and keeps the old ids, orders and keys', () => {
    expect(validateBuiltinManifest(wordStudyManifest)).toEqual([]);
    expect(wordStudyManifest.id).toBe('word-study');
    expect(wordStudyManifest.flag).toBeUndefined();
    expect(wordStudyManifest.contributes.paneModes).toEqual([
      {
        id: 'wordStudy',
        title: { key: 'rightPane.wordStudy', fallback: 'Word study' },
        icon: { kind: 'builtin', name: 'fa-language' },
        order: 70,
        phoneView: true,
        headerButton: { title: { key: 'wordStudy.open', fallback: 'Word study' }, testId: 'header-word-study-btn' },
      },
    ]);
    expect(wordStudyManifest.contributes.i18nNamespace).toBe('wordStudy');
    expect(wordStudyManifest.contributes.serverRoutes).toEqual([{ id: 'word-study-api', path: '/api/word-study' }]);
    expect(wordStudyManifest.hooks).toBeUndefined();
  });
});

describe('the Word study module: on', () => {
  it('is on by default: contributes the pane and namespace, loads no code, keeps the old tab order', async () => {
    const h = await boot();
    const w = wordStudy(h);
    expect(w.pane).toMatchObject({ id: 'wordStudy', phoneView: true });
    expect(w.view).toBeDefined();
    expect(w.ns).toBe(true);
    expect(h.modulePoints.paneModes.list().map((p) => p.id)).toEqual(expect.arrayContaining(['study', 'commentary', 'dictionary', 'wordStudy']));
    expect(h.modulePoints.paneModes.list().filter((p) => p.phoneView).map((p) => p.id)).toEqual(['study', 'commentary', 'wordStudy']);
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    expect(h.featureModules.isActive('word-study')).toBe(false);
  }, 60_000);

  it('opening the pane (onPanel:wordStudy) activates the module', async () => {
    const h = await boot();
    await h.featureModules.fire('onPanel:wordStudy');
    expect(h.featureModules.isActive('word-study')).toBe(true);
    expect((spies.moduleActivate.mock.calls[0] as unknown[])[0]).toMatchObject({ activationEvent: 'onPanel:wordStudy' });
  }, 60_000);
});

describe.each([
  ['the dev override', { override: '-word-study' }],
  ['the server config', { disabled: ['word-study'] }],
])('the Word study module: off via %s', (_name, opts) => {
  it('has no pane, view or namespace; nothing activates; the rest stays', async () => {
    const h = await boot(opts);
    expect(wordStudy(h)).toEqual({ pane: undefined, view: undefined, ns: false });
    await h.featureModules.fire('onPanel:wordStudy');
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    expect(h.featureModules.isActive('word-study')).toBe(false);
    expect(h.modulePoints.paneModes.list().map((p) => p.id)).toContain('study');
  }, 60_000);
});

describe('the Word study module: switched off at runtime', () => {
  it('override + reconcileModules() removes everything, and back on restores it', async () => {
    const h = await boot();
    expect(wordStudy(h).pane).toBeDefined();
    localStorage.setItem('kth.modules', '-word-study');
    h.reconcileModules();
    expect(wordStudy(h)).toEqual({ pane: undefined, view: undefined, ns: false });
    localStorage.setItem('kth.modules', '');
    h.reconcileModules();
    expect(wordStudy(h).pane).toBeDefined();
  }, 60_000);
});

describe('the pane request seam (openPane)', () => {
  it('queues a request until the real module activates, then starts the study; off removes the handler', async () => {
    vi.doUnmock('../module');
    const openStrongs = vi.fn();
    vi.doMock('../wordStudyStore', () => ({ wordStudyStore: { openStrongs, openGroup: vi.fn() } }));
    const h = await boot();
    const { openPane } = await import('../../../host/paneRequests');
    openPane('wordStudy', { strongs: 'G25' });
    expect(openStrongs).not.toHaveBeenCalled();
    await h.featureModules.fire('onPanel:wordStudy');
    expect(openStrongs).toHaveBeenCalledWith('G25');
    openPane('wordStudy', { strongs: 'G26' });
    expect(openStrongs).toHaveBeenLastCalledWith('G26');
    localStorage.setItem('kth.modules', '-word-study');
    h.reconcileModules();
    openPane('wordStudy', { strongs: 'G27' });
    expect(openStrongs).toHaveBeenCalledTimes(2);
    vi.doUnmock('../wordStudyStore');
  }, 60_000);
});
