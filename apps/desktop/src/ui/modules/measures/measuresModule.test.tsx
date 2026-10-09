/**
 * The Weights, measures and money feature module through the real desktop host (task 0127): manifest,
 * "on by default loads nothing", the off switch (boot and runtime, including the reader slots and the
 * published layers), activation on the reader view, and a saved session / Preferences section that
 * names what the module owns.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MEASURE_SETTINGS, validateBuiltinManifest } from '@bible/core/browser';
import { measuresManifest } from './manifest';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, locale: 'en', language: 'en', i18n: { currentDirection: 'ltr' } }),
}));
vi.mock('../../services/electronAPI', () => ({
  bibleAPI: { getInterlinearWordsForChapter: vi.fn().mockResolvedValue({}) },
}));

async function boot(override = '') {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  const { measuresModule } = await import('./binding');
  const loadSpy = vi.spyOn(measuresModule.binding!, 'load');
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const slots = await import('../host/slots');
  const layers = await import('../../extensions/chapterLayers');
  registerBuiltinModules();
  // Both reader modules activate on the same view event, so each test looks at its own module's items.
  const mine = (items: readonly unknown[]) => items.filter((i) => /Measure/.test((i as { name?: string }).name ?? ''));
  return { ...host, slots, layers, loadSpy, mine };
}

const ACTIVATION = { timeout: 30_000 };

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('measures manifest', () => {
  it('validates and keeps the persisted ids, orders and label keys', () => {
    expect(validateBuiltinManifest(measuresManifest)).toEqual([]);
    expect(measuresManifest.id).toBe('measures');
    expect(measuresManifest.platforms).toEqual(['desktop']);
    expect(measuresManifest.activationEvents).toEqual(['onView:bible']);
    const c = measuresManifest.contributes;
    expect(c.preferencesSections).toEqual([
      {
        id: 'measures',
        title: { key: 'preferencesDialog.sectionMeasures', fallback: 'Weights and measures' },
        icon: { kind: 'builtin', name: 'measures' },
        order: 50,
      },
    ]);
    expect(c.settings?.[0].defs.map((d) => d.key)).toEqual(MEASURE_SETTINGS.map((d) => d.key));
    expect(c.settings?.[0].defs.every((d) => d.key.startsWith('measures'))).toBe(true);
    expect(c.i18nNamespace).toBe('measures');
  });
});

describe('measures module in the desktop host', () => {
  it('is on by default: contributions exist and no module code has loaded', async () => {
    const { modulePoints, loadSpy, featureModules, slots } = await boot('');
    expect(modulePoints.preferencesSections.list().some((s) => s.id === 'measures')).toBe(true);
    expect(modulePoints.settings.list().some((g) => g.id === 'measures')).toBe(true);
    expect(modulePoints.views.resolve('preferences:measures')).toBeTypeOf('function');
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'measures')).toBe(true);
    expect(slots.preferencesSectionGlyphs.list().map((g) => g.id)).toContain('measures');
    expect(loadSpy).not.toHaveBeenCalled();
    expect(featureModules.isActive('measures')).toBe(false);
    expect(slots.readerPaintControllers.list()).toHaveLength(0);
    expect(slots.studyPaneSections.list()).toHaveLength(0);
    // The sidebar order is unchanged: the section sits between Apps and Advanced.
    const ids = modulePoints.preferencesSections.list().map((s) => s.id);
    expect(ids.slice(ids.indexOf('apps'), ids.indexOf('advanced') + 1)).toEqual(['apps', 'measures', 'advanced']);
  }, 60_000);

  it('activates when the reader view mounts and registers its controller and Study section', async () => {
    const { loadSpy, featureModules, slots, mine } = await boot('');
    render(
      <slots.ReaderPaintControllers
        tabId={undefined} moduleId={0} abbreviation={undefined} language={undefined} bookNumber={0} chapter={0}
        verses={[]} surface="standard" uiLocale="en" active={false} containerRef={{ current: null }}
      />,
    );
    await waitFor(() => expect(featureModules.isActive('measures')).toBe(true), ACTIVATION);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(mine(slots.readerPaintControllers.list())).toHaveLength(1);
    expect(slots.studyPaneSections.list()).toHaveLength(1);
  }, 60_000);

  it('off switch: no section, settings, view, namespace, glyph or reader slots; the reader slots render nothing and no code loads', async () => {
    const { modulePoints, loadSpy, featureModules, slots, mine } = await boot('-measures');
    const { container } = render(
      <slots.ReaderPaintControllers
        tabId="t1" moduleId={5} abbreviation="KJV" language="en" bookNumber={1} chapter={1}
        verses={[]} surface="standard" uiLocale="en" active containerRef={{ current: null }}
      />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(modulePoints.preferencesSections.list().some((s) => s.id === 'measures')).toBe(false);
    expect(modulePoints.settings.list().some((g) => g.id === 'measures')).toBe(false);
    expect(modulePoints.views.resolve('preferences:measures')).toBeUndefined();
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'measures')).toBe(false);
    expect(slots.preferencesSectionGlyphs.list()).toEqual([]);
    expect(mine(slots.readerPaintControllers.list())).toEqual([]);
    expect(slots.studyPaneSections.list()).toEqual([]);
    expect(featureModules.list().find((m) => m.id === 'measures')).toMatchObject({ enabled: false, offReason: 'override' });
    expect(loadSpy).not.toHaveBeenCalled();
    // Other modules are unaffected.
    expect(featureModules.list().find((m) => m.id === 'keyword-marks')).toMatchObject({ enabled: true });
    expect(modulePoints.preferencesSections.list().some((s) => s.id === 'advanced')).toBe(true);
  }, 60_000);

  it('switched off at runtime: slots empty and published layers withdrawn', async () => {
    const { reconcileModules, featureModules, slots, layers, mine } = await boot('');
    await featureModules.fire('onView:bible');
    expect(mine(slots.readerPaintControllers.list())).toHaveLength(1);
    const { useMeasureStore } = await import('./useMeasureStore');
    // A chapter result in the store reaches the host's layer store while the module is active...
    useMeasureStore.setState({
      chapters: { t1: { moduleId: 5, surface: 'standard', verseLayers: new Map([[1006015, []]]) } as never },
    });
    expect(layers.useChapterLayerStore.getState().tabs.t1?.measures).toBeDefined();
    window.localStorage.setItem('kth.modules', '-measures');
    reconcileModules();
    await waitFor(() => expect(mine(slots.readerPaintControllers.list())).toEqual([]));
    expect(slots.studyPaneSections.list()).toEqual([]);
    expect(layers.useChapterLayerStore.getState().tabs.t1).toBeUndefined();
    expect(slots.preferencesSectionGlyphs.list()).toEqual([]);
  }, 60_000);
});

describe('a saved session naming the module', () => {
  it('keeps the saved measures section when the module is off, and boots', async () => {
    await boot('-measures');
    const { stashRestoredSessionUi, declaredSessionSections } = await import('../../stores/helpers/sessionRegistry');
    stashRestoredSessionUi({ measures: { version: 1, values: { measuresSystem: 'metric' } } });
    expect(declaredSessionSections().measures).toEqual({ version: 1, values: { measuresSystem: 'metric' } });
  }, 60_000);

  it('hands the saved values to the measure store when the module is on', async () => {
    await boot('');
    const { stashRestoredSessionUi } = await import('../../stores/helpers/sessionRegistry');
    stashRestoredSessionUi({ measures: { version: 1, values: { measuresSystem: 'metric', other: 1 } } });
    const { useMeasureStore } = await import('./useMeasureStore');
    expect(useMeasureStore.getState().values).toEqual({ measuresSystem: 'metric' });
  }, 60_000);
});
