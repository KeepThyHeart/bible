import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { appRegistry, appHost, addAppBinding } from './appHost';
import { CompanionSlot, resetCompanionLoadsForTest } from './CompanionSlot';

describe('CompanionSlot', () => {
  beforeEach(() => resetCompanionLoadsForTest());

  it('renders nothing without a companion binding', async () => {
    appRegistry.register(
      { id: 'study', title: { key: 'k', fallback: 'Study' }, icon: { kind: 'builtin', name: 'app' }, order: 0, lifecycle: { keepAlive: 'always', restore: 'reopen' } },
      { kind: 'builtin', moduleId: 'study' },
    );
    addAppBinding({ id: 'study', load: async () => ({ View: () => null }) });
    await appHost.activate('study');
    const { container } = render(<CompanionSlot />);
    expect(container.innerHTML).toBe('');
  });

  it('loads a busy-only companion only while busy, and unmounts it when busy clears', async () => {
    const load = vi.fn(async () => ({ View: () => <div data-testid="bar" /> }));
    appRegistry.register(
      { id: 'live', title: { key: 'k', fallback: 'Live' }, icon: { kind: 'builtin', name: 'app' }, order: 10, lifecycle: { keepAlive: 'always', restore: 'reopen' } },
      { kind: 'builtin', moduleId: 'live' },
    );
    addAppBinding({ id: 'live', load: async () => ({ View: () => null }), companion: { when: 'busy', load } });
    render(<CompanionSlot />);
    expect(load).not.toHaveBeenCalled();
    await act(async () => { appRegistry.setBusy('live', true); });
    expect(await screen.findByTestId('bar')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { appRegistry.setBusy('live', false); });
    expect(screen.queryByTestId('bar')).toBeNull();
  });
});
