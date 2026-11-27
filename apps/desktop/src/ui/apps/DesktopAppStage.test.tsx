import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

vi.mock('./StudyView', () => ({ StudyView: () => <div data-testid="study-view" /> }));

import { appHost, appRegistry, addAppBinding } from './appHost';
import { registerBuiltinApps } from './builtinApps';
import { DesktopAppStage } from './DesktopAppStage';
import { DesktopAppSwitch } from './DesktopAppSwitch';
import { fireEvent } from '@testing-library/react';
import * as announcer from '../services/announcer';
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
    const announceSpy = vi.spyOn(announcer, 'announce');
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
    // The announcement goes through the one app-wide announcer (B-113), not a local region.
    expect(announceSpy).toHaveBeenCalledWith(expect.stringContaining('apps.stage.announce'));

    await act(async () => { await appHost.activate('study'); });
    expect(studyWrapper.hasAttribute('hidden')).toBe(false);
    expect(fxWrapper.hasAttribute('hidden')).toBe(true);
  });

  describe('rail labels and the narrow fold', () => {
    const original = window.matchMedia;
    afterEach(() => { window.matchMedia = original; usePreferencesStore.setState({ appRailLabels: true, appSwitcher: 'auto' }); });
    const narrowWindow = (narrow: boolean) => {
      window.matchMedia = ((q: string) => ({
        matches: narrow && q.includes('599'), media: q, addEventListener: () => {}, removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
    };

    it('shows labels by pref and a right-click menu toggles it', () => {
      usePreferencesStore.setState({ appSwitcher: 'rail', appRailLabels: true });
      narrowWindow(false);
      const { container } = mount();
      expect(container.querySelector('.kth-app-rail--labels')).not.toBeNull();
      fireEvent.contextMenu(screen.getByRole('navigation'), { clientX: 10, clientY: 10 });
      const item = screen.getByRole('menuitemcheckbox');
      expect(item.getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('menuitemcheckbox', { name: 'Show labels' })).toBe(item);
      fireEvent.click(item);
      expect(usePreferencesStore.getState().appRailLabels).toBe(false);
      expect(container.querySelector('.kth-app-rail--labels')).toBeNull();
    });

    it('folds the rail into the app-switch button below 600px', () => {
      usePreferencesStore.setState({ appSwitcher: 'rail' });
      narrowWindow(true);
      render(
        <ContextProvider services={services}>
          <div className="flex"><DesktopAppSwitch /><DesktopAppStage /></div>
        </ContextProvider>,
      );
      expect(screen.queryByRole('navigation')).toBeNull();
      expect(screen.getByRole('button', { name: /apps\.switcher\.open|Switch app/ })).toBeTruthy();
    });
  });
});
