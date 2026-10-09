import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DockviewGroupPanel } from 'dockview-react';
import DockviewTabListMenu from './DockviewTabListMenu';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

const STRINGS: Record<string, string> = {
  'ui.dockviewHeaderActions.tabList': 'List all tabs',
};

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => STRINGS[key] ?? key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function fakePanel(id: string, title: string) {
  return { id, title, params: {}, api: { setActive: vi.fn() } };
}

describe('DockviewTabListMenu', () => {
  it('lists every tab, marks the active one, and switches on click', async () => {
    const user = userEvent.setup();
    const panels = [fakePanel('p1', 'John 3'), fakePanel('p2', 'Clarke'), fakePanel('p3', 'Easton')];
    const group = { id: 'g1', panels, activePanel: panels[1] } as unknown as DockviewGroupPanel;

    render(
      <ContextProvider services={createMockServices()}>
        <DockviewTabListMenu group={group} />
      </ContextProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'List all tabs' }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map(i => i.textContent)).toEqual(['John 3', 'Clarke', 'Easton']);
    expect(items[1]).toHaveAttribute('aria-checked', 'true');
    expect(items[1]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(items[2]).toHaveFocus();

    await user.click(items[2]);
    expect(panels[2].api.setActive).toHaveBeenCalled();
    expect(screen.queryByTestId('tab-list-menu')).toBeNull();
  });
});
