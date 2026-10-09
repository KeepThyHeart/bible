/**
 * Genealogy and Timeline as feature modules (task 0124), through the real desktop host:
 * contributions exist after boot without loading any module code, the off switch (dev override
 * `localStorage['kth.modules']`) removes everything, and a saved layout naming the panel types
 * restores whether the module is on or off.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { SerializedDockview } from 'dockview-react';
import { validateBuiltinManifest } from '@bible/core/browser';
import { genealogyManifest } from './genealogy/manifest';
import { timelineManifest } from './timeline/manifest';

// The panes are stubbed (the heavy parts of the real panes are not the subject).
vi.mock('./timeline/TimelinePane', () => ({ default: () => <div data-testid="timeline-pane-stub" /> }));
vi.mock('./genealogy/GenealogyPane', () => ({ default: () => <div data-testid="genealogy-pane-stub" /> }));
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en', i18n: {} }),
}));

function fakeRegistry() {
  const commands = new Map<string, unknown>();
  return {
    commands,
    register: vi.fn((cmd: { id: string }) => {
      commands.set(cmd.id, cmd);
      return { dispose: () => void commands.delete(cmd.id) };
    }),
  };
}

async function boot(override: string) {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  const { registerBuiltinModules } = await import('./builtinModules');
  const host = await import('./moduleHost');
  const services = await import('./host/hostServices');
  const actions = await import('./host/entityActions');
  registerBuiltinModules();
  const registry = fakeRegistry();
  const loadNamespace = vi.fn().mockResolvedValue(undefined);
  services.bindModuleHostServices({ registry: registry as never, i18n: { loadNamespace } });
  return { ...host, actions, registry, loadNamespace };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('manifests', () => {
  it('validate, and keep the ids, orders and label keys the host declared before', () => {
    expect(validateBuiltinManifest(genealogyManifest)).toEqual([]);
    expect(validateBuiltinManifest(timelineManifest)).toEqual([]);
    for (const m of [genealogyManifest, timelineManifest]) {
      expect(m.platforms).toEqual(['desktop']);
      expect(m.flag).toBeUndefined();
    }
    expect(genealogyManifest.contributes.panelTypes).toEqual([
      { id: 'genealogy', title: { key: 'paneName.genealogy', fallback: 'Family Tree' }, order: 60 },
    ]);
    expect(timelineManifest.contributes.panelTypes).toEqual([
      { id: 'timeline', title: { key: 'paneName.timeline', fallback: 'Timeline' }, order: 61 },
    ]);
    expect(genealogyManifest.contributes.newTabTiles?.[0]).toMatchObject({
      id: 'genealogy', order: 45, title: { key: 'newTabPage.type.genealogy' }, target: { panelType: 'genealogy' }, keywords: ['genealogy', 'family'],
    });
    expect(timelineManifest.contributes.newTabTiles?.[0]).toMatchObject({
      id: 'timeline', order: 50, title: { key: 'newTabPage.type.timeline' }, target: { panelType: 'timeline' }, keywords: ['timeline'],
    });
    expect(genealogyManifest.contributes.i18nNamespace).toBe('genealogy');
    expect(timelineManifest.contributes.i18nNamespace).toBe('timeline');
  });
});

describe('on by default', () => {
  it('contributes panel types, tiles, namespaces and lazy views without loading module code', async () => {
    const { modulePoints, moduleTimings } = await boot('');
    for (const id of ['genealogy', 'timeline']) {
      expect(modulePoints.panelTypes.has(id)).toBe(true);
      expect(modulePoints.newTabTiles.has(id)).toBe(true);
      expect(modulePoints.i18nNamespace.has(id)).toBe(true);
      expect(modulePoints.views.resolve(`panel:${id}`)).toBeTypeOf('function');
    }
    expect(moduleTimings.list()).toEqual([]); // no module activated, so no module code loaded
  }, 60_000);

  it('onStartupFinished registers the timeline command and the family-tree action', async () => {
    const { featureModules, registry, actions, loadNamespace } = await boot('');
    await featureModules.fire('onStartupFinished');
    expect(registry.commands.has('timeline.open')).toBe(true);
    expect(loadNamespace).toHaveBeenCalledWith('timeline');
    expect(actions.entityActions.get('genealogy.showFamilyTree')).toMatchObject({ categories: ['people'], testId: 'show-family-tree' });
  }, 60_000);
});

describe('off switch', () => {
  it('-timeline removes its panel type, tile, namespace, view and command; genealogy is unaffected', async () => {
    const { modulePoints, featureModules, registry, actions, moduleTimings } = await boot('-timeline');
    expect(modulePoints.panelTypes.has('timeline')).toBe(false);
    expect(modulePoints.newTabTiles.has('timeline')).toBe(false);
    expect(modulePoints.i18nNamespace.has('timeline')).toBe(false);
    expect(modulePoints.views.resolve('panel:timeline')).toBeUndefined();
    await featureModules.fire('onStartupFinished');
    expect(registry.commands.has('timeline.open')).toBe(false);
    expect(moduleTimings.list().map((t) => t.moduleId)).not.toContain('timeline');
    expect(modulePoints.panelTypes.has('genealogy')).toBe(true);
    expect(modulePoints.newTabTiles.has('bible')).toBe(true);
    expect(actions.entityActions.has('genealogy.showFamilyTree')).toBe(true);
  }, 60_000);

  it('-genealogy removes its panel type, tile, namespace, view and entity action; timeline is unaffected', async () => {
    const { modulePoints, featureModules, registry, actions, moduleTimings } = await boot('-genealogy');
    expect(modulePoints.panelTypes.has('genealogy')).toBe(false);
    expect(modulePoints.newTabTiles.has('genealogy')).toBe(false);
    expect(modulePoints.i18nNamespace.has('genealogy')).toBe(false);
    expect(modulePoints.views.resolve('panel:genealogy')).toBeUndefined();
    await featureModules.fire('onStartupFinished');
    expect(actions.entityActions.list()).toEqual([]);
    expect(moduleTimings.list().map((t) => t.moduleId)).not.toContain('genealogy');
    expect(modulePoints.panelTypes.has('timeline')).toBe(true);
    expect(registry.commands.has('timeline.open')).toBe(true);
  }, 60_000);

  it('switching a running module off at runtime disposes its command and action', async () => {
    const { featureModules, reconcileModules, registry, actions, modulePoints } = await boot('');
    await featureModules.fire('onStartupFinished');
    expect(registry.commands.has('timeline.open')).toBe(true);
    expect(actions.entityActions.has('genealogy.showFamilyTree')).toBe(true);
    window.localStorage.setItem('kth.modules', '-timeline,-genealogy');
    reconcileModules();
    expect(registry.commands.has('timeline.open')).toBe(false);
    expect(actions.entityActions.has('genealogy.showFamilyTree')).toBe(false);
    expect(modulePoints.panelTypes.has('timeline')).toBe(false);
    expect(modulePoints.panelTypes.has('genealogy')).toBe(false);
  }, 60_000);
});

function layoutNaming(types: string[]): SerializedDockview {
  const panels: Record<string, unknown> = {};
  types.forEach((type, i) => {
    panels[`${type}_${i}`] = { id: `${type}_${i}`, contentComponent: 'panelContent', title: type, params: { contentType: type } };
  });
  const ids = Object.keys(panels);
  return {
    grid: { root: { type: 'branch', size: 1000, data: [{ type: 'leaf', size: 1000, data: { id: 'g1', views: ids, activeView: ids[0] } }] }, width: 1000, height: 1000, orientation: 'HORIZONTAL' },
    panels,
    activeGroup: 'g1',
  } as unknown as SerializedDockview;
}

describe('a saved layout naming the panel types', () => {
  async function renderPanel(contentType: string) {
    const { default: PanelContentRenderer } = await import('../components/PanelContentRenderer');
    const props = { params: { contentType }, api: { id: `${contentType}_0` } } as unknown as ComponentProps<typeof PanelContentRenderer>;
    return render(<PanelContentRenderer {...props} />);
  }

  it('is kept by the sanitizer whether or not the modules are on', async () => {
    await boot('-timeline,-genealogy');
    const { sanitizeDockviewState } = await import('../services/LayoutStateSanitizer');
    const layout = layoutNaming(['bible', 'genealogy', 'timeline']);
    const result = sanitizeDockviewState(layout);
    expect(result.layout).toBe(layout);
    expect(result.repairs).toEqual([]);
  }, 60_000);

  it('on: the panels render their lazy views', async () => {
    await boot('');
    await renderPanel('timeline');
    expect(await screen.findByTestId('timeline-pane-stub')).toBeInTheDocument();
    await renderPanel('genealogy');
    expect(await screen.findByTestId('genealogy-pane-stub')).toBeInTheDocument();
  }, 60_000);

  it('off: the panels show the "unavailable" placeholder and nothing crashes', async () => {
    await boot('-timeline,-genealogy');
    await renderPanel('timeline');
    await renderPanel('genealogy');
    await waitFor(() => expect(screen.getAllByTestId('panel-unavailable')).toHaveLength(2));
    expect(screen.queryByTestId('timeline-pane-stub')).toBeNull();
    expect(screen.queryByTestId('genealogy-pane-stub')).toBeNull();
  }, 60_000);
});
