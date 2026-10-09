import { describe, it, expect, vi } from 'vitest';
import { createFeatureModuleHost, createStandardPoints, standardPointList, validateBuiltinManifest } from '@bible/core/browser';
import type { FeatureModuleManifest } from '@bible/core/browser';
import { hostPanesModules, CORE_PANE_MODES, resolvePhoneView } from './panes';
import { timelineModule } from '../timeline/binding';

// The Timeline pane lives in its own module (task 0124); the persisted order still includes it.
const allPanes = [...hostPanesModules, [timelineModule.manifest, timelineModule.binding] as const];

function setup(flags: Record<string, boolean>) {
  const points = createStandardPoints();
  const host = createFeatureModuleHost({
    platform: 'web',
    points: standardPointList(points),
    isFlagEnabled: (f) => flags[f] ?? false,
  });
  return { points, host, flags };
}

describe('host pane manifests', () => {
  it('validate', () => {
    for (const [m] of hostPanesModules) expect(validateBuiltinManifest(m), m.id).toEqual([]);
  });

  it('declare exactly the persisted ids, once each, in tab order', () => {
    const { points, host } = setup({ timeline: true, quiz: true });
    for (const [m, b] of allPanes) host.add(m, b);
    host.reconcile();
    expect(points.paneModes.list().map((p) => p.id)).toEqual([...CORE_PANE_MODES]);
    expect(points.paneModes.list().filter((p) => p.phoneView).map((p) => p.id)).toEqual(['study', 'commentary', 'wordStudy']);
    expect(points.paneModes.get('search')).toBeUndefined();
  });

  it('flagged panes follow their flag', () => {
    const { points, host, flags } = setup({});
    for (const [m, b] of allPanes) host.add(m, b);
    host.reconcile();
    const ids = () => points.paneModes.list().map((p) => p.id);
    expect(ids()).not.toContain('timeline');
    expect(ids()).not.toContain('quiz');
    expect(points.views.resolve('pane:quiz')).toBeUndefined();
    flags.quiz = true;
    host.reconcile();
    expect(ids()).toContain('quiz');
    expect(points.views.resolve('pane:quiz')).toBeDefined();
  });
});

describe('a fixture pane module', () => {
  const manifest: FeatureModuleManifest = {
    id: 'fixture-pane',
    flag: 'quiz',
    contributes: { paneModes: [{ id: 'fixture', title: { key: 'rightPane.fixture', fallback: 'Fixture' }, phoneView: true }] },
  };

  it('is absent and never loaded while disabled; appears and loads once when enabled', async () => {
    const view = vi.fn(async () => ({ default: () => null }));
    const { points, host, flags } = setup({});
    expect(validateBuiltinManifest(manifest)).toEqual([]);
    host.add(manifest, { id: 'fixture-pane', views: { 'pane:fixture': view } });
    host.reconcile();
    expect(points.paneModes.has('fixture')).toBe(false);
    expect(points.views.resolve('pane:fixture')).toBeUndefined();
    await host.fire('onPanel:fixture');
    expect(view).not.toHaveBeenCalled();

    flags.quiz = true;
    host.reconcile();
    expect(points.paneModes.has('fixture')).toBe(true);
    const loader = points.views.resolve('pane:fixture')!;
    expect(view).not.toHaveBeenCalled();
    await loader();
    await points.views.resolve('pane:fixture')!();
    expect(view).toHaveBeenCalledTimes(1);
  });
});

describe('resolvePhoneView', () => {
  const views = new Set(['study', 'commentary', 'wordStudy']);
  it('keeps core views and enabled module views', () => {
    for (const v of ['home', 'bible', 'search', 'study', 'commentary', 'wordStudy']) expect(resolvePhoneView(v, views)).toBe(v);
  });
  it('falls back to the reader when the view\'s module is off, instead of rendering nothing', () => {
    expect(resolvePhoneView('commentary', new Set(['study']))).toBe('bible');
    expect(resolvePhoneView('study', new Set())).toBe('bible');
    expect(resolvePhoneView('home', new Set())).toBe('home');
  });
});
