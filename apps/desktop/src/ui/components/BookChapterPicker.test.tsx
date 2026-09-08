import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { SearchResult } from '@bible/core/types/search';

// The search store is mocked wholesale: BookChapterPicker only reads its
// state and calls its exported `performSearch` action (never mutates it
// directly), so the real implementation - which hits IPC - is irrelevant
// here and would need far more scaffolding to exercise safely.
const { getSearchState, setSearchState, mockPerformSearch } = vi.hoisted(() => {
  let state = {
    searchResults: [] as SearchResult[],
    isSearching: false,
    resultsForQuery: '',
  };
  return {
    getSearchState: () => state,
    setSearchState: (patch: Partial<typeof state>) => {
      state = { ...state, ...patch };
    },
    mockPerformSearch: vi.fn(),
  };
});

vi.mock('../stores/useSearchStore', () => ({
  useSearchStore: Object.assign(
    (selector: (s: ReturnType<typeof getSearchState>) => unknown) => selector(getSearchState()),
    { getState: () => ({ ...getSearchState(), performSearch: mockPerformSearch }) },
  ),
}));

import BookChapterPicker from './BookChapterPicker';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enString, enT } from '../testing/enCatalog';

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

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

describe('BookChapterPicker', () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setSearchState({ searchResults: [], isSearching: false, resultsForQuery: '' });
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = renderWithProviders(
      <BookChapterPicker isOpen={false} onClose={onClose} onSelect={onSelect} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders book list when open', () => {
    renderWithProviders(
      <BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />,
    );
    expect(screen.getByText('Genesis')).toBeInTheDocument();
    expect(screen.getByText('Matthew')).toBeInTheDocument();
  });

  it('shows OT and NT section headers', () => {
    renderWithProviders(
      <BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />,
    );
    expect(screen.getByText(enString('bookChapterPicker.oldTestament'))).toBeInTheDocument();
    expect(screen.getByText(enString('bookChapterPicker.newTestament'))).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', async () => {
    userEvent.setup();
    renderWithProviders(
      <BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />,
    );
    const backdrop = screen.getByText(enString('bookChapterPicker.goToPassage')).closest('.fixed');
    if (backdrop) {
      fireEvent.click(backdrop);
    }
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates to chapter view when book with multiple chapters is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />,
    );
    const genesisButton = screen.getByRole('button', { name: 'Genesis' });
    await user.click(genesisButton);
    // Should show chapter grid
    expect(screen.getByText(enString('bookChapterPicker.selectChapter'))).toBeInTheDocument();
  });

  it('calls onSelect immediately for single-chapter books (Obadiah)', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />,
    );
    const obadiah = screen.getByRole('button', { name: 'Obadiah' });
    await user.click(obadiah);
    expect(onSelect).toHaveBeenCalledWith(31, 1);
  });

  it('filters books when typing in the reference input', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />,
    );
    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'john');
    expect(screen.getByRole('button', { name: 'John' })).toBeInTheDocument();
    // Genesis should not show since it doesn't match "john"
    expect(screen.queryByRole('button', { name: 'Genesis' })).not.toBeInTheDocument();
  });

  it('navigates directly when a full reference is submitted', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />,
    );
    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'John 3:16');
    await user.click(screen.getByText('Go'));
    expect(onSelect).toHaveBeenCalledWith(43, 3, 16);
  });

  it('closes on Escape key press', () => {
    renderWithProviders(
      <BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('BookChapterPicker: section color coding', () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tints Genesis (Pentateuch) with the warning token', () => {
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);
    const genesis = screen.getByRole('button', { name: 'Genesis' });
    expect(genesis.style.backgroundColor).toContain('--theme-warning-rgb');
  });

  it('tints Isaiah (Major Prophets) with a different token than Genesis', () => {
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);
    const isaiah = screen.getByRole('button', { name: 'Isaiah' });
    expect(isaiah.style.backgroundColor).toContain('--theme-highlight-purple-rgb');
  });

  it('tints John (Gospels) with the success token', () => {
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);
    const john = screen.getByRole('button', { name: 'John' });
    expect(john.style.backgroundColor).toContain('--theme-success-rgb');
  });

  it('does not apply a section tint to the current book — the accent highlight takes precedence', () => {
    renderWithProviders(
      <BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} currentBook={1} currentChapter={1} />,
    );
    const genesis = screen.getByRole('button', { name: 'Genesis' });
    expect(genesis.style.backgroundColor).toBe('');
  });
});

