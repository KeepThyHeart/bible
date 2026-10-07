import { describe, it, expect, vi } from 'vitest';
import { createFeatureModuleHost } from './FeatureModuleHost';
import { createStandardPoints, standardPointList } from './StandardPoints';
import { createModuleTimingLog } from './ModuleTimings';
import { implicitActivationEvents } from './FeatureModule';
import type { FeatureModuleManifest, FeatureModuleBinding } from './FeatureModule';
import { validateBuiltinManifest, toExtensionManifest } from './ManifestValidation';
import { validateManifest } from '../Extensions/ExtensionManifestValidator';

const label = (k: string) => ({ key: k, fallback: k });

function fixture(): FeatureModuleManifest {
  return {
    id: 'fixture',
    contributes: {
      panelTypes: [{ id: 'fixturePanel', title: label('fixture.panel') }],
      paneModes: [{ id: 'fixturePane', title: label('fixture.pane'), phoneView: true }],
      newTabTiles: [{ id: 'fixtureTile', title: label('fixture.tile'), target: { panelType: 'fixturePanel' }, keywords: ['fx'] }],
      settings: [{ id: 'fixture', defs: [{ key: 'fixtureOn', type: 'boolean', default: true, scope: 'device', group: 'fixture', labelKey: 'fixture.on' }] }],
      preferencesSections: [{ id: 'fixturePrefs', title: label('fixture.prefs'), settingsGroup: 'fixture' }],
      statusBarItems: [{ id: 'fixtureStatus', title: label('fixture.status'), alignment: 'right' }],
      i18nNamespace: 'fixture',
    },
  };
}

function setup(overrides: Record<string, boolean> = {}) {
  const points = createStandardPoints();
  const timings = createModuleTimingLog();
  const host = createFeatureModuleHost({
    platform: 'desktop',
    points: standardPointList(points),
    isFlagEnabled: () => true,
    overrides: () => overrides,
    onActivationTiming: (t) => timings.record(t),
  });
  return { points, host, timings };
}

describe('standard contribution points', () => {
  it('registers every contributed item and the binding views, and loads no code', () => {
    const { points, host } = setup();
    const loadPanel = vi.fn(async () => ({}));
    const load = vi.fn(async () => ({}));
    const binding: FeatureModuleBinding = { id: 'fixture', load, views: { 'panel:fixturePanel': loadPanel } };
    host.add(fixture(), binding);
    host.reconcile();
    expect(points.panelTypes.get('fixturePanel')).toBeTruthy();
    expect(points.paneModes.get('fixturePane')?.phoneView).toBe(true);
    expect(points.newTabTiles.get('fixtureTile')).toBeTruthy();
    expect(points.settings.get('fixture')?.defs).toHaveLength(1);
    expect(points.preferencesSections.get('fixturePrefs')).toBeTruthy();
    expect(points.statusBarItems.get('fixtureStatus')).toBeTruthy();
    expect(points.i18nNamespace.get('fixture')).toBeTruthy();
    expect(points.views.get('panel:fixturePanel')).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
    expect(loadPanel).not.toHaveBeenCalled();
  });

  it('a disabled module removes all its contributions and loads nothing', async () => {
    const { points, host } = setup({ fixture: false });
    const load = vi.fn(async () => ({}));
    const loadPanel = vi.fn(async () => ({}));
    host.add(fixture(), { id: 'fixture', load, views: { 'panel:fixturePanel': loadPanel } });
    host.reconcile();
    for (const p of Object.values(points)) expect(p.list()).toHaveLength(0);
    await host.fire('onPanel:fixturePanel');
    expect(load).not.toHaveBeenCalled();
    expect(loadPanel).not.toHaveBeenCalled();
  });

  it('turning a module off at runtime removes its contributions; on registers them again', () => {
    let off = false;
    const points = createStandardPoints();
    const host = createFeatureModuleHost({ platform: 'desktop', points: standardPointList(points), isFlagEnabled: () => true, overrides: () => ({ fixture: !off }) });
    host.add(fixture(), { id: 'fixture', views: { 'panel:fixturePanel': async () => ({}) } });
    host.reconcile();
    expect(points.panelTypes.list()).toHaveLength(1);
    off = true;
    host.reconcile();
    expect(points.panelTypes.list()).toHaveLength(0);
    expect(points.views.list()).toHaveLength(0);
    off = false;
    host.reconcile();
    expect(points.panelTypes.list()).toHaveLength(1);
  });

  it('opening a panel type fires onPanel, activating the module once, and records a timing', async () => {
    const { host, timings } = setup();
    const activate = vi.fn();
    const load = vi.fn(async () => ({ activate }));
    host.add(fixture(), { id: 'fixture', load });
    host.reconcile();
    expect(implicitActivationEvents(fixture().contributes)).toContain('onPanel:fixturePanel');
    expect(implicitActivationEvents(fixture().contributes)).toContain('onSetting:fixtureOn');
    await host.fire('onPanel:fixturePanel');
    await host.fire('onPanel:fixturePanel');
    expect(load).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(timings.list()).toHaveLength(1);
    expect(timings.format()).toContain('fixture');
  });

  it('resolves a view through a memoised lazy loader', async () => {
    const { points, host } = setup();
    const loader = vi.fn(async () => ({ default: 'X' }));
    host.add(fixture(), { id: 'fixture', views: { 'panel:fixturePanel': loader } });
    host.reconcile();
    const r = points.views.resolve('panel:fixturePanel')!;
    expect(r.started).toBe(false);
    await r();
    await r();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(points.views.resolve('panel:fixturePanel')).toBe(r);
    expect(points.views.resolve('panel:nope')).toBeUndefined();
  });
});

describe('built-in manifest validation', () => {
  it('accepts a good manifest', () => {
    expect(validateBuiltinManifest(fixture())).toEqual([]);
  });

  it('reports bad ids, titles, duplicates and targets', () => {
    const bad = fixture();
    const m: FeatureModuleManifest = {
      ...bad,
      contributes: {
        ...bad.contributes,
        panelTypes: [
          { id: 'a b', title: label('x') },
          { id: 'ok', title: { key: 'k' } as never },
          { id: 'ok', title: label('x') },
        ],
        newTabTiles: [{ id: 't', title: label('t'), target: {} as never }],
        statusBarItems: [{ id: 's', title: label('s'), alignment: 'middle' as never }],
      },
    };
    const errors = validateBuiltinManifest(m).join('\n');
    expect(errors).toMatch(/bad id/);
    expect(errors).toMatch(/title must be/);
    expect(errors).toMatch(/duplicate id "ok"/);
    expect(errors).toMatch(/target needs/);
    expect(errors).toMatch(/alignment/);
  });

  it('passes the #44 extension validator for the keys with an extension counterpart', () => {
    const result = validateManifest(toExtensionManifest(fixture()));
    expect(result.ok).toBe(true);
    if (!result.ok) expect(result.errors).toEqual([]);
  });
});
