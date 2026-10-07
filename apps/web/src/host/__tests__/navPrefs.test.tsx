// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';

vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appRegistry } from '../appHost';
import { webSettings } from '../../stores/settingsRegistry';
import { useNavItems, useRailMode, useRailVisible } from '../navPrefs';

const desc = (id: string, order: number, extra: object = {}) => ({
  id, title: { key: id, fallback: id }, icon: { kind: 'builtin' as const, name: 'fa-x' }, order,
  lifecycle: { keepAlive: 'always' as const, restore: 'default' as const }, ...extra,
});

let wide = true;
beforeEach(() => {
  wide = true;
  window.matchMedia = ((q: string) => ({
    matches: q.includes('pointer: coarse') ? false : false, media: q,
    addEventListener() {}, removeEventListener() {},
  })) as never;
  Object.defineProperty(window, 'innerWidth', { value: wide ? 1280 : 400, configurable: true });
  webSettings.reset(['appSwitcher', 'appOrder', 'appHidden']);
});

appRegistry.register(desc('study', 0), { kind: 'builtin', moduleId: 'study' });
appRegistry.register(desc('present', 10, { when: 'server.present' }), { kind: 'builtin', moduleId: 'present' });

describe('web nav hooks', () => {
  it('lists apps by order; an unknown `when` key hides nothing', () => {
    const { result } = renderHook(() => useNavItems('rail'));
    expect(result.current.map((i) => i.id)).toEqual(['study', 'present']);
    expect(result.current.map((i) => i.shortcutSlot)).toEqual([1, 2]);
  });

  it('follows the Preferences > Apps order and hide settings (Study cannot be hidden)', () => {
    const { result } = renderHook(() => useNavItems('rail'));
    act(() => { webSettings.set('appOrder', ['present', 'study']); });
    expect(result.current.map((i) => i.id)).toEqual(['present', 'study']);
    act(() => { webSettings.set('appHidden', ['present', 'study']); });
    expect(result.current.map((i) => i.id)).toEqual(['study']);
  });

  it('rail mode: auto shows it with 2 apps, none hides it, rail forces it; never on the phone layout', () => {
    const { result } = renderHook(() => ({ mode: useRailMode(), visible: useRailVisible() }));
    expect(result.current).toEqual({ mode: 'auto', visible: true });
    act(() => { webSettings.set('appSwitcher', 'none'); });
    expect(result.current).toEqual({ mode: 'none', visible: false });
    act(() => { webSettings.set('appHidden', ['present']); webSettings.set('appSwitcher', 'auto'); });
    expect(result.current.visible).toBe(false); // one app
    act(() => { webSettings.set('appSwitcher', 'rail'); });
    expect(result.current.visible).toBe(true);
  });

  it('phone layout never shows the rail', () => {
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    const { result } = renderHook(() => useRailVisible());
    expect(result.current).toBe(false);
  });
});
