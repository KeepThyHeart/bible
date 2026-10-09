/**
 * The Timeline and Genealogy modules through the REAL web host (task 0124):
 * contributions, the flag and dev-override off switches, lazy activation and
 * the host slots they fill. Each test boots a fresh module graph, like
 * builtinModules.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { timelineManifest } from './timeline/manifest';
import { genealogyManifest } from './genealogy/manifest';

vi.mock('../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../i18n')>()),
  loadNamespace: async () => {},
}));

async function boot(opts: { override?: string; features?: Record<string, boolean> } = {}) {
  vi.resetModules();
  localStorage.setItem('kth.modules', opts.override ?? '');
  const { setClientConfig } = await import('../utils/clientConfig');
  setClientConfig({ features: { tagGraph: true, ...opts.features } });
  const { registerBuiltinModules } = await import('./builtinModules');
  const host = await import('./moduleHost');
  const slots = await import('../host/slots');
  registerBuiltinModules();
  return { ...host, slots };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('manifests', () => {
  it('validate and keep the persisted ids', () => {
    expect(validateBuiltinManifest(timelineManifest)).toEqual([]);
    expect(validateBuiltinManifest(genealogyManifest)).toEqual([]);
    expect(timelineManifest.contributes.paneModes).toEqual([{ id: 'timeline', title: { key: 'rightPane.timeline', fallback: 'Timeline' }, order: 40 }]);
    expect(timelineManifest.contributes.serverRoutes?.map((r) => r.path)).toEqual(['/api/timeline']);
  });
});

describe('flags default off: both features are absent', () => {
  it('contributes nothing and runs no probe', async () => {
    const h = await boot();
    expect(h.modulePoints.paneModes.get('timeline')).toBeUndefined();
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).not.toContain('timeline');
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).not.toContain('genealogy');
    expect(h.runBootProbes().activate).not.toContain('timeline');
    expect(h.runBootProbes().activate).not.toContain('genealogy');
    expect(h.modulePoints.views.resolve('pane:timeline')).toBeUndefined();
  });
});

describe('flags on', () => {
  it('Timeline contributes its pane, view and namespace and loads no code at boot', async () => {
    const h = await boot({ features: { timeline: true } });
    expect(h.modulePoints.paneModes.get('timeline')).toMatchObject({ id: 'timeline', order: 40 });
    expect(h.modulePoints.views.resolve('pane:timeline')).toBeDefined();
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).toContain('timeline');
    expect(h.featureModules.isActive('timeline')).toBe(false);
    expect(h.slots.mobileStudySections.list()).toEqual([]);
  });

  it('the boot probe activates Timeline and Genealogy, which fill the Study slots', async () => {
    const h = await boot({ features: { timeline: true, genealogy: true } });
    const intents = h.runBootProbes();
    expect(intents.activate).toEqual(expect.arrayContaining(['timeline', 'genealogy']));
    await Promise.all(intents.activate.map((id) => h.featureModules.activateNow(id, 'onBootProbe')));
    expect(h.slots.mobileStudySections.list().map((s) => s.id).sort()).toEqual(['family-tree', 'timeline']);
    expect(h.slots.studyModes.list().map((m) => m.id)).toEqual(['family-tree']);
    expect(h.slots.topicEntityActions.list().map((a) => [a.id, a.category])).toEqual([['family-tree', 'people']]);
  });

  it('switching a module off at runtime removes what it put in the slots', async () => {
    const h = await boot({ features: { timeline: true, genealogy: true } });
    await Promise.all(h.runBootProbes().activate.map((id) => h.featureModules.activateNow(id, 'onBootProbe')));
    expect(h.slots.studyModes.list()).toHaveLength(1);
    localStorage.setItem('kth.modules', '-genealogy,-timeline');
    h.reconcileModules();
    expect(h.slots.studyModes.list()).toEqual([]);
    expect(h.slots.mobileStudySections.list()).toEqual([]);
    expect(h.slots.topicEntityActions.list()).toEqual([]);
    expect(h.modulePoints.paneModes.get('timeline')).toBeUndefined();
  });
});

describe('the family tree action', () => {
  it('opens the family tree on the person: Study pane on desktop, the sheet on phone', async () => {
    const h = await boot({ features: { genealogy: true } });
    await h.featureModules.activateNow('genealogy', 'onBootProbe');
    const { studyStore } = await import('../stores/studyStore');
    const { commentaryStore } = await import('../stores/commentaryStore');
    const [action] = h.slots.topicEntityActions.list();
    action.run('david', 'David', { mobile: false });
    expect(studyStore.studyMode).toBe('family-tree');
    expect(studyStore.studyModeFocus).toMatchObject({ personId: 'david', name: 'David' });
    expect(commentaryStore.rightPaneMode).toBe('study');
    studyStore.closeStudyMode();
    studyStore.openTopicsBrowser();
    action.run('moses', 'Moses', { mobile: true });
    expect(studyStore.topicsBrowserOpen).toBe(false);
    expect(studyStore.studyModeFocus).toMatchObject({ personId: 'moses' });
  });
});

describe('the dev override switches a flagged-on module off', () => {
  it('-timeline removes the pane, view and namespace, and leaves Genealogy alone', async () => {
    const h = await boot({ override: '-timeline', features: { timeline: true, genealogy: true } });
    expect(h.modulePoints.paneModes.get('timeline')).toBeUndefined();
    expect(h.modulePoints.views.resolve('pane:timeline')).toBeUndefined();
    expect(JSON.stringify(h.modulePoints.i18nNamespace.list())).not.toContain('"timeline"');
    expect(h.runBootProbes().activate).toEqual(['genealogy']);
  });

  it('-genealogy keeps Timeline', async () => {
    const h = await boot({ override: '-genealogy', features: { timeline: true, genealogy: true } });
    expect(h.modulePoints.paneModes.get('timeline')).toBeDefined();
    expect(h.runBootProbes().activate).toEqual(['timeline']);
  });

  it('a server that reports the module off wins over the flag', async () => {
    vi.resetModules();
    localStorage.setItem('kth.modules', '');
    const { setClientConfig } = await import('../utils/clientConfig');
    setClientConfig({ features: { timeline: true }, modules: { disabled: ['timeline'] } });
    const { registerBuiltinModules } = await import('./builtinModules');
    const host = await import('./moduleHost');
    registerBuiltinModules();
    expect(host.modulePoints.paneModes.get('timeline')).toBeUndefined();
  });
});
