/**
 * The Measures and Keyword marks modules through the REAL web host (task 0127):
 * contributions, the dev-override off switch (each module alone and both), lazy
 * activation and the host slots they fill, and the runtime switch-off. Each test
 * boots a fresh module graph, like timelineGenealogyModules.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { measureSettingsRegistry, validateBuiltinManifest } from '@bible/core/browser';
import { measuresManifest } from './measures/manifest';
import { keywordMarksManifest } from './keyword-marks/manifest';

vi.mock('../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../i18n')>()),
  loadNamespace: async () => {},
}));

async function boot(override = '') {
  vi.resetModules();
  localStorage.setItem('kth.modules', override);
  const { registerBuiltinModules } = await import('./builtinModules');
  const host = await import('./moduleHost');
  const slots = await import('../host/slots');
  registerBuiltinModules();
  return { ...host, slots };
}
type Host = Awaited<ReturnType<typeof boot>>;

const settingKeys = (h: Host) => h.modulePoints.settings.list().flatMap((g) => g.defs.map((d) => d.key));
const sectionIds = (h: Host) => h.modulePoints.preferencesSections.list().map((s) => s.id);
const ns = (h: Host) => h.modulePoints.i18nNamespace.list().map((n) => n.id);
const slotCounts = (h: Host) => ({
  paint: h.slots.readerPaintControllers.list().length,
  toolbar: h.slots.readerToolbarItems.list().length,
  study: h.slots.studySections.list().map((s) => s.id),
  mobile: h.slots.mobileStudySections.list().map((s) => s.id),
});

vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('manifests', () => {
  it('validate and keep the persisted ids, setting keys and labels', () => {
    expect(validateBuiltinManifest(measuresManifest)).toEqual([]);
    expect(validateBuiltinManifest(keywordMarksManifest)).toEqual([]);
    expect(measuresManifest.contributes.settings?.[0].defs.map((d) => d.key)).toEqual(
      measureSettingsRegistry.definitions.map((d) => d.key),
    );
    expect(measuresManifest.contributes.settings?.[0].defs.map((d) => d.key)).toContain('measuresDisplay');
    expect(keywordMarksManifest.contributes.settings?.[0].defs.map((d) => [d.key, d.group])).toEqual([['keywordColorSafe', 'keywords']]);
    expect(measuresManifest.contributes.preferencesSections).toEqual([
      expect.objectContaining({ id: 'measures', parent: 'theme', settingsGroup: 'measures', title: { key: 'settings.measures.title', fallback: 'Weights and measures' } }),
    ]);
    expect(keywordMarksManifest.contributes.preferencesSections?.[0]).toMatchObject({ parent: 'theme', settingsGroup: 'keywords' });
    expect(measuresManifest.hooks).toBeUndefined();
    expect(keywordMarksManifest.hooks).toBeUndefined();
  });
});

describe('on by default, nothing loaded at boot', () => {
  it('contributes settings, Theme sub-sections and namespaces, and activates no code', async () => {
    const h = await boot();
    expect(settingKeys(h)).toEqual(expect.arrayContaining(['measuresEnabled', 'measuresSystem', 'keywordColorSafe']));
    expect(sectionIds(h)).toEqual(expect.arrayContaining(['measures', 'keyword-marks']));
    // Keyword marks first, measures after, inside the Theme tab.
    expect(h.modulePoints.preferencesSections.list().filter((s) => s.parent === 'theme').map((s) => s.id)).toEqual(['keyword-marks', 'measures']);
    expect(ns(h)).toEqual(expect.arrayContaining(['measures', 'keywordMarks']));
    expect(h.modulePoints.views.resolve('preferences:measures')).toBeDefined();
    expect(h.modulePoints.views.resolve('preferences:keyword-marks')).toBeDefined();
    expect(h.featureModules.isActive('measures')).toBe(false);
    expect(h.featureModules.isActive('keyword-marks')).toBe(false);
    expect(slotCounts(h)).toEqual({ paint: 0, toolbar: 0, study: [], mobile: [] });
  });

  it('the boot probe activates both after first paint, and they fill the generic slots', async () => {
    const h = await boot();
    const intents = h.runBootProbes();
    expect(intents.activate).toEqual(expect.arrayContaining(['measures', 'keyword-marks']));
    await Promise.all(intents.activate.map((id) => h.featureModules.activateNow(id, 'onBootProbe')));
    expect(slotCounts(h)).toEqual({ paint: 2, toolbar: 1, study: ['measures'], mobile: ['measures'] });
    expect(h.slots.mobileStudySections.list()[0].Section).toBeDefined();
  });
});

describe('the dev override switches each module off', () => {
  it('-measures removes its settings, section, namespace and view, runs no probe, and leaves keyword marks alone', async () => {
    const h = await boot('-measures');
    expect(settingKeys(h)).toEqual(['keywordColorSafe']);
    expect(sectionIds(h)).not.toContain('measures');
    expect(ns(h)).not.toContain('measures');
    expect(h.modulePoints.views.resolve('preferences:measures')).toBeUndefined();
    const intents = h.runBootProbes();
    expect(intents.activate).toContain('keyword-marks');
    expect(intents.activate).not.toContain('measures');
    await Promise.all(intents.activate.map((id) => h.featureModules.activateNow(id, 'onBootProbe')));
    expect(slotCounts(h)).toEqual({ paint: 1, toolbar: 1, study: [], mobile: [] });
  });

  it('-keyword-marks removes its setting, section, namespace, toolbar button and paint, and leaves measures alone', async () => {
    const h = await boot('-keyword-marks');
    expect(settingKeys(h)).not.toContain('keywordColorSafe');
    expect(settingKeys(h)).toContain('measuresEnabled');
    expect(sectionIds(h)).not.toContain('keyword-marks');
    expect(ns(h)).not.toContain('keywordMarks');
    expect(h.modulePoints.views.resolve('preferences:keyword-marks')).toBeUndefined();
    const intents = h.runBootProbes();
    expect(intents.activate).not.toContain('keyword-marks');
    await Promise.all(intents.activate.map((id) => h.featureModules.activateNow(id, 'onBootProbe')));
    expect(slotCounts(h)).toEqual({ paint: 1, toolbar: 0, study: ['measures'], mobile: ['measures'] });
  });

  it('both off: no contribution of either remains, and the host slots are all empty', async () => {
    const h = await boot('-measures,-keyword-marks');
    expect(settingKeys(h)).not.toContain('keywordColorSafe');
    expect(settingKeys(h).some((k) => k.startsWith('measures'))).toBe(false);
    expect(h.modulePoints.preferencesSections.list().filter((s) => s.parent === 'theme')).toEqual([]);
    expect(h.runBootProbes().activate).toEqual(expect.not.arrayContaining(['measures', 'keyword-marks']));
    expect(slotCounts(h)).toEqual({ paint: 0, toolbar: 0, study: [], mobile: [] });
  });
});

describe('switching off at runtime', () => {
  it('removes everything the activated modules put in the slots and the registry', async () => {
    const h = await boot();
    await Promise.all(h.runBootProbes().activate.map((id) => h.featureModules.activateNow(id, 'onBootProbe')));
    expect(slotCounts(h).paint).toBe(2);
    localStorage.setItem('kth.modules', '-measures,-keyword-marks');
    h.reconcileModules();
    expect(slotCounts(h)).toEqual({ paint: 0, toolbar: 0, study: [], mobile: [] });
    expect(sectionIds(h)).not.toContain('measures');
    expect(settingKeys(h)).not.toContain('keywordColorSafe');
  });
});

describe('the colour-safe setting follows the module', () => {
  it('reads its default while on, and the store ignores a write while the module is off', async () => {
    const on = await boot();
    const { currentSettings, setSetting } = await import('./host/contributedSettings');
    expect(currentSettings().keywordColorSafe).toBe(true);
    setSetting('keywordColorSafe', false);
    expect(currentSettings().keywordColorSafe).toBe(false);
    expect(JSON.parse(localStorage.getItem('bible-reader-settings') ?? '{}').keywordColorSafe).toBe(false);
    expect(on.featureModules.isEnabled('keyword-marks')).toBe(true);

    const off = await boot('-keyword-marks');
    const helpers = await import('./host/contributedSettings');
    expect(helpers.currentSettings().keywordColorSafe).toBeUndefined();
    helpers.setSetting('keywordColorSafe', true); // not registered: ignored, the saved value is untouched
    expect(JSON.parse(localStorage.getItem('bible-reader-settings') ?? '{}').keywordColorSafe).toBe(false);
    expect(off.featureModules.isEnabled('keyword-marks')).toBe(false);
  });
});
