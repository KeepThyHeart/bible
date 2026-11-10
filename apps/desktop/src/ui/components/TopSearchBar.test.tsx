import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import TopSearchBar from './TopSearchBar';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

// Mock search store
const mockSearchState: Record<string, any> = {};
vi.mock('../stores/useSearchStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/useSearchStore')>('../stores/useSearchStore');
  return {
    // Real helper: the badge gate compares the box against `resultsForQuery`
    // through it, so a stub would be asserting the test's own rule.
    normalizeSearchQuery: actual.normalizeSearchQuery,
    isIdeasSelectable: actual.isIdeasSelectable,
    useSearchStore: (selector?: (s: any) => any) => selector ? selector(mockSearchState) : mockSearchState,
  };
});

// Mock bible store
vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: (selector: (s: any) => any) => selector({
    navigateToVerseInPrimary: vi.fn().mockResolvedValue(undefined),
    getPanelState: vi.fn().mockReturnValue({ navigationHistory: [] }),
  }),
}));

const mockCommandQuery = vi.hoisted(() => vi.fn().mockReturnValue([]));

// Mock command hooks
vi.mock('../contexts/useCommands', () => ({
  useCommands: () => ({ query: mockCommandQuery, execute: vi.fn() }),
}));

vi.mock('../contexts/useWhenContext', () => ({
  useWhenContext: () => ({ snapshot: {} }),
}));

// Mock ReferenceParser. The component calls these with `new`, so the
// implementations must be functions, not arrows. Everything else (including
// `getLocalizer`, which `useI18n()` now calls on every render) passes through
// to the real module.
vi.mock('@bible/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bible/core')>();
  return {
    ...actual,
    ReferenceParser: vi.fn().mockImplementation(function () {
      return {
        parse: vi.fn().mockReturnValue({ isValid: false }),
        format: vi.fn().mockReturnValue(''),
        validate: vi.fn().mockReturnValue(null),
        getBookName: vi.fn().mockReturnValue(''),
      };
    }),
  };
});

// Mock ReferenceClassifier
vi.mock('../services/ReferenceClassifier', () => ({
  ReferenceClassifier: vi.fn().mockImplementation(function () {
    return { looksLikeReference: vi.fn().mockReturnValue(false) };
  }),
}));

// Mock debounce
vi.mock('../utils/debounce', () => ({
  debounce: (fn: Function) => fn,
}));

// Mock sub-components
vi.mock('./TopSearchBarDropdown', () => ({ default: () => <div data-testid="search-dropdown" /> }));
vi.mock('./LiveSearchSuggestions', () => ({ default: () => <div data-testid="live-suggestions" /> }));

