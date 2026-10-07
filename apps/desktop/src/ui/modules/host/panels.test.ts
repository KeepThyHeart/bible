import { describe, it, expect, vi } from 'vitest';
import type { SerializedDockview } from 'dockview-react';
import {
  createFeatureModuleHost,
  createStandardPoints,
  standardPointList,
  toExtensionManifest,
  validateBuiltinManifest,
} from '@bible/core/browser';
import { validateManifest } from '@bible/core/Extensions/ExtensionManifestValidator';
import type { FeatureModuleManifest } from '@bible/core/browser';
import { hostPanelsBinding, hostPanelsManifest } from './panels';
import { CORE_PANEL_TYPES } from '../../stores/useLayoutStore';
import { sanitizeDockviewState } from '../../services/LayoutStateSanitizer';

function layoutNaming(types: string[], component = 'panelContent'): SerializedDockview {
  const panels: Record<string, unknown> = {};
  types.forEach((type, i) => {
    panels[`${type}_${i}`] = { id: `${type}_${i}`, contentComponent: component, title: type, params: { contentType: type } };
  });
  const ids = Object.keys(panels);
  return {
    grid: {
      root: { type: 'branch', size: 1000, data: [{ type: 'leaf', size: 1000, data: { id: 'g1', views: ids, activeView: ids[0] } }] },
      width: 1000,
      height: 1000,
      orientation: 'HORIZONTAL',
    },
    panels,
    activeGroup: 'g1',
  } as unknown as SerializedDockview;
}

describe('host panel types manifest', () => {
  it('declares exactly the 16 persisted ids, once each', () => {
    const ids = (hostPanelsManifest.contributes.panelTypes ?? []).map((p) => p.id);
    expect([...ids].sort()).toEqual([...CORE_PANEL_TYPES].sort());
    expect(Object.keys(hostPanelsBinding.views ?? {}).sort()).toEqual(CORE_PANEL_TYPES.map((t) => `panel:${t}`).sort());
    expect(hostPanelsManifest.id).toBe('host');
    expect(hostPanelsManifest.flag).toBeUndefined();
    expect(hostPanelsManifest.platforms).toEqual(['desktop']);
  });

  it('validates as a built-in manifest and as an extension manifest', () => {
    expect(validateBuiltinManifest(hostPanelsManifest)).toEqual([]);
    const result = validateManifest(toExtensionManifest(hostPanelsManifest));
    expect(result.ok).toBe(true);
    if (!result.ok) expect(result.errors).toEqual([]);
  });
});

describe('layouts naming panel types survive restore sanitizing', () => {
  it('passes a layout naming all 16 core types through unchanged', () => {
    const layout = layoutNaming([...CORE_PANEL_TYPES]);
    const result = sanitizeDockviewState(layout);
    expect(result.layout).toBe(layout);
    expect(result.repairs).toEqual([]);
  });

  it('repairs a corrupted contentComponent for every core type, keeping all panels', () => {
    const result = sanitizeDockviewState(layoutNaming([...CORE_PANEL_TYPES], 'unknown'));
    expect(result.repairs.every((r) => r.action === 'repaired')).toBe(true);
    expect(Object.keys(result.layout!.panels)).toHaveLength(CORE_PANEL_TYPES.length);
  });

  it('keeps a panel of an unregistered type (module off) in the layout', () => {
    const layout = layoutNaming(['bible', 'fixturePanel', 'ext:acme.thing']);
    const result = sanitizeDockviewState(layout);
    expect(result.layout).toBe(layout);
    expect(Object.keys(result.layout!.panels)).toHaveLength(3);
  });
});

describe('a feature module contributing a panel type', () => {
  function setup(enabled: boolean) {
    const points = createStandardPoints();
    const host = createFeatureModuleHost({
      platform: 'desktop',
      points: standardPointList(points),
      isFlagEnabled: () => enabled,
    });
    const load = vi.fn(async () => ({ default: () => null }));
    const manifest: FeatureModuleManifest = {
      id: 'fixture',
      flag: 'quiz',
      contributes: { panelTypes: [{ id: 'fixturePanel', title: { key: 'fixture.title', fallback: 'Fixture' } }] },
    };
    host.add(manifest, { id: 'fixture', views: { 'panel:fixturePanel': load } });
    host.reconcile();
    return { points, load };
  }

  it('disabled: the type is absent and the view never loads', () => {
    const { points, load } = setup(false);
    expect(points.panelTypes.has('fixturePanel')).toBe(false);
    expect(points.views.resolve('panel:fixturePanel')).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('enabled: the lazy view resolves once, on first use', async () => {
    const { points, load } = setup(true);
    expect(points.panelTypes.has('fixturePanel')).toBe(true);
    expect(load).not.toHaveBeenCalled();
    const loader = points.views.resolve('panel:fixturePanel')!;
    await loader();
    await points.views.resolve('panel:fixturePanel')!();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
