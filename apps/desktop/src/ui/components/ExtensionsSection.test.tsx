/**
 * The Installed / Browse / Catalogs sub-tabs follow the shared tablist keyboard
 * contract (arrows, Home/End, roving tabindex) like every other tablist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtensionsSection } from './ExtensionsSection';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enT } from '../testing/enCatalog';

vi.mock('./extensions/ExtensionCatalogBrowser', () => ({
  ExtensionCatalogBrowser: () => <div data-testid="catalog-browser" />,
}));
vi.mock('./extensions/ExtensionCatalogSources', () => ({
  ExtensionCatalogSources: () => <div data-testid="catalog-sources" />,
}));

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => enT(key, params),
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

describe('ExtensionsSection sub-tabs', () => {
  beforeEach(() => {
    (window as unknown as { electron: unknown }).electron = {
      extensions: {
        list: vi.fn().mockResolvedValue([]),
        blocklist: { checkInstalled: vi.fn().mockResolvedValue({}) },
        getDeveloperMode: vi.fn().mockResolvedValue(false),
      },
    };
  });

  it('moves between the tabs with the arrow keys and Home/End, with a roving tabindex', async () => {
    const user = userEvent.setup();
    render(<ContextProvider services={createMockServices()}><ExtensionsSection /></ContextProvider>);

    const installed = await screen.findByTestId('extensions-tab-installed');
    const browse = screen.getByTestId('extensions-tab-browse');
    const catalogs = screen.getByTestId('extensions-tab-catalogs');
    expect(installed).toHaveAttribute('tabindex', '0');
    expect(browse).toHaveAttribute('tabindex', '-1');

    installed.focus();
    await user.keyboard('{ArrowRight}');
    expect(browse).toHaveFocus();
    expect(browse).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('catalog-browser')).toBeInTheDocument();

    await user.keyboard('{End}');
    expect(catalogs).toHaveFocus();
    expect(screen.getByTestId('catalog-sources')).toBeInTheDocument();

    await user.keyboard('{Home}');
    expect(installed).toHaveFocus();
    expect(installed).toHaveAttribute('aria-selected', 'true');
  });
});
