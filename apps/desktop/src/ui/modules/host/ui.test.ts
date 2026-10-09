import { describe, expect, it, vi } from 'vitest';
import {
  createFeatureModuleHost,
  createStandardPoints,
  standardPointList,
  validateBuiltinManifest,
} from '@bible/core/browser';
import type { FeatureModuleManifest } from '@bible/core/browser';
import { HOST_NEW_TAB_TILES, HOST_PREFERENCES_SECTIONS, hostUiBinding, hostUiManifest } from './ui';
import { bindModuleNamespaces } from './i18nNamespaces';
import { genealogyManifest } from '../genealogy/manifest';
import { timelineManifest } from '../timeline/manifest';

/**
 * The pre-0113 hard-coded tile list and keyword map of NewTabPage (snapshot). The genealogy and
 * timeline tiles now come from their own modules, so the whole list is the three manifests together.
 */
const OLD_TILES = ['bible', 'notes', 'prayer', 'book', 'study', 'commentary', 'dictionary', 'topics', 'genealogy', 'timeline', 'reading-plans', 'quiz'];
const OLD_TILE_KEYS: Record<string, string> = {
  'newTabPage.type.bible': 'bible', 'newTabPage.type.notes': 'notes', 'newTabPage.type.prayer': 'prayer',
  'newTabPage.type.book': 'book', 'newTabPage.type.study': 'study', 'newTabPage.type.commentary': 'commentary',
  'newTabPage.type.dictionary': 'dictionary', 'newTabPage.type.topics': 'topics', 'newTabPage.type.genealogy': 'genealogy',
  'newTabPage.type.timeline': 'timeline', 'newTabPage.type.readingPlans': 'reading-plans', 'newTabPage.type.quiz': 'quiz',
};
const OLD_KEYWORDS: Record<string, string> = {
  bible: 'bible', commentary: 'commentary', comm: 'commentary', books: 'book', book: 'book', dictionary: 'dictionary',
  dict: 'dictionary', notes: 'notes', note: 'notes', prayer: 'prayer', study: 'study', topics: 'topics', topic: 'topics',
  genealogy: 'genealogy', family: 'genealogy', timeline: 'timeline', plans: 'reading-plans', plan: 'reading-plans',
  reading: 'reading-plans', quiz: 'quiz',
};
/** Tiles that moved into their feature module's own manifest (their tests live with the module). */
const MIGRATED_TILES = ['quiz', 'reading-plans'];
const HOST_TILES = OLD_TILES.filter((t) => !MIGRATED_TILES.includes(t));
const without = (map: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(map).filter(([, v]) => !MIGRATED_TILES.includes(v)));
const OLD_SECTIONS = ['general', 'typography', 'fonts', 'themes', 'privacy', 'notifications', 'downloads', 'extensions', 'apps', 'measures', 'advanced', 'diagnostics'];

function host(manifests: FeatureModuleManifest[]) {
  const points = createStandardPoints();
  const h = createFeatureModuleHost({ platform: 'desktop', points: standardPointList(points), isFlagEnabled: () => true });
  for (const m of manifests) h.add(m, m.id === 'host-ui' ? hostUiBinding : undefined);
  h.reconcile();
  return { points, h };
}

describe('host-ui manifest', () => {
  it('validates', () => {
    expect(validateBuiltinManifest(hostUiManifest)).toEqual([]);
  });

  it('registers tiles in the old order with the old keywords and titles', () => {
    const { points } = host([hostUiManifest, genealogyManifest, timelineManifest]);
    const tiles = points.newTabTiles.list();
    expect(tiles.map((t) => ('panelType' in t.target ? t.target.panelType : ''))).toEqual(HOST_TILES);
    expect(tiles.map((t) => ('key' in t.title ? OLD_TILE_KEYS[t.title.key] : ''))).toEqual(HOST_TILES);
    const map: Record<string, string> = {};
    for (const t of tiles) for (const k of t.keywords ?? []) map[k] = (t.target as { panelType: string }).panelType;
    expect(map).toEqual(without(OLD_KEYWORDS));
    expect(HOST_NEW_TAB_TILES).toHaveLength(HOST_TILES.length - 2); // genealogy and timeline tiles come from their own modules
  });

  it('registers preferences sections in the old order, each with a lazy view', () => {
    const { points } = host([hostUiManifest]);
    expect(points.preferencesSections.list().map((s) => s.id)).toEqual(OLD_SECTIONS);
    for (const s of HOST_PREFERENCES_SECTIONS) {
      expect(points.views.resolve(`preferences:${s.id}`)).toBeTypeOf('function');
    }
  });
});

describe('a disabled module contributes nothing', () => {
  const fixture = (_flagOn: boolean): FeatureModuleManifest => ({
    id: 'fixture',
    platforms: ['desktop'],
    contributes: {
      newTabTiles: [{ id: 'fx', title: { key: 'fx.t', fallback: 'Fx' }, target: { commandId: 'fx.open' } }],
      preferencesSections: [{ id: 'fx', title: { key: 'fx.p', fallback: 'Fx' }, settingsGroup: 'fx' }],
      statusBarItems: [{ id: 'fx', title: { key: 'fx.s', fallback: 'Fx' }, alignment: 'right' }],
      i18nNamespace: 'fx',
    },
  });

  it('is present when enabled and gone when disabled by override', () => {
    const points = createStandardPoints();
    let off = false;
    const h = createFeatureModuleHost({
      platform: 'desktop',
      points: standardPointList(points),
      isFlagEnabled: () => true,
      overrides: (): Record<string, boolean> => (off ? { fixture: false } : {}),
    });
    h.add(fixture(true));
    h.reconcile();
    expect(points.newTabTiles.has('fx')).toBe(true);
    expect(points.preferencesSections.has('fx')).toBe(true);
    expect(points.statusBarItems.has('fx')).toBe(true);
    expect(points.i18nNamespace.has('fx')).toBe(true);
    off = true;
    h.reconcile();
    expect(points.newTabTiles.has('fx')).toBe(false);
    expect(points.preferencesSections.has('fx')).toBe(false);
    expect(points.statusBarItems.has('fx')).toBe(false);
    expect(points.i18nNamespace.has('fx')).toBe(false);
  });

  it('bindModuleNamespaces registers each declared namespace once', () => {
    const points = createStandardPoints();
    const h = createFeatureModuleHost({ platform: 'desktop', points: standardPointList(points), isFlagEnabled: () => true });
    const loader = { registerLazyNamespace: vi.fn() };
    bindModuleNamespaces(points.i18nNamespace, loader);
    h.add(fixture(true));
    h.reconcile();
    h.reconcile();
    expect(loader.registerLazyNamespace).toHaveBeenCalledTimes(1);
    expect(loader.registerLazyNamespace).toHaveBeenCalledWith('fx');
  });
});