function createMockServices(): AppServices {
  return {
    registry: { query: vi.fn().mockReturnValue([]), execute: vi.fn() } as unknown as AppServices['registry'],
    whenContext: { snapshot: {} } as unknown as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: { t: (key: string) => key, currentLocale: 'en' as const, onDidChangeLocale: () => ({ dispose: vi.fn() }), resolve: (v: unknown) => String(v), loadCatalog: vi.fn(), setLocale: vi.fn() } as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const defaultSearchState = {
  query: '',
  setQuery: vi.fn(),
  performSearch: vi.fn(),
  clearSearch: vi.fn(),
  isSearching: false,
  searchResults: [],
  // The badge is gated on the results being *current*: the pane showing them,
  // and the box still holding the query they came from. See TopSearchBar.
  resultsForQuery: '',
  isResultsVisible: true,
  isSemanticMode: false,
  semanticResults: [],
  error: null,
  clearError: vi.fn(),
  openAdvancedDialog: vi.fn(),
  liveSuggestions: [],
  isLiveSearching: false,
  liveSearchQuery: '',
  performLiveSearch: vi.fn(),
};

describe('TopSearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockSearchState, { ...defaultSearchState });
  });

  it('renders the search input', () => {
    renderWithProviders(<TopSearchBar />);
    expect(screen.getByTestId('search-input')).toBeInTheDocument();
  });

  it('renders the Search/Ideas menu outside the icon wrapper, above the popups under the box', async () => {
    mockSearchState.semanticAvailable = true;
    mockSearchState.query = 'love one another';
    const user = userEvent.setup();
    renderWithProviders(<TopSearchBar />);
    await user.click(screen.getByTestId('search-input'));
    expect(screen.getByTestId('live-suggestions')).toBeInTheDocument();

    // The icon wrapper is transformed (-translate-y-1/2), so it is a stacking context: a menu inside it can
    // never paint above the later z-50 suggestion popup, whatever its own z-index. So the menu is portalled.
    const button = screen.getByTestId('search-type-button');
    const wrapper = button.parentElement!;
    expect(wrapper.className).toContain('-translate-y-1/2');
    await user.click(button);
    const menu = screen.getByTestId('search-type-menu');
    expect(wrapper.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(menu.style.position).toBe('fixed');
    // ...and while it is open the popup under the box is not shown at all.
    expect(screen.queryByTestId('live-suggestions')).toBeNull();
    expect(screen.getByTestId('search-input')).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('search-type-menu')).toBeNull();
    expect(screen.getByTestId('search-type-button')).toHaveFocus();
  });

  it('shows placeholder text', () => {
    renderWithProviders(<TopSearchBar />);
    expect(screen.getByPlaceholderText('searchBar.unifiedPlaceholder')).toBeInTheDocument();
  });

  it('is a combobox whose listbox state follows the dropdown (B-043)', async () => {
    const services = createMockServices();
    mockCommandQuery.mockReturnValue([{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }]);
    Object.assign(mockSearchState, { ...defaultSearchState, query: '/' });
    const user = userEvent.setup();
    render(<ContextProvider services={services}><TopSearchBar /></ContextProvider>);
    const input = screen.getByTestId('search-input');
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).toHaveAttribute('aria-controls', 'search-listbox');
    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/^search-option-\d+$/);
    mockCommandQuery.mockReturnValue([]);
  });

  it('Escape hands focus back to where it came from instead of dropping to body (B-047)', async () => {
    const user = userEvent.setup();
    render(
      <ContextProvider services={createMockServices()}>
        <button data-testid="opener">Opener</button>
        <TopSearchBar />
      </ContextProvider>,
    );
    const opener = screen.getByTestId('opener');
    opener.focus();
    await user.click(screen.getByTestId('search-input'));
    expect(screen.getByTestId('search-input')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });

  it('shows advanced search button', () => {
    renderWithProviders(<TopSearchBar />);
    expect(screen.getByTestId('search-options-button')).toBeInTheDocument();
  });

  it('calls openAdvancedDialog when options button is clicked', async () => {
    const mockOpenAdvanced = vi.fn();
    Object.assign(mockSearchState, { ...defaultSearchState, openAdvancedDialog: mockOpenAdvanced });
    const user = userEvent.setup();
    renderWithProviders(<TopSearchBar />);
    await user.click(screen.getByTestId('search-options-button'));
    expect(mockOpenAdvanced).toHaveBeenCalled();
  });

  // The input must not be `disabled` while a search runs. A disabled input is
  // blurred by the browser and swallows keystrokes, so a search the user did
  // not mean to start (see TopSearchBar.referenceRace.test.tsx) would also cost
  // them their place and the characters they typed next. It is marked busy
  // instead.
  it('keeps the input editable while searching, and marks it busy', () => {
    Object.assign(mockSearchState, { ...defaultSearchState, isSearching: true });
    renderWithProviders(<TopSearchBar />);
    const input = screen.getByTestId('search-input');
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute('aria-busy', 'true');
  });

  it('shows result count badge when results exist', () => {
    Object.assign(mockSearchState, {
      ...defaultSearchState,
      searchResults: [{ verseId: 1 }, { verseId: 2 }],
    });
    renderWithProviders(<TopSearchBar />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  // The three ways a result count stops being true. Leaving the badge on
  // screen in any of them would advertise a search the user can no longer see.
  describe('result count badge honesty', () => {
    it('hides the badge once the results pane is closed', () => {
      Object.assign(mockSearchState, {
        ...defaultSearchState,
        query: 'grace',
        resultsForQuery: 'grace',
        searchResults: [{ verseId: 1 }, { verseId: 2 }],
        isResultsVisible: false,
      });
      renderWithProviders(<TopSearchBar />);
      expect(screen.queryByTestId('search-result-count-badge')).not.toBeInTheDocument();
    });

    it('hides the badge once the search text no longer matches the results', () => {
      Object.assign(mockSearchState, {
        ...defaultSearchState,
        query: 'gracef',
        resultsForQuery: 'grace',
        searchResults: [{ verseId: 1 }, { verseId: 2 }],
      });
      renderWithProviders(<TopSearchBar />);
      expect(screen.queryByTestId('search-result-count-badge')).not.toBeInTheDocument();
    });

    // The `?` prefix is stripped before searching, so "?grace" and "grace" are
    // the same query and must not read as an edit.
    it('keeps the badge when only the explicit search prefix differs', () => {
      Object.assign(mockSearchState, {
        ...defaultSearchState,
        query: '?grace ',
        resultsForQuery: 'grace',
        searchResults: [{ verseId: 1 }, { verseId: 2 }],
      });
      renderWithProviders(<TopSearchBar />);
      expect(screen.getByTestId('search-result-count-badge')).toHaveTextContent('2');
      // B-109: the badge, clear button and options need room, or they sit on top of the first typed letters.
      expect(screen.getByTestId('search-input').className).toContain('pe-36');
    });

    it('B-045: idle box reserves room for the Ctrl+L chip plus the options button (7rem)', () => {
      renderWithProviders(<TopSearchBar />);
      expect(screen.getByTestId('search-input').className).toContain('pe-28');
    });

    // The pane counts semantic hits in semantic mode; the badge above it must
    // count the same thing rather than the keyword set left underneath.
    it('counts semantic results while in semantic mode', () => {
      Object.assign(mockSearchState, {
        ...defaultSearchState,
        query: 'grace',
        resultsForQuery: 'grace',
        searchResults: [],
        isSemanticMode: true,
        semanticResults: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      });
      renderWithProviders(<TopSearchBar />);
      expect(screen.getByTestId('search-result-count-badge')).toHaveTextContent('3');
    });
  });

  it('shows error message when error is set', () => {
    Object.assign(mockSearchState, { ...defaultSearchState, error: 'Search failed' });
    renderWithProviders(<TopSearchBar />);
    expect(screen.getByText('Search failed')).toBeInTheDocument();
  });

  it('calls setQuery on input change', async () => {
    const mockSetQuery = vi.fn();
    Object.assign(mockSearchState, { ...defaultSearchState, setQuery: mockSetQuery });
    const user = userEvent.setup();
    renderWithProviders(<TopSearchBar />);
    await user.type(screen.getByTestId('search-input'), 'test');
    expect(mockSetQuery).toHaveBeenCalled();
  });

  it('shows clear button when query is non-empty', () => {
    Object.assign(mockSearchState, { ...defaultSearchState, query: 'hello' });
    renderWithProviders(<TopSearchBar />);
    expect(screen.getByTitle('searchBar.clearTitle')).toBeInTheDocument();
  });

  it('does not show clear button when query is empty', () => {
    renderWithProviders(<TopSearchBar />);
    expect(screen.queryByTitle('searchBar.clearTitle')).not.toBeInTheDocument();
  });

  it('disables advanced search button when searching', () => {
    Object.assign(mockSearchState, { ...defaultSearchState, isSearching: true });
    renderWithProviders(<TopSearchBar />);
    expect(screen.getByTestId('search-options-button')).toBeDisabled();
  });
});
