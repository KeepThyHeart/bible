import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TopSearchBarDropdown from './TopSearchBarDropdown';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enT } from '../testing/enCatalog';

function services(): AppServices {
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

describe('TopSearchBarDropdown command mode with no commands', () => {
  it('shows the empty hint as a status message', () => {
    render(
      <ContextProvider services={services()}>
        <TopSearchBarDropdown mode="command" commands={[]} selectedIndex={0} />
      </ContextProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No matching commands');
  });
});
