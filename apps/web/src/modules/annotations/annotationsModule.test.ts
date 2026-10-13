/**
 * The Annotations module: manifest, the flag-off switch through the REAL web host (no module code, no userdb import
 * evaluated), and `activate()` (slots, the `userDb.available` key, disposal).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { annotationsManifest, annotationsVerseActions } from './manifest';

vi.setConfig({ testTimeout: 60_000 });

const probe = vi.hoisted(() => ({ supported: true, loaded: vi.fn() }));
const subscribeChanged = vi.hoisted(() => vi.fn());
const offChanged = vi.hoisted(() => vi.fn());

vi.mock('../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../i18n')>()),
  loadNamespace: async () => {},
}));
vi.mock('../../userdb/client', () => {
  probe.loaded('userdb/client');
  return { isUserDbSupported: () => probe.supported, getUserDbClient: async () => ({}) };
});

beforeEach(() => {
  probe.supported = true;
  probe.loaded.mockClear();
  subscribeChanged.mockReset().mockReturnValue(offChanged);
  offChanged.mockClear();
  localStorage.clear();
});

describe('manifest', () => {
  it('validates, is web-only, behind localUserDb, and keeps the persisted ids and keys', () => {
    expect(validateBuiltinManifest(annotationsManifest)).toEqual([]);
    expect(annotationsManifest.flag).toBe('localUserDb');
    expect(annotationsManifest.platforms).toEqual(['web']);
    expect(annotationsManifest.contributes.i18nNamespace).toBe('annotations');
    expect(annotationsVerseActions.map((a) => [a.id, a.when, (a.title as { key: string }).key])).toEqual([
      ['annotations.highlight', 'userDb.available', 'verseActions.highlight'],
      ['annotations.note', 'userDb.available', 'verseActions.note'],
      ['annotations.bookmark', 'userDb.available', 'verseActions.bookmark'],
    ]);
  });
});

async function boot(flagOn: boolean) {
  vi.resetModules();
  localStorage.setItem('kth.modules', '');
  const { setClientConfig } = await import('../../utils/clientConfig');
  setClientConfig({ features: { localUserDb: flagOn } } as never);
  const host = await import('../moduleHost');
  const { annotationsModule } = await import('./binding');
  host.addWebModule(annotationsModule);
  host.reconcileModules();
  return host;
}

describe('flag off', () => {
  it('contributes nothing, never probes and evaluates no userdb code', async () => {
    const h = await boot(false);
    expect(h.runBootProbes().activate).toEqual([]);
    expect(h.featureModules.isActive('annotations')).toBe(false);
    expect(h.modulePoints.i18nNamespace.list().map((n) => JSON.stringify(n)).join()).not.toContain('annotations');
    expect(probe.loaded).not.toHaveBeenCalled();
  });
});

describe('flag on', () => {
  it('registers lazily: the boot probe asks for activation but loads no code by itself', async () => {
    const h = await boot(true);
    expect(h.featureModules.isActive('annotations')).toBe(false);
    expect(h.runBootProbes().activate).toEqual(['annotations']);
    expect(probe.loaded).not.toHaveBeenCalled();
  });
});

describe('activate()', () => {
  async function load() {
    vi.resetModules();
    vi.doMock('./annotationApi', () => ({ isUserDbSupported: () => probe.supported, subscribeChanged, getAnnotationsApi: async () => ({}) }));
    const slots = await import('../../host/slots');
    const when = await import('../../host/verseActionWhen');
    const { activate } = await import('./module');
    const { annotationUi } = await import('./annotationUi');
    const subscriptions: { dispose(): void }[] = [];
    activate({ subscriptions } as never);
    return { slots, when, subscriptions, annotationUi };
  }

  it('defines userDb.available and fills the slots, then disposes everything', async () => {
    const m = await load();
    expect(m.when.evalVerseWhen('userDb.available')).toBe(true);
    expect(m.slots.readerPaintControllers.list()).toHaveLength(1);
    expect(m.slots.verseDecorators.list()).toHaveLength(1);
    expect(m.slots.shellOverlays.list()).toHaveLength(1);
    expect(subscribeChanged).toHaveBeenCalledTimes(1);
    expect(document.getElementById('kth-annot-tints')?.textContent).toContain('.kth-annot-hl--green{--kth-annot-tint:#B7E4C7}');

    m.annotationUi.showToast('x');
    for (const d of m.subscriptions) d.dispose();
    expect(m.when.evalVerseWhen('userDb.available')).toBe(false);
    expect(m.slots.readerPaintControllers.list()).toEqual([]);
    expect(m.slots.verseDecorators.list()).toEqual([]);
    expect(m.slots.shellOverlays.list()).toEqual([]);
    expect(offChanged).toHaveBeenCalled();
    expect(document.getElementById('kth-annot-tints')).toBeNull();
    expect(m.annotationUi.toast).toBeNull();
  });

  it('registers only a false key when the browser cannot open the user database', async () => {
    probe.supported = false;
    const m = await load();
    expect(m.when.evalVerseWhen('userDb.available')).toBe(false);
    expect(m.slots.shellOverlays.list()).toEqual([]);
    expect(m.slots.verseDecorators.list()).toEqual([]);
    expect(subscribeChanged).not.toHaveBeenCalled();
  });
});
