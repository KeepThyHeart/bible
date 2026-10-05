import { describe, it, expect, vi } from 'vitest';
import { AppRegistry } from './AppRegistry';
import { hasMultipleApps, normalizeNavPrefs, selectNavItems } from './NavItems';
import type { AppDescriptor } from './AppDescriptor';
import { app } from '../__tests__/Apps/appTestUtils';

const builtin = (moduleId: string) => ({ kind: 'builtin' as const, moduleId });

function snapshot(...descriptors: AppDescriptor[]) {
  const registry = new AppRegistry();
  descriptors.forEach((d, i) => registry.register({ ...d, order: d.order ?? i }, builtin(d.id)));
  return registry;
}
const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('selectNavItems', () => {
  it('returns registry order with shortcut slots, badge and busy', () => {
    const r = snapshot(app('study'), app('present'), app('quiz'));
    r.setBadge('present', { kind: 'dot', tone: 'live', label: 'Live' });
    r.setBusy('quiz', true);
    const items = selectNavItems(r.state.getSnapshot().apps, { platform: 'web' });
    expect(ids(items)).toEqual(['study', 'present', 'quiz']);
    expect(items.map((i) => i.shortcutSlot)).toEqual([1, 2, 3]);
    expect(items[1].badge).toMatchObject({ kind: 'dot' });
    expect(items[2].busy).toBe(true);
    expect(items[0].busy).toBe(false);
  });

  it('assigns slots only to the first nine', () => {
    const r = snapshot(...Array.from({ length: 11 }, (_, i) => app(`a${String(i).padStart(2, '0')}`)));
    const items = selectNavItems(r.state.getSnapshot().apps, { platform: 'web' });
    expect(items.map((i) => i.shortcutSlot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, undefined, undefined]);
  });

  it('filters by platform and when', () => {
    const r = snapshot(
      app('study'),
      app('present', 'always', 'reopen', { platforms: ['desktop'] }),
      app('live', 'always', 'reopen', { when: 'server.present' }),
    );
    const apps = r.state.getSnapshot().apps;
    const evalWhen = vi.fn(() => false);
    expect(ids(selectNavItems(apps, { platform: 'web', evalWhen }))).toEqual(['study']);
    expect(evalWhen).toHaveBeenCalledTimes(1);
    expect(evalWhen).toHaveBeenCalledWith('server.present');
    expect(ids(selectNavItems(apps, { platform: 'desktop', evalWhen: () => true }))).toEqual([
      'study',
      'present',
      'live',
    ]);
    expect(ids(selectNavItems(apps, { platform: 'desktop' }))).toEqual(['study', 'present', 'live']);
  });

  it('hides pref-hidden apps but never study', () => {
    const r = snapshot(app('study'), app('present'), app('quiz'));
    const items = selectNavItems(r.state.getSnapshot().apps, {
      platform: 'web',
      prefs: { hidden: ['study', 'present'] },
    });
    expect(ids(items)).toEqual(['study', 'quiz']);
  });

  it('applies pref order first, ignores unknown ids, keeps the rest in registry order', () => {
    const r = snapshot(app('study'), app('present'), app('quiz'), app('notes'));
    const items = selectNavItems(r.state.getSnapshot().apps, {
      platform: 'web',
      prefs: { order: ['quiz', 'ghost', 'notes', 'quiz'] },
    });
    expect(ids(items)).toEqual(['quiz', 'notes', 'study', 'present']);
    expect(items.map((i) => i.shortcutSlot)).toEqual([1, 2, 3, 4]);
  });

  it('drops mobile-hidden apps only on the sheet surface', () => {
    const r = snapshot(app('study'), app('present', 'always', 'reopen', { mobile: 'hidden' }));
    const apps = r.state.getSnapshot().apps;
    expect(ids(selectNavItems(apps, { platform: 'web', surface: 'sheet' }))).toEqual(['study']);
    expect(ids(selectNavItems(apps, { platform: 'web', surface: 'rail' }))).toEqual(['study', 'present']);
  });
});

describe('hasMultipleApps / normalizeNavPrefs', () => {
  it('counts', () => {
    expect(hasMultipleApps([])).toBe(false);
    expect(hasMultipleApps([1])).toBe(false);
    expect(hasMultipleApps([1, 2])).toBe(true);
  });

  it('tolerates garbage', () => {
    expect(normalizeNavPrefs(null)).toEqual({ order: [], hidden: [] });
    expect(normalizeNavPrefs('x')).toEqual({ order: [], hidden: [] });
    expect(normalizeNavPrefs({ order: 'a', hidden: {} })).toEqual({ order: [], hidden: [] });
    expect(
      normalizeNavPrefs({ order: ['a', 1, 'a', null, 'b', ''], hidden: ['study', 'x', 'x', 5] }),
    ).toEqual({ order: ['a', 'b'], hidden: ['x'] });
  });
});
