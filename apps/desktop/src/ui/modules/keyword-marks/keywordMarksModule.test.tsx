/**
 * The Keyword marks feature module through the real desktop host (task 0127): manifest, "on by
 * default loads nothing", the off switch (boot and runtime: toolbar, word items, Strong's action,
 * paint controller, command, settings, published layers), activation on the reader view, and a saved
 * session / the Advanced tab's child section that name what the module owns.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { validateBuiltinManifest } from '@bible/core/browser';
import { keywordMarksManifest } from './manifest';

vi.mock('./keywordSetsAPI', () => ({
  keywordSetsAPI: { list: vi.fn().mockResolvedValue([]), put: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/electronAPI', () => ({
  bibleAPI: { getInterlinearWordsForChapter: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: 'en', language: 'en' }),
}));
vi.mock('./KeywordsButton', () => ({ default: ({ tabId }: { tabId: string }) => <button data-testid="kw-button">{tabId}</button> }));

async function boot(override = '') {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  const { keywordMarksModule } = await import('./binding');
  const loadSpy = vi.spyOn(keywordMarksModule.binding!, 'load');
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const slots = await import('../host/slots');
  const layers = await import('../../extensions/chapterLayers');
  registerBuiltinModules();
  // Both reader modules activate on the same view event, so each test looks at its own module's items.
  const mine = (items: readonly unknown[]) => items.filter((i) => /Keyword/.test((i as { name?: string }).name ?? ''));
  return { ...host, slots, layers, loadSpy, mine };
}

const ACTIVATION = { timeout: 30_000 };

function fakeCommandRegistry() {
  const live = new Set<string>();
  return {
    live,
    registry: {
      register: vi.fn((cmd: { id: string }) => {
        live.add(cmd.id);
        return { dispose: () => void live.delete(cmd.id) };
      }),
    } as never,
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('keyword-marks manifest', () => {
  it('validates and keeps the persisted setting key and session key', () => {
    expect(validateBuiltinManifest(keywordMarksManifest)).toEqual([]);
    expect(keywordMarksManifest.id).toBe('keyword-marks');
    expect(keywordMarksManifest.platforms).toEqual(['desktop']);
    expect(keywordMarksManifest.activationEvents).toEqual(['onView:bible']);
    const c = keywordMarksManifest.contributes;
    expect(c.settings?.[0].defs.map((d) => d.key)).toEqual(['keywordColorSafe']);
    expect(c.settings?.[0].defs[0]).toMatchObject({ type: 'boolean', default: true, scope: 'device', group: 'advanced' });
    expect(c.preferencesSections?.map((s) => ({ id: s.id, parent: s.parent }))).toEqual([{ id: 'keyword-marks', parent: 'advanced' }]);
    expect(c.i18nNamespace).toBe('keywords');
  });
});

describe('keyword-marks module in the desktop host', () => {
  it('is on by default: contributions and the command exist, no module code has loaded', async () => {
    const { modulePoints, loadSpy, featureModules, slots, bindModuleCommands } = await boot('');
    const { registry, live } = fakeCommandRegistry();
    bindModuleCommands(registry);
    expect(live.has('bible.toggleKeywordMarks')).toBe(true);
    expect(modulePoints.settings.list().some((g) => g.defs.some((d) => d.key === 'keywordColorSafe'))).toBe(true);
    expect(modulePoints.preferencesSections.list().find((s) => s.id === 'keyword-marks')).toMatchObject({ parent: 'advanced' });
    expect(modulePoints.views.resolve('preferences:keyword-marks')).toBeTypeOf('function');
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'keywords')).toBe(true);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(featureModules.isActive('keyword-marks')).toBe(false);
    for (const slot of [slots.readerPaintControllers, slots.readerToolbarItems, slots.wordMenuItems, slots.strongsTooltipActions]) {
      expect(slot.list()).toHaveLength(0);
    }
  }, 60_000);

  it('activates when the reader toolbar mounts and puts its items into the slots', async () => {
    const { loadSpy, featureModules, slots, mine } = await boot('');
    render(<slots.ReaderToolbarItems tabId="t9" />);
    await waitFor(() => expect(featureModules.isActive('keyword-marks')).toBe(true), ACTIVATION);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('kw-button')).toHaveTextContent('t9');
    expect(mine(slots.readerPaintControllers.list())).toHaveLength(1);
    expect(slots.wordMenuItems.list()).toHaveLength(1);
    expect(slots.strongsTooltipActions.list()).toHaveLength(1);
  }, 60_000);

  it('off switch: no setting, section, view, namespace, command or slot item; the outlets render nothing and no code loads', async () => {
    const { modulePoints, loadSpy, featureModules, slots, bindModuleCommands, mine } = await boot('-keyword-marks');
    const { registry, live } = fakeCommandRegistry();
    bindModuleCommands(registry);
    const { container } = render(<slots.ReaderToolbarItems tabId="t1" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(live.has('bible.toggleKeywordMarks')).toBe(false);
    expect(modulePoints.settings.list().some((g) => g.defs.some((d) => d.key === 'keywordColorSafe'))).toBe(false);
    expect(modulePoints.preferencesSections.list().some((s) => s.id === 'keyword-marks')).toBe(false);
    expect(modulePoints.views.resolve('preferences:keyword-marks')).toBeUndefined();
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'keywords')).toBe(false);
    for (const slot of [slots.readerPaintControllers, slots.readerToolbarItems, slots.wordMenuItems, slots.strongsTooltipActions]) {
      expect(mine(slot.list())).toEqual([]);
    }
    expect(featureModules.list().find((m) => m.id === 'keyword-marks')).toMatchObject({ enabled: false, offReason: 'override' });
    expect(loadSpy).not.toHaveBeenCalled();
    // Other modules are unaffected; the host's Advanced tab is still there.
    expect(featureModules.list().find((m) => m.id === 'measures')).toMatchObject({ enabled: true });
    expect(modulePoints.preferencesSections.list().some((s) => s.id === 'advanced')).toBe(true);
  }, 60_000);

  it('switched off at runtime: slots, command and published layers go away; switching on restores the command', async () => {
    const { reconcileModules, featureModules, slots, layers, bindModuleCommands, mine } = await boot('');
    const { registry, live } = fakeCommandRegistry();
    bindModuleCommands(registry);
    await featureModules.fire('onView:bible');
    expect(slots.readerToolbarItems.list()).toHaveLength(1);
    const { useKeywordMarkStore } = await import('./useKeywordMarkStore');
    useKeywordMarkStore.setState({
      chapters: { t1: { input: { moduleId: 5 }, verseLayers: new Map([[43003016, []]]) } as never },
    });
    expect(layers.useChapterLayerStore.getState().tabs.t1?.['keyword-marks']).toBeDefined();
    window.localStorage.setItem('kth.modules', '-keyword-marks');
    reconcileModules();
    await waitFor(() => expect(slots.readerToolbarItems.list()).toEqual([]));
    expect(mine(slots.readerPaintControllers.list())).toEqual([]);
    expect(slots.wordMenuItems.list()).toEqual([]);
    expect(slots.strongsTooltipActions.list()).toEqual([]);
    expect(layers.useChapterLayerStore.getState().tabs.t1).toBeUndefined();
    expect(live.has('bible.toggleKeywordMarks')).toBe(false);
    window.localStorage.setItem('kth.modules', '');
    reconcileModules();
    expect(live.has('bible.toggleKeywordMarks')).toBe(true);
  }, 60_000);
});

describe('a saved session naming the module', () => {
  const saved = { version: 1, colorSafe: false, tabs: { t1: { enabled: true, activeSetIds: null, hiddenMarkIds: [] } } };

  it('keeps the saved keywordMarks section when the module is off, and boots', async () => {
    await boot('-keyword-marks');
    const { stashRestoredSessionUi, declaredSessionSections } = await import('../../stores/helpers/sessionRegistry');
    stashRestoredSessionUi({ keywordMarks: saved });
    expect(declaredSessionSections().keywordMarks).toEqual(saved);
  }, 60_000);

  it('hands the saved switches to the keyword store when the module is on', async () => {
    await boot('');
    const { stashRestoredSessionUi } = await import('../../stores/helpers/sessionRegistry');
    stashRestoredSessionUi({ keywordMarks: saved });
    const { useKeywordMarkStore } = await import('./useKeywordMarkStore');
    expect(useKeywordMarkStore.getState().colorSafe).toBe(false);
    expect(useKeywordMarkStore.getState().tabs.t1?.enabled).toBe(true);
  }, 60_000);
});
