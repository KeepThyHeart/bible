import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/preact';
import {
  createFeatureModuleHost,
  createStandardPoints,
  standardPointList,
  validateBuiltinManifest,
} from '@bible/core/browser';
import type { FeatureModuleManifest } from '@bible/core/browser';
import { hostUiManifest, HOME_TILES, SETTINGS_SECTIONS } from './ui';
import { useStatusBarItems } from './statusBar';
import { startModuleNamespaceLoading } from './i18nNamespaces';
import { contributedSettings } from '../../stores/settingsRegistry';

function makeHost(overrides: Record<string, boolean> = {}) {
  const points = createStandardPoints();
  const host = createFeatureModuleHost({
    platform: 'web',
    points: standardPointList(points),
    isFlagEnabled: () => true,
    overrides: () => overrides,
  });
  return { points, host };
}

const fixture: FeatureModuleManifest = {
  id: 'fixture',
  contributes: {
    newTabTiles: [{ id: 'fixtureTile', title: { key: 'f.tile', fallback: 'Fixture' }, order: 40, target: { panelType: 'fixture' } }],
    preferencesSections: [{ id: 'fixture', title: { key: 'f.sec', fallback: 'Fixture' }, order: 100, settingsGroup: 'fixture' }],
    statusBarItems: [{ id: 'fixtureStatus', title: { key: 'f.st', fallback: 'Fixture' }, alignment: 'right' }],
    settings: [
      {
        id: 'fixture',
        defs: [{ key: 'fixtureFlag', type: 'boolean', default: false, scope: 'device', group: 'fixture', labelKey: 'f.flag', label: 'Flag' }],
      },
    ],
    i18nNamespace: 'fixture',
  },
};

describe('host-ui manifest', () => {
  it('validates', () => {
    expect(validateBuiltinManifest(hostUiManifest)).toEqual([]);
  });

  it('declares the host home tiles and settings tabs, in order (snapshot; the watch tile lives in the present manifest)', () => {
    const { points, host } = makeHost();
    host.add(hostUiManifest);
    host.reconcile();
    expect(points.newTabTiles.list().map((t) => [t.id, 'key' in t.title ? t.title.key : '', t.icon && 'name' in t.icon ? t.icon.name : ''])).toEqual([
      ['readBible', 'homeScreen.readBible', 'fa-book-open'],
      ['search', 'homeScreen.search', 'fa-magnifying-glass'],
    ]);
    expect(points.preferencesSections.list().map((s) => [s.id, 'key' in s.title ? s.title.key : ''])).toEqual([
      ['text-size', 'settings.tabs.textSize'],
      ['theme', 'settings.tabs.theme'],
      ['modules', 'settings.tabs.modules'],
      ['gestures', 'settings.tabs.gestures'],
      ['apps', 'settings.apps.title'],
      ['about', 'settings.tabs.about'],
    ]);
    expect(HOME_TILES.length).toBe(2);
    expect(SETTINGS_SECTIONS.length).toBe(6); // 'offline' comes from the downloads module, 'notifications' and 'audio' from their own
  });

  it('a disabled module\'s tiles, sections, status items and settings disappear', () => {
    const on = makeHost();
    on.host.add(hostUiManifest);
    on.host.add(fixture);
    on.host.reconcile();
    expect(on.points.newTabTiles.has('fixtureTile')).toBe(true);
    expect(on.points.preferencesSections.has('fixture')).toBe(true);
    expect(on.points.statusBarItems.has('fixtureStatus')).toBe(true);
    expect(on.points.i18nNamespace.has('fixture')).toBe(true);

    const off = makeHost({ fixture: false });
    off.host.add(hostUiManifest);
    off.host.add(fixture);
    off.host.reconcile();
    expect(off.points.newTabTiles.has('fixtureTile')).toBe(false);
    expect(off.points.preferencesSections.has('fixture')).toBe(false);
    expect(off.points.statusBarItems.list()).toEqual([]);
    expect(off.points.newTabTiles.has('readBible')).toBe(true);
  });
});

describe('useStatusBarItems', () => {
  it('returns contributed items filtered by alignment and updates on change', () => {
    const { points, host } = makeHost();
    host.add(fixture);
    const { result } = renderHook(() => useStatusBarItems('right', points.statusBarItems));
    expect(result.current).toEqual([]);
    host.reconcile();
    // renderHook re-renders on the store change.
    return Promise.resolve().then(() => {
      const { result: after } = renderHook(() => useStatusBarItems('right', points.statusBarItems));
      expect(after.current.map((i) => i.id)).toEqual(['fixtureStatus']);
      const { result: left } = renderHook(() => useStatusBarItems('left', points.statusBarItems));
      expect(left.current).toEqual([]);
    });
  });
});

describe('contributedSettings', () => {
  it('merges contributed defs on top of the web registry and caches per snapshot', () => {
    const { points, host } = makeHost();
    expect(contributedSettings(points.settings).has('fixtureFlag')).toBe(false);
    host.add(fixture);
    host.reconcile();
    const merged = contributedSettings(points.settings);
    expect(merged.has('fixtureFlag')).toBe(true);
    expect(merged.has('swipeChaptersEnabled')).toBe(true);
    expect(contributedSettings(points.settings)).toBe(merged);
    expect(contributedSettings().has('fixtureFlag')).toBe(false);
  });
});

describe('startModuleNamespaceLoading', () => {
  it('loads namespaces of enabled modules once, including ones enabled later', () => {
    const { points, host } = makeHost();
    const loaded: string[] = [];
    host.add(fixture);
    const stop = startModuleNamespaceLoading(points.i18nNamespace, async (ns) => { loaded.push(ns); });
    expect(loaded).toEqual([]);
    host.reconcile();
    host.reconcile();
    expect(loaded).toEqual(['fixture']);
    stop();
  });
});
