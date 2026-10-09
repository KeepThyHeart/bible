/**
 * The Similar module through the REAL web host (task 0126): its contributions, the
 * dev-override off switch, lazy activation and the `when` keys that show the tab and
 * the verse-menu entry only while the neighbour table is offered. Each test boots a
 * fresh module graph, like builtinModules.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { similarManifest } from './manifest';

vi.mock('../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../i18n')>()),
  loadNamespace: async () => {},
}));

// Feature detection is the only thing that talks to the asset manager: replace it.
const detection = vi.hoisted(() => ({ available: false, probes: 0, listeners: new Set<() => void>() }));
vi.mock('./similarAvailability', () => ({
  similarAvailability: {
    get available() {
      return detection.available;
    },
    probe: async () => {
      detection.probes++;
    },
    subscribe: (fn: () => void) => {
      detection.listeners.add(fn);
      return () => detection.listeners.delete(fn);
    },
  },
}));

async function boot(override = '') {
  vi.resetModules();
  localStorage.setItem('kth.modules', override);
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const when = await import('../../host/verseActionWhen');
  const { verseActions } = await import('../../host/appHost');
  registerBuiltinModules();
  return { ...host, when, verseActions };
}

beforeEach(() => {
  localStorage.clear();
  detection.available = false;
  detection.probes = 0;
  detection.listeners.clear();
});

describe('manifest', () => {
  it('validates and keeps the persisted ids, titles and order', () => {
    expect(validateBuiltinManifest(similarManifest)).toEqual([]);
    expect(similarManifest.contributes.paneModes).toEqual([
      { id: 'similar', title: { key: 'rightPane.similar', fallback: 'Similar' }, order: 80, when: 'similar.available' },
    ]);
    expect(similarManifest.contributes.verseActions).toMatchObject([
      { id: 'similar.find', title: { key: 'contextMenu.similar' }, group: 'study', icon: { name: 'fa-clone' } },
    ]);
    expect(similarManifest.contributes.i18nNamespace).toBe('similar');
  });
});

describe('on by default', () => {
  it('contributes the tab, its view, the menu entry and the namespace, and loads no code at boot', async () => {
    const h = await boot();
    expect(h.modulePoints.paneModes.get('similar')).toMatchObject({ id: 'similar', order: 80 });
    expect(h.modulePoints.views.resolve('pane:similar')).toBeDefined();
    expect(h.modulePoints.paneModes.list().map((p) => p.id)).toContain('similar');
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).toContain('similar');
    expect(h.verseActions.has('similar.find')).toBe(true);
    expect(h.featureModules.isActive('similar')).toBe(false);
    expect(detection.probes).toBe(0);
  });

  it('the boot probe asks for activation, which starts the detection and defines the keys', async () => {
    const h = await boot();
    expect(h.when.evalVerseWhen('similar.available')).toBe(false);
    const intents = h.runBootProbes();
    expect(intents.activate).toContain('similar');
    await h.featureModules.activateNow('similar', 'onBootProbe');
    expect(detection.probes).toBe(1);
    // Detection says no: the tab and the entry stay hidden.
    expect(h.when.evalVerseWhen('similar.available')).toBe(false);
    expect(h.when.evalVerseWhen('similar.menu')).toBe(false);
    // The table is offered: both appear, and readers are told.
    const seen = vi.fn();
    h.when.whenKeys.subscribe(seen);
    detection.available = true;
    for (const fn of detection.listeners) fn();
    expect(seen).toHaveBeenCalled();
    expect(h.when.evalVerseWhen('similar.available')).toBe(true);
    expect(h.when.evalVerseWhen('similar.menu')).toBe(true);
  });

  it('the menu entry is hidden on the phone layout', async () => {
    detection.available = true;
    const h = await boot();
    await h.featureModules.activateNow('similar', 'onBootProbe');
    expect(h.when.evalVerseWhen('similar.menu')).toBe(true);
    const spy = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(500);
    expect(h.when.evalVerseWhen('similar.menu')).toBe(false);
    expect(h.when.evalVerseWhen('similar.available')).toBe(true);
    spy.mockRestore();
  });

  it('running the verse action activates the module, selects the verse and opens the pane', async () => {
    const h = await boot();
    const { bibleStore } = await import('../../stores/bibleStore');
    const { eventBus } = await import('../../events/eventBus');
    const adopt = vi.spyOn(bibleStore, 'adoptPreviewAsStudy').mockImplementation(() => {});
    const emit = vi.spyOn(eventBus, 'emit');
    await h.verseActions.run('similar.find', { verseId: 43003016, verseIds: [43003016], module: 'KJV', surface: 'reader' });
    expect(h.featureModules.isActive('similar')).toBe(true);
    expect(adopt).toHaveBeenCalledWith(43003016);
    expect(emit).toHaveBeenCalledWith('pane:show', { paneId: 'similar' });
    expect(emit).toHaveBeenCalledWith('pane:expand');
  });
});

describe('the dev override switches it off', () => {
  it('-similar removes every contribution and the module does not activate', async () => {
    const h = await boot('-similar');
    expect(h.modulePoints.paneModes.get('similar')).toBeUndefined();
    expect(h.modulePoints.views.resolve('pane:similar')).toBeUndefined();
    expect(h.verseActions.has('similar.find')).toBe(false);
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).not.toContain('"similar"');
    expect(h.runBootProbes().activate).not.toContain('similar');
    await expect(h.verseActions.run('similar.find', { verseId: 1001001, verseIds: [1001001], module: 'KJV', surface: 'reader' })).rejects.toThrow();
  });

  it('switching it off at runtime removes the keys and contributions; the other panes stay', async () => {
    detection.available = true;
    const h = await boot();
    await h.featureModules.activateNow('similar', 'onBootProbe');
    expect(h.when.evalVerseWhen('similar.available')).toBe(true);
    localStorage.setItem('kth.modules', '-similar');
    h.reconcileModules();
    await Promise.resolve();
    expect(h.modulePoints.paneModes.get('similar')).toBeUndefined();
    expect(h.verseActions.has('similar.find')).toBe(false);
    expect(h.when.evalVerseWhen('similar.available')).toBe(false);
    expect(h.modulePoints.paneModes.get('study')).toBeDefined();
  });
});
