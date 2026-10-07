import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

vi.mock('./StudyView', () => ({ StudyView: () => <div data-testid="study-view" /> }));

import { appHost, appRegistry, addAppBinding } from './appHost';
import { registerBuiltinApps } from './builtinApps';
import { DesktopAppStage } from './DesktopAppStage';
import { usePreferencesStore } from '../stores/usePreferencesStore';

const services = {
  registry: {} as AppServices['registry'],
  whenContext: { evaluate: () => true } as unknown as AppServices['whenContext'],
  keybindings: {} as AppServices['keybindings'],
  i18n: {
    t: (key: string) => `[${key}]`,
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  } as unknown as AppServices['i18n'],
};

function mount() {
  return render(
    <ContextProvider services={services}>
      <div className="flex"><DesktopAppStage /></div>
    </ContextProvider>,
  );
}

describe('DesktopAppStage', () => {
  beforeAll(async () => {
    registerBuiltinApps();
    await appHost.activate('study', { source: 'boot' });
  });

  it('shows no rail with one app on auto, and the rail with pref "rail"; Study is not remounted', () => {
    usePreferencesStore.setState({ appSwitcher: 'auto', appOrder: [], appHidden: [] });
    mount();
    const study = screen.getByTestId('study-view');
    expect(screen.queryByRole('navigation')).toBeNull();

    act(() => usePreferencesStore.setState({ appSwitcher: 'rail' }));
    expect(screen.getByRole('navigation')).toBeTruthy();
    expect(screen.getByTestId('study-view')).toBe(study); // same DOM node

    act(() => usePreferencesStore.setState({ appSwitcher: 'none' }));
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getByTestId('study-view')).toBe(study);
    act(() => usePreferencesStore.setState({ appSwitcher: 'auto' }));
  });

  it('hides, insulates and aria-hides the inactive app while keeping it mounted', async () => {
    appRegistry.register(
      { id: 'fx', title: { key: 'fx', fallback: 'Fixture' }, icon: { kind: 'builtin', name: 'app' }, order: 20, lifecycle: { keepAlive: 'always', restore: 'reopen' } },
      { kind: 'builtin', moduleId: 'fx' },
    );
    addAppBinding({ id: 'fx', load: async () => ({ View: () => <h1 tabIndex={-1}>Fixture app</h1> }) });
    const { container } = mount();
    const study = screen.getByTestId('study-view');
    // With two apps the rail shows on "auto".
    expect(screen.getByRole('navigation')).toBeTruthy();

    await act(async () => { await appHost.activate('fx'); });
    const studyWrapper = container.querySelector('[data-app="study"]')!;
    const fxWrapper = container.querySelector('[data-app="fx"]')!;
    expect(studyWrapper.hasAttribute('hidden')).toBe(true);
    expect(studyWrapper.hasAttribute('inert')).toBe(true);
    expect(studyWrapper.getAttribute('aria-hidden')).toBe('true');
    expect(fxWrapper.hasAttribute('hidden')).toBe(false);
    expect(screen.getByTestId('study-view')).toBe(study); // still mounted, same node
    expect(screen.getByRole('status').textContent).toContain('apps.stage.announce');

    await act(async () => { await appHost.activate('study'); });
    expect(studyWrapper.hasAttribute('hidden')).toBe(false);
    expect(fxWrapper.hasAttribute('hidden')).toBe(true);
  });
});
