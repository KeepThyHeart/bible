import { registerHostUiForTests } from '../modules/host/registerHostUiForTests';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import NewTabPage from './NewTabPage';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { appRegistry } from '../apps/appHost';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { enT } from '../testing/enCatalog';
import { featureModules, reconcileModules } from '../modules/moduleHost';

vi.mock('dockview-react', () => ({}));

const services = {
  registry: {} as AppServices['registry'],
  whenContext: {} as AppServices['whenContext'],
  keybindings: {} as AppServices['keybindings'],
  i18n: {
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    currentLocale: 'en' as const,
    currentDirection: 'ltr' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  } as unknown as AppServices['i18n'],
};

const desc = (id: string, order: number) => ({
  id, title: { key: `apps.${id}.title`, fallback: id === 'study' ? 'Study' : 'Fixture' }, icon: { kind: 'builtin' as const, name: 'app' },
  order, lifecycle: { keepAlive: 'always' as const, restore: 'reopen' as const },
});

beforeAll(() => registerHostUiForTests());

describe('NewTabPage apps row', () => {
  beforeEach(() => {
    for (const d of [...appRegistry.list()]) appRegistry.unregister(d.id);
    usePreferencesStore.setState({ appOrder: [], appHidden: [] });
  });

  it('shows no apps section with a single app', () => {
    appRegistry.register(desc('study', 0), { kind: 'builtin', moduleId: 'study' });
    render(<ContextProvider services={services}><NewTabPage panelId="p" /></ContextProvider>);
    expect(screen.queryByRole('list', { name: 'Apps' })).toBeNull();
  });

  it('shows the apps tile row below the pane tiles once there are two apps', () => {
    appRegistry.register(desc('study', 0), { kind: 'builtin', moduleId: 'study' });
    render(<ContextProvider services={services}><NewTabPage panelId="p" /></ContextProvider>);
    act(() => { appRegistry.register(desc('fx', 20), { kind: 'builtin', moduleId: 'fx' }); });
    const grid = screen.getByRole('list', { name: 'Apps' });
    expect(grid.querySelectorAll('button')).toHaveLength(2);
    const paneTile = screen.getByRole('button', { name: 'Bible' });
    expect(grid.compareDocumentPosition(paneTile) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  describe('tiles that only switch to an app', () => {
    beforeAll(() => {
      featureModules.add(
        {
          id: 'app-tile-fixture',
          platforms: ['desktop'],
          contributes: {
            newTabTiles: [
              { id: 'dup-app', title: { key: 'x.dup', fallback: 'DupApp' }, order: 90, target: { appId: 'study' } },
              { id: 'extra-app', title: { key: 'x.extra', fallback: 'ExtraApp' }, order: 91, target: { appId: 'extra' } },
            ],
          },
        } as never,
        { id: 'app-tile-fixture' } as never,
      );
      reconcileModules();
    });

    it('lists them under Apps, not among the tab tiles, and drops duplicates of an existing app entry', () => {
      appRegistry.register(desc('study', 0), { kind: 'builtin', moduleId: 'study' });
      render(<ContextProvider services={services}><NewTabPage panelId="p" /></ContextProvider>);
      const grid = screen.getByRole('list', { name: 'Apps' });
      // One app plus the extra app-only tile: the section shows although only one real app exists.
      expect(grid.textContent).toContain('ExtraApp');
      expect(grid.textContent).not.toContain('DupApp');
      // Not rendered among the tab tiles either.
      expect(screen.queryByRole('button', { name: 'DupApp' })).toBeNull();
      expect(screen.getAllByRole('button', { name: 'ExtraApp' })).toHaveLength(1);
    });
  });
});
