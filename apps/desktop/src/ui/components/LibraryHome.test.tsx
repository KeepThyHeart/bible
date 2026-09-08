/**
 * Unit tests for the Books pane's Overview shelf.
 *
 * Commentary has had an Overview tab for a while; Books and Dictionaries had
 * none, so once a single module was open the only route to any other was an
 * unlabelled "+" in the tab strip.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import LibraryHome, { type LibraryModule } from './LibraryHome';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';
import { enT } from '../testing/enCatalog';

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

const BOOKS: LibraryModule[] = [
  { abbreviation: 'pilgrim', name: "Pilgrim's Progress" },
  { abbreviation: 'confessions', name: 'Confessions', version: '2.0' },
];
const DICTIONARIES: LibraryModule[] = [
  { abbreviation: 'strongsgreek', name: "Strong's Greek" },
];

function renderShelf(overrides: Partial<React.ComponentProps<typeof LibraryHome>> = {}) {
  const props: React.ComponentProps<typeof LibraryHome> = {
    kind: 'book',
    books: BOOKS,
    dictionaries: DICTIONARIES,
    openBooks: new Set<string>(),
    openDictionaries: new Set<string>(),
    onOpen: vi.fn(),
    onInstall: vi.fn(),
    ...overrides,
  };
  render(
    <ContextProvider services={createMockServices()}>
      <LibraryHome {...props} />
    </ContextProvider>,
  );
  return props;
}

describe('LibraryHome', () => {
  it('lists every installed book, and no dictionaries — a Books pane holds books', () => {
    renderShelf();

    const bookSection = screen.getByTestId('library-section-book');
    expect(within(bookSection).getByText("Pilgrim's Progress")).toBeInTheDocument();
    expect(within(bookSection).getByText('Confessions')).toBeInTheDocument();

    // Showing both kinds would let a reader who opens "Dictionary" end up
    // looking at books.
    expect(screen.queryByTestId('library-section-dictionary')).not.toBeInTheDocument();
    expect(screen.queryByText("Strong's Greek")).not.toBeInTheDocument();
  });

  it('lists dictionaries, and no books, on a Dictionary pane', () => {
    renderShelf({ kind: 'dictionary' });

    const dictSection = screen.getByTestId('library-section-dictionary');
    expect(within(dictSection).getByText("Strong's Greek")).toBeInTheDocument();
    expect(screen.queryByTestId('library-section-book')).not.toBeInTheDocument();
  });

  it('marks modules that are already open and still reports them when picked', async () => {
    const user = userEvent.setup();
    const props = renderShelf({ openBooks: new Set(['pilgrim']) });

    expect(screen.getByTestId('library-item-pilgrim')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('library-item-confessions')).toHaveAttribute('data-open', 'false');

    // Picking an already-open module must still fire: the caller switches to
    // that tab, which is the whole point of showing it here.
    await user.click(screen.getByTestId('library-item-pilgrim'));
    expect(props.onOpen).toHaveBeenCalledWith('book', 'pilgrim', "Pilgrim's Progress");
  });

  it('opens a dictionary with its own kind, not the book kind', async () => {
    const user = userEvent.setup();
    const props = renderShelf({ kind: 'dictionary' });

    await user.click(screen.getByTestId('library-item-strongsgreek'));
    expect(props.onOpen).toHaveBeenCalledWith('dictionary', 'strongsgreek', "Strong's Greek");
  });

  it('filters by name and by abbreviation', async () => {
    const user = userEvent.setup();
    renderShelf();

    await user.type(screen.getByTestId('library-filter'), 'confess');
    expect(screen.getByTestId('library-item-confessions')).toBeInTheDocument();
    expect(screen.queryByTestId('library-item-pilgrim')).not.toBeInTheDocument();

    // Abbreviation matches too - that is what the tab strip shows.
    await user.clear(screen.getByTestId('library-filter'));
    await user.type(screen.getByTestId('library-filter'), 'pilgrim');
    expect(screen.getByTestId('library-item-pilgrim')).toBeInTheDocument();
  });

  it('says "no matches" when a filter empties a shelf, rather than offering to install', async () => {
    const user = userEvent.setup();
    renderShelf();

    await user.type(screen.getByTestId('library-filter'), 'xyzzy');

    expect(screen.getByTestId('library-no-matches-book')).toBeInTheDocument();
    // Offering "Get a book" here would be wrong: books *are* installed, the
    // search box just excluded them.
    expect(screen.queryByTestId('library-install-book')).not.toBeInTheDocument();
  });

  it('offers to install when a kind is genuinely absent, and hides the filter with nothing to filter', () => {
    const props = renderShelf({ books: [], dictionaries: [] });

    expect(screen.getByTestId('library-install-book')).toBeInTheDocument();
    expect(screen.queryByTestId('library-filter')).not.toBeInTheDocument();
    expect(screen.queryByTestId('library-no-matches-book')).not.toBeInTheDocument();

    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it('shows a loading line instead of an empty shelf while modules are still being read', () => {
    renderShelf({ books: [], loadingBooks: true });

    const bookSection = screen.getByTestId('library-section-book');
    // Not the install prompt: nothing is known yet, so "no books installed"
    // would be a claim the component cannot support.
    expect(within(bookSection).queryByTestId('library-install-book')).not.toBeInTheDocument();
    expect(within(bookSection).getByText('Loading…')).toBeInTheDocument();
  });
});
