// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d: string) => d, i18n: { language: 'en' } }),
}));
vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appRegistry } from '../appHost';
import { webSettings } from '../../stores/settingsRegistry';
import { AppSwitchSlot, aggregateBadge } from '../AppSwitchSlot';

const desc = (id: string, order: number) => ({
  id, title: { key: id, fallback: id }, icon: { kind: 'builtin' as const, name: 'fa-x' }, order,
  lifecycle: { keepAlive: 'always' as const, restore: 'default' as const },
});

describe('AppSwitchSlot', () => {
  it('is hidden while the rail shows, visible when it is off, and opens the app sheet', async () => {
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    appRegistry.register(desc('study', 0), { kind: 'builtin', moduleId: 'study' });
    appRegistry.register(desc('present', 10), { kind: 'builtin', moduleId: 'present' });
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => { render(<AppSwitchSlot />, root); });
    expect(root.querySelector('.kth-app-switch')).toBeNull(); // rail covers it

    await act(async () => { webSettings.set('appSwitcher', 'none'); });
    const btn = root.querySelector('.kth-app-switch') as HTMLButtonElement;
    expect(btn.title).toBe('Switch app');
    await act(async () => { btn.click(); });
    expect(document.querySelector('.kth-app-sheet')).toBeTruthy();
    expect(document.querySelectorAll('.kth-app-sheet__row').length).toBe(2);

    await act(async () => { webSettings.set('appHidden', ['present']); });
    expect(root.querySelector('.kth-app-switch')).toBeNull(); // nothing to switch to
    webSettings.reset(['appSwitcher', 'appHidden']);
  });

  it('aggregates the most urgent badge of the other apps', () => {
    const live = { kind: 'dot' as const, tone: 'live' as const, label: 'Live' };
    const attn = { kind: 'dot' as const, tone: 'attention' as const, label: 'Due' };
    expect(aggregateBadge([{ id: 'a', badge: live }, { id: 'b', badge: attn }], null)).toBe(attn);
    expect(aggregateBadge([{ id: 'a', badge: live }], 'a')).toBeUndefined();
    expect(aggregateBadge([{ id: 'a' }], null)).toBeUndefined();
  });
});
