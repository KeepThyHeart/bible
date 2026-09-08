/**
 * A book's Home page.
 *
 * Home is the table of contents plus a search box over the book's full text,
 * which is the only way to navigate a module that has no verse references -
 * rather than dropping the reader into the first section, usually a title page,
 * with the outline hidden behind a "Contents" dialog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import BookHome from './BookHome';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';
import { bookAPI } from '../../services/electronAPI';
import { enT } from '../../testing/enCatalog';

vi.mock('../../services/electronAPI', () => ({
  bookAPI: { searchSections: vi.fn() },
}));

vi.mock('../../utils/verseFormatting', () => ({
  cleanModuleName: (name: string) => name.replace(/^book_/, ''),
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

const SUMMARIES = [
  { section_id: 1, title: 'Part One', parent_section_id: undefined, section_number: '1' },
  { section_id: 2, title: 'The Slough of Despond', parent_section_id: 1, section_number: '1.1' },
  { section_id: 3, title: 'Part Two', parent_section_id: undefined, section_number: '2' },
];

function renderHome(overrides: Partial<React.ComponentProps<typeof BookHome>> = {}) {
  const props: React.ComponentProps<typeof BookHome> = {
    abbreviation: 'book_pp',
    name: "Pilgrim's Progress",
    summaries: SUMMARIES as React.ComponentProps<typeof BookHome>['summaries'],
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    onSelectSection: vi.fn(),
    ...overrides,
  };
  render(
    <ContextProvider services={createMockServices()}>
      <BookHome {...props} />
    </ContextProvider>,
  );
  return props;
}

describe('BookHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(bookAPI.searchSections).mockResolvedValue([]);
  });

  it('names the book and shows its table of contents', () => {
    renderHome();

    expect(screen.getByText("Pilgrim's Progress")).toBeInTheDocument();
    expect(screen.getByText('Part One')).toBeInTheDocument();
    expect(screen.getByText('Part Two')).toBeInTheDocument();
  });

  // Root level only: a large reference work has thousands of sections, and
  // expanding all of them turns the outline the reader came for into a wall.
  it('starts with the tree collapsed to its root level', () => {
    renderHome();

    expect(screen.queryByText('The Slough of Despond')).not.toBeInTheDocument();
  });

  it('expands a section when its disclosure is clicked', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole('button', { name: /Expand Part One/ }));

    expect(screen.getByText('The Slough of Despond')).toBeInTheDocument();
  });

  it('opens the section a reader picks from the tree', async () => {
    const user = userEvent.setup();
    const props = renderHome();

    await user.click(screen.getByRole('button', { name: /Part Two/ }));

    expect(props.onSelectSection).toHaveBeenCalledWith(3);
  });

  // Full-text search over `book_section_fts`. The IPC channel had been wired
  // all the way through since the books feature landed, with no caller.
  it('searches the book and lists the matching sections', async () => {
    const user = userEvent.setup();
    vi.mocked(bookAPI.searchSections).mockResolvedValue([
      { section_id: 2, title: 'The Slough of Despond', section_number: '1.1' },
    ] as Awaited<ReturnType<typeof bookAPI.searchSections>>);
    const props = renderHome();

    await user.type(screen.getByTestId('book-home-search'), 'despond');

    const hit = await screen.findByTestId('book-home-result');
    expect(hit).toHaveTextContent('The Slough of Despond');

    await user.click(hit);
    expect(props.onSelectSection).toHaveBeenCalledWith(2);
  });

  // Below two characters every query matches everything, so the search would
  // be one round trip per keystroke returning the whole book.
  it('does not search on a single character', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.type(screen.getByTestId('book-home-search'), 'd');

    await waitFor(() => expect(screen.queryByTestId('book-home-results')).not.toBeInTheDocument());
    expect(bookAPI.searchSections).not.toHaveBeenCalled();
  });

  it('says so when nothing in the book matches', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.type(screen.getByTestId('book-home-search'), 'xyzzy');

    expect(await screen.findByText('No section of this book matches that.')).toBeInTheDocument();
    // The contents stay below a miss - a failed search should still leave the
    // reader somewhere to go.
    expect(screen.getByText('Part One')).toBeInTheDocument();
  });

  // FTS5 rejects a bare operator, which is easy to type mid-word. An empty list
  // would read as "this book does not contain the word you are looking at".
  it('reports a rejected query rather than showing it as no matches', async () => {
    const user = userEvent.setup();
    vi.mocked(bookAPI.searchSections).mockRejectedValue(new Error('fts5: syntax error'));
    renderHome();

    await user.type(screen.getByTestId('book-home-search'), 'and');

    expect(await screen.findByTestId('book-home-search-error')).toHaveTextContent('fts5: syntax error');
  });

  it('opens the path down to each hit so a nested match is visible in the tree', async () => {
    const user = userEvent.setup();
    vi.mocked(bookAPI.searchSections).mockResolvedValue([
      { section_id: 2, title: 'The Slough of Despond', section_number: '1.1' },
    ] as Awaited<ReturnType<typeof bookAPI.searchSections>>);
    renderHome();

    await user.type(screen.getByTestId('book-home-search'), 'despond');
    await screen.findByTestId('book-home-result');

    // The hit's parent is expanded in the contents tree, not only listed above it.
    await waitFor(() =>
      expect(screen.getAllByText('The Slough of Despond').length).toBeGreaterThan(1));
  });

  it('clears a search back to the plain contents', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.type(screen.getByTestId('book-home-search'), 'despond');
    await user.click(await screen.findByTestId('book-home-search-clear'));

    expect(screen.queryByTestId('book-home-results')).not.toBeInTheDocument();
  });

  it('offers a retry when the contents could not be read', async () => {
    const user = userEvent.setup();
    const props = renderHome({ summaries: [], error: 'database is locked' });

    expect(screen.getByTestId('book-home-error')).toHaveTextContent('database is locked');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalled();
  });
});
