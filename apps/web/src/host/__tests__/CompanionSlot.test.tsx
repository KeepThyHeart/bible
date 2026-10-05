// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appRegistry, addAppBinding } from '../appHost';
import { CompanionSlot, resetCompanionSlotForTest } from '../CompanionSlot';

const desc = (id: string, order: number) => ({
  id, title: { key: id, fallback: id }, icon: { kind: 'builtin' as const, name: 'x' }, order,
  lifecycle: { keepAlive: 'always' as const, restore: 'default' as const },
});

const loadBusy = vi.fn(async () => ({ View: (p: { compact?: boolean }) => <div data-testid="bar" data-compact={String(!!p.compact)} /> }));
const loadAlways = vi.fn(async () => ({ View: () => <div data-testid="always" /> }));

describe('CompanionSlot', () => {
  beforeEach(() => resetCompanionSlotForTest());

  it('loads a busy companion only once busy, passes compact, unmounts when busy clears', async () => {
    appRegistry.register(desc('c-busy', 1), { kind: 'builtin', moduleId: 'c-busy' });
    addAppBinding({ id: 'c-busy', load: async () => ({ View: () => null }), companion: { when: 'busy', load: loadBusy } });
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => { render(<CompanionSlot compact />, root); });
    expect(root.querySelector('[data-testid="bar"]')).toBeNull();
    expect(loadBusy).not.toHaveBeenCalled();

    await act(async () => { appRegistry.setBusy('c-busy', true); });
    await act(async () => { await Promise.resolve(); });
    const bar = root.querySelector('[data-testid="bar"]');
    expect(bar).toBeTruthy();
    expect(bar!.getAttribute('data-compact')).toBe('true');
    expect(root.firstElementChild).toBe(bar); // a fragment: no wrapper

    await act(async () => { appRegistry.setBusy('c-busy', false); });
    expect(root.querySelector('[data-testid="bar"]')).toBeNull();
    await act(async () => { appRegistry.setBusy('c-busy', true); });
    expect(root.querySelector('[data-testid="bar"]')).toBeTruthy(); // cached, no second import
    expect(loadBusy).toHaveBeenCalledTimes(1);
    await act(async () => { appRegistry.setBusy('c-busy', false); });
  });

  it('renders an `always` companion without busy, in registry order', async () => {
    appRegistry.register(desc('c-always', 2), { kind: 'builtin', moduleId: 'c-always' });
    addAppBinding({ id: 'c-always', load: async () => ({ View: () => null }), companion: { when: 'always', load: loadAlways } });
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => { render(<CompanionSlot />, root); });
    await act(async () => { await Promise.resolve(); });
    expect(root.querySelector('[data-testid="always"]')).toBeTruthy();
  });
});
