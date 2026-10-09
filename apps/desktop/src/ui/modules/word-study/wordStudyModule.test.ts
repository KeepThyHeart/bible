/**
 * The Word study feature module through the real desktop host (task 0126): manifest,
 * "on by default loads nothing", the off switch (boot and runtime), activation, and the
 * seams host code uses (panel requests, the verse context menu slot, panel disposal).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { wordStudyManifest } from './manifest';

const activate = vi.fn();

async function boot(override = '', realModule = false) {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  activate.mockClear();
  if (realModule) {
    vi.doUnmock('./module');
  } else {
    vi.doMock('./module', () => ({ activate }));
  }
  const { wordStudyModule } = await import('./binding');
  const loadSpy = vi.spyOn(wordStudyModule.binding!, 'load');
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  registerBuiltinModules();
  return { ...host, loadSpy };
}

function fakeCommandRegistry() {
  const all = new Set<string>();
  const ids = () => [...all].filter((id) => id.startsWith('wordStudy.'));
  return {
    live: { get size() { return ids().length; }, [Symbol.iterator]: () => ids()[Symbol.iterator]() },
    registry: {
      register: vi.fn((cmd: { id: string }) => {
        all.add(cmd.id);
        return { dispose: () => void all.delete(cmd.id) };
      }),
    } as never,
  };
}

beforeEach(() => window.localStorage.clear());

describe('word study manifest', () => {
  it('validates and keeps the persisted ids, orders and label keys', () => {
    expect(validateBuiltinManifest(wordStudyManifest)).toEqual([]);
    expect(wordStudyManifest.id).toBe('word-study');
    expect(wordStudyManifest.flag).toBeUndefined();
    expect(wordStudyManifest.platforms).toEqual(['desktop']);
    const c = wordStudyManifest.contributes;
    expect(c.panelTypes).toEqual([{ id: 'wordStudy', title: { key: 'paneName.wordStudy', fallback: 'Word Study' }, order: 53 }]);
    expect(c.newTabTiles).toBeUndefined();
    expect(c.i18nNamespace).toBe('wordStudy');
    expect(wordStudyManifest.hooks).toBeUndefined();
  });
});

describe('word study module in the desktop host', () => {
  it('is on by default: contributions exist and no module code has loaded', async () => {
    const { modulePoints, loadSpy, featureModules } = await boot('');
    expect(modulePoints.panelTypes.has('wordStudy')).toBe(true);
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'wordStudy')).toBe(true);
    expect(modulePoints.views.resolve('panel:wordStudy')).toBeTypeOf('function');
    expect(loadSpy).not.toHaveBeenCalled();
    expect(featureModules.isActive('word-study')).toBe(false);
  }, 60_000);

  it('off switch: no panel type, view or command; other modules are unaffected', async () => {
    const { modulePoints, loadSpy, featureModules, bindModuleCommands } = await boot('-word-study');
    const { registry, live } = fakeCommandRegistry();
    bindModuleCommands(registry);
    expect(modulePoints.panelTypes.has('wordStudy')).toBe(false);
    expect(modulePoints.views.resolve('panel:wordStudy')).toBeUndefined();
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'wordStudy')).toBe(false);
    expect([...live]).toEqual([]);
    expect(featureModules.list().find((m) => m.id === 'word-study')).toMatchObject({ enabled: false, offReason: 'override' });
    expect(modulePoints.panelTypes.has('bible')).toBe(true);
    await featureModules.fire('onPanel:wordStudy');
    await featureModules.fire('onView:verseContextMenu');
    expect(loadSpy).not.toHaveBeenCalled();
  }, 60_000);

  it('registers its command while on and removes it when switched off at runtime', async () => {
    const { modulePoints, reconcileModules, bindModuleCommands } = await boot('');
    const { registry, live } = fakeCommandRegistry();
    bindModuleCommands(registry);
    expect([...live]).toEqual(['wordStudy.open']);
    window.localStorage.setItem('kth.modules', '-word-study');
    reconcileModules();
    expect([...live]).toEqual([]);
    expect(modulePoints.panelTypes.has('wordStudy')).toBe(false);
    window.localStorage.setItem('kth.modules', '');
    reconcileModules();
    expect([...live]).toEqual(['wordStudy.open']);
    expect(modulePoints.panelTypes.has('wordStudy')).toBe(true);
  }, 60_000);

  it('activates on onPanel:wordStudy and on onView:verseContextMenu, loading its code once', async () => {
    const a = await boot('');
    await a.featureModules.fire('onPanel:wordStudy');
    expect(a.featureModules.isActive('word-study')).toBe(true);
    expect(a.loadSpy).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
    const b = await boot('');
    await b.featureModules.fire('onView:verseContextMenu');
    expect(b.featureModules.isActive('word-study')).toBe(true);
  }, 60_000);
});

describe('the seams host code uses', () => {
  const reveal = vi.fn();
  const destroyPanel = vi.fn();

  async function bootReal(override = '') {
    vi.doMock('./revealWordStudyPanel', () => ({ revealWordStudyPanel: reveal }));
    vi.doMock('./useWordStudyStore', () => ({ useWordStudyStore: { getState: () => ({ destroyPanel }) } }));
    vi.doMock('./StudyWordMenuItem', () => ({ StudyWordMenuItem: () => null }));
    const h = await boot(override, true);
    const slots = await import('../host/slots');
    const requests = await import('../host/panelRequests');
    const disposal = await import('../../stores/helpers/panelDisposal');
    return { ...h, slots, requests, disposal };
  }

  beforeEach(() => {
    reveal.mockClear();
    destroyPanel.mockClear();
  });

  it('a request waits for the module, activates it, and is delivered once', async () => {
    const h = await bootReal();
    h.requests.requestPanel('wordStudy', { kind: 'strongs', strongs: 'G25' });
    await vi.waitFor(() => expect(reveal).toHaveBeenCalledWith({ kind: 'strongs', strongs: 'G25' }));
    expect(h.featureModules.isActive('word-study')).toBe(true);
    h.requests.requestPanel('wordStudy', { kind: 'strongs', strongs: 'G26' });
    expect(reveal).toHaveBeenLastCalledWith({ kind: 'strongs', strongs: 'G26' });
    expect(reveal).toHaveBeenCalledTimes(2);
  }, 60_000);

  it('a request does nothing while the module is off', async () => {
    const h = await bootReal('-word-study');
    h.requests.requestPanel('wordStudy', { kind: 'strongs', strongs: 'G25' });
    await Promise.resolve();
    expect(reveal).not.toHaveBeenCalled();
    expect(h.featureModules.isActive('word-study')).toBe(false);
  }, 60_000);

  it('the verse menu slot fills on onView:verseContextMenu and empties when the module is switched off', async () => {
    const h = await bootReal();
    expect(h.slots.verseMenuItems.list()).toHaveLength(0);
    await h.featureModules.fire('onView:verseContextMenu');
    expect(h.slots.verseMenuItems.list()).toHaveLength(1);
    window.localStorage.setItem('kth.modules', '-word-study');
    h.reconcileModules();
    expect(h.slots.verseMenuItems.list()).toHaveLength(0);
  }, 60_000);

  it('closing a word study panel discards its state through the module', async () => {
    const h = await bootReal();
    await h.featureModules.fire('onPanel:wordStudy');
    h.disposal.destroyPanelState('wordStudy_1', 'wordStudy');
    expect(destroyPanel).toHaveBeenCalledWith('wordStudy_1');
  }, 60_000);
});
