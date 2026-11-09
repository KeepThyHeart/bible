import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchTypeSelector from './SearchTypeSelector';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { useSearchStore } from '../stores/useSearchStore';
import { enT } from '../testing/enCatalog';

const services = {
  registry: {} as AppServices['registry'],
  whenContext: {} as AppServices['whenContext'],
  keybindings: {} as AppServices['keybindings'],
  i18n: {
    t: (key: string) => enT(key),
    currentLocale: 'en',
    onDidChangeLocale: () => ({ dispose: () => {} }),
    resolve: (v: unknown) => String(v),
    loadCatalog: () => {},
    setLocale: () => {},
  } as unknown as AppServices['i18n'],
};

const renderSelector = () => render(<ContextProvider services={services}><SearchTypeSelector /></ContextProvider>);

describe('SearchTypeSelector', () => {
  beforeEach(() => {
    useSearchStore.setState({ semanticAvailable: true, isSemanticMode: false });
  });

  it('is a plain magnifier (no control) when Ideas search is unavailable', () => {
    useSearchStore.setState({ semanticAvailable: false });
    renderSelector();
    expect(screen.queryByTestId('search-type-button')).toBeNull();
  });

  it('the icon reflects the mode and the menu offers both options with explanations', async () => {
    const user = userEvent.setup();
    renderSelector();
    expect(screen.getByTestId('search-type-button')).toHaveAttribute('data-search-type', 'keyword');

    await user.click(screen.getByTestId('search-type-button'));
    expect(screen.getByTestId('search-type-keyword')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('search-type-ideas')).toHaveTextContent(/meaning/i);

    await user.click(screen.getByTestId('search-type-ideas'));
    expect(useSearchStore.getState().isSemanticMode).toBe(true);
    expect(screen.queryByTestId('search-type-menu')).toBeNull();
    expect(screen.getByTestId('search-type-button')).toHaveAttribute('data-search-type', 'ideas');
  });

  it('follows a mode change made elsewhere (the results-pane link)', () => {
    renderSelector();
    act(() => useSearchStore.setState({ isSemanticMode: true }));
    expect(screen.getByTestId('search-type-button')).toHaveAttribute('data-search-type', 'ideas');
  });

  it('Escape closes the menu', async () => {
    const user = userEvent.setup();
    renderSelector();
    await user.click(screen.getByTestId('search-type-button'));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('search-type-menu')).toBeNull();
  });
});
