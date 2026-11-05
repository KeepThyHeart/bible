import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TopSearchBar from './TopSearchBar';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

// The real ReferenceParser / ReferenceClassifier are used deliberately: the bug
// is about *when* the classification runs, so stubbing the classifier would
// test nothing.

const navigateToVerse = vi.fn().mockResolvedValue(undefined);
const performSearch = vi.fn().mockResolvedValue(undefined);
const performLiveSearch = vi.fn().mockResolvedValue(undefined);
const clearSearch = vi.fn();

const mockSearchState: Record<string, unknown> = {};

vi.mock('../stores/useSearchStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/useSearchStore')>('../stores/useSearchStore');
  return {
    normalizeSearchQuery: actual.normalizeSearchQuery,
    useSearchStore: Object.assign(
      (selector?: (s: Record<string, unknown>) => unknown) =>
        selector ? selector(mockSearchState) : mockSearchState,
      {
        getState: () => mockSearchState,
        setState: (patch: Record<string, unknown>) => Object.assign(mockSearchState, patch),
      },
    ),
  };
});

vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ navigateToVerseInPrimary: navigateToVerse }),
    { getState: () => ({ getPanelState: () => ({ navigationHistory: [] }) }) },
  ),
}));

vi.mock('../contexts/useCommands', () => ({
  useCommands: () => ({ query: vi.fn().mockReturnValue([]), execute: vi.fn() }),
}));

vi.mock('../contexts/useWhenContext', () => ({
  useWhenContext: () => ({ snapshot: {} }),
}));

vi.mock('./TopSearchBarDropdown', () => ({ default: () => <div data-testid="search-dropdown" /> }));
vi.mock('./LiveSearchSuggestions', () => ({ default: () => <div data-testid="live-suggestions" /> }));

function createMockServices(): AppServices {
  return {
    registry: { query: vi.fn().mockReturnValue([]), execute: vi.fn() } as unknown as AppServices['registry'],
    whenContext: { snapshot: {} } as unknown as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string) => key,
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

describe('TopSearchBar - search box feedback and focus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockSearchState)) delete mockSearchState[key];
    Object.assign(mockSearchState, {
      query: '',
      setQuery: (q: string) => { mockSearchState.query = q; },
      performSearch,
      clearSearch,
      isSearching: false,
      searchResults: [],
      error: null,
      clearError: vi.fn(),
      openAdvancedDialog: vi.fn(),
      liveSuggestions: [],
      isLiveSearching: false,
      liveSearchQuery: '',
      performLiveSearch,
    });
  });

  it('does not claim an open listbox for a "Book 99" that names no book, and says so on Enter', () => {
    const view = render(
      <ContextProvider services={createMockServices()}><TopSearchBar /></ContextProvider>,
    );
    const input = screen.getByTestId('search-input') as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Zzz 99' } });
    const rerender = () => view.rerender(
      <ContextProvider services={createMockServices()}><TopSearchBar /></ContextProvider>,
    );
    rerender();
    expect(input).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(navigateToVerse).not.toHaveBeenCalled();
    expect(mockSearchState.error).toBe('liveSearchSuggestions.noResults');
    rerender();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('says there are no commands on Enter after "/" instead of staying silent', () => {
    const view = render(
      <ContextProvider services={createMockServices()}><TopSearchBar /></ContextProvider>,
    );
    const input = screen.getByTestId('search-input') as HTMLInputElement;
    fireEvent.mouseDown(input);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '/' } });
    view.rerender(<ContextProvider services={createMockServices()}><TopSearchBar /></ContextProvider>);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSearchState.error).toBe('searchBar.commandMode.empty');
    view.rerender(<ContextProvider services={createMockServices()}><TopSearchBar /></ContextProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('searchBar.commandMode.empty');
  });

  it('returns focus to the search box when Clear search is clicked', async () => {
    mockSearchState.query = 'love';
    render(<ContextProvider services={createMockServices()}><TopSearchBar /></ContextProvider>);
    const input = screen.getByTestId('search-input');
    const clear = screen.getByRole('button', { name: 'searchBar.clearTitle' });
    clear.focus();
    fireEvent.click(clear);
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(document.activeElement).toBe(input);
  });
});