describe('BookChapterPicker: search fallback', () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setSearchState({ searchResults: [], isSearching: false, resultsForQuery: '' });
  });

  it('offers a search link once non-reference text is typed, and not before', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);

    expect(screen.queryByRole('button', { name: /search for/i })).not.toBeInTheDocument();
    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'love');
    expect(screen.getByRole('button', { name: 'Search for "love"' })).toBeInTheDocument();
  });

  it('does not offer a search link while a digit is present (still looks like a reference)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'John 3');
    expect(screen.queryByRole('button', { name: /search for/i })).not.toBeInTheDocument();
  });

  it('runs the search and hides the book list once the offer link is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'love');
    await user.click(screen.getByRole('button', { name: 'Search for "love"' }));

    expect(mockPerformSearch).toHaveBeenCalledWith('love');
    expect(screen.queryByRole('button', { name: 'Genesis' })).not.toBeInTheDocument();
  });

  it('falls back to a search on Go/Enter when the text is not a recognized reference (no more silent no-op)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'shepherd psalm{Enter}');

    expect(mockPerformSearch).toHaveBeenCalledWith('shepherd psalm');
  });

  it('shows a loading state while the search is in flight', async () => {
    const user = userEvent.setup();
    mockPerformSearch.mockImplementation((query: string) => {
      setSearchState({ isSearching: true, resultsForQuery: '' });
      void query;
    });
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'love{Enter}');

    // The mock i18n echoes keys, so `tf()` falls back to its English source text.
    expect(screen.getByText('Searching...')).toBeInTheDocument();
  });

  it('shows a no-results state when the search resolves empty', async () => {
    const user = userEvent.setup();
    mockPerformSearch.mockImplementation((query: string) => {
      setSearchState({ isSearching: false, resultsForQuery: query, searchResults: [] });
    });
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'zzznotaword{Enter}');

    expect(screen.getByText('No results found.')).toBeInTheDocument();
  });

  it('streams results in and lets the user pick one without leaving the dialog', async () => {
    const user = userEvent.setup();
    const result: SearchResult = {
      verseId: 43003016,
      module: 'kjv',
      reference: 'John 3:16',
      text: 'For God so loved the world...',
      snippet: 'For God so <mark>loved</mark> the world...',
      matches: [],
      score: 1,
      type: 'exact',
    };
    mockPerformSearch.mockImplementation((query: string) => {
      setSearchState({ isSearching: false, resultsForQuery: query, searchResults: [result] });
    });
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'love{Enter}');

    const resultButton = screen.getByRole('listitem');
    expect(resultButton).toHaveTextContent('John 3:16');
    await user.click(resultButton);

    expect(onSelect).toHaveBeenCalledWith(43, 3, 16);
  });

  it('clears search mode when the input is edited again', async () => {
    const user = userEvent.setup();
    mockPerformSearch.mockImplementation((query: string) => {
      setSearchState({ isSearching: false, resultsForQuery: query, searchResults: [] });
    });
    renderWithProviders(<BookChapterPicker isOpen={true} onClose={onClose} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(enString('bookChapterPicker.referencePlaceholder'));
    await user.type(input, 'love{Enter}');
    expect(screen.getByText('No results found.')).toBeInTheDocument();

    await user.clear(input);
    expect(screen.queryByText('No results found.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Genesis' })).toBeInTheDocument();
  });
});
