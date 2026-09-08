import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LiveSearchSuggestions from './LiveSearchSuggestions';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import type { SearchResult } from '@bible/core';
import { useSearchStore } from '../stores/useSearchStore';
import { enT } from '../testing/enCatalog';

function createMockI18n() {
  return {
    // Substitutes `{name}` the way the real service does, so element
    // placeholders resolved through `tElements` are exercised here too.
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'liveSearchSuggestions.topResults': 'Top Results',
        'liveSearchSuggestions.emptyPrompt': 'Start typing to search',
        'liveSearchSuggestions.enterKey': 'Enter',
        'liveSearchSuggestions.hints': '{navKeys} to navigate, {enterKey} to select or search',
      };
      const message = map[key] ?? enT(key);
      if (!params) return message;
      return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
      );
    },
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  };
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: createMockI18n() as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ContextProvider services={createMockServices()}>{ui}</ContextProvider>
  );
}

describe('LiveSearchSuggestions', () => {
  const mockResult: SearchResult = {
    verseId: 43003016,
    module: 'kjv',
    reference: 'John 3:16',
    text: 'For God so loved the world',
    snippet: 'For God so loved the world',
    matches: [],
    score: 1,
    type: 'exact',
  };

  beforeEach(() => {
    useSearchStore.setState({
      semanticAvailable: false,
      isSemanticMode: false,
      toggleSemanticMode: vi.fn(),
    });
  });

  it('shows loading state', () => {
    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={[]}
        isLoading={true}
        query="God"
        selectedIndex={0}
        onSelectSuggestion={vi.fn()}
      />
    );

    expect(screen.getByText(/Searching for/i)).toBeInTheDocument();
  });

  it('shows empty prompt when no query', () => {
    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={[]}
        isLoading={false}
        query=""
        selectedIndex={0}
        onSelectSuggestion={vi.fn()}
      />
    );

    expect(
      screen.getByText(/Start typing to search/i)
    ).toBeInTheDocument();
  });

  it('shows no results message when query has no matches', () => {
    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={[]}
        isLoading={false}
        query="xyz"
        selectedIndex={0}
        onSelectSuggestion={vi.fn()}
      />
    );

    expect(screen.getByText(/No results found for "xyz"/i)).toBeInTheDocument();
  });

  it('displays suggestion results', () => {
    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={[mockResult]}
        isLoading={false}
        query="God"
        selectedIndex={0}
        onSelectSuggestion={vi.fn()}
      />
    );

    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText(/For God so loved/i)).toBeInTheDocument();
  });

  it('calls onSelectSuggestion when item is clicked', async () => {
    const user = userEvent.setup();
    const onSelectSuggestion = vi.fn();

    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={[mockResult]}
        isLoading={false}
        query="God"
        selectedIndex={0}
        onSelectSuggestion={onSelectSuggestion}
      />
    );

    const button = screen.getByText('John 3:16').closest('button');
    await user.click(button!);

    expect(onSelectSuggestion).toHaveBeenCalledWith(mockResult);
  });

  it('highlights selected suggestion', () => {
    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={[mockResult]}
        isLoading={false}
        query="God"
        selectedIndex={0}
        onSelectSuggestion={vi.fn()}
      />
    );

    const button = screen.getByText('John 3:16').closest('button');
    expect(button).toHaveClass('bg-accent-soft');
  });

  it('shows fuzzy badge for fuzzy results', () => {
    const fuzzyResult: SearchResult = {
      ...mockResult,
      type: 'fuzzy',
    };

    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={[fuzzyResult]}
        isLoading={false}
        query="God"
        selectedIndex={0}
        onSelectSuggestion={vi.fn()}
      />
    );

    expect(screen.getByText('Fuzzy')).toBeInTheDocument();
  });

  it('displays multiple suggestions', () => {
    const results: SearchResult[] = [
      mockResult,
      {
        verseId: 43003017,
        module: 'kjv',
        reference: 'John 3:17',
        text: 'That he gave his only begotten Son',
        snippet: 'That he gave his only begotten Son',
        matches: [],
        score: 1,
        type: 'exact' as const,
      },
    ];

    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={results}
        isLoading={false}
        query="God"
        selectedIndex={0}
        onSelectSuggestion={vi.fn()}
      />
    );

    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('John 3:17')).toBeInTheDocument();
  });

  it('shows semantic search toggle when available', () => {
    useSearchStore.setState({
      semanticAvailable: true,
      isSemanticMode: false,
      toggleSemanticMode: vi.fn(),
    });

    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={[mockResult]}
        isLoading={false}
        query="God"
        selectedIndex={0}
        onSelectSuggestion={vi.fn()}
      />
    );

    expect(screen.getByText(/Semantic Search/i)).toBeInTheDocument();
  });

  it('shows enter key instructions', () => {
    renderWithProviders(
      <LiveSearchSuggestions
        suggestions={[mockResult]}
        isLoading={false}
        query="God"
        selectedIndex={0}
        onSelectSuggestion={vi.fn()}
      />
    );

    expect(screen.getByText('Enter')).toBeInTheDocument();
    // The hint is one whole ICU message; the keycaps are element placeholders
    // inside it, so assert on the footer's assembled text rather than on a
    // standalone fragment node.
    const footer = screen.getByText('Enter').closest('div');
    expect(footer?.textContent).toContain('to navigate');
    expect(footer?.textContent).toContain('to select or search');
  });
});
