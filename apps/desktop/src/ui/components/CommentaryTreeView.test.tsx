import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import CommentaryTreeView from './CommentaryTreeView';
import type { CommentaryEntrySummary } from '../stores/useCommentaryStore';
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

const mockSummaries: CommentaryEntrySummary[] = [
  { verse_id_start: 43003016, entry_level: 'verse', word_count: 120 },
  { verse_id_start: 43003017, entry_level: 'verse', word_count: 85 },
  { verse_id_start: 1001001, entry_level: 'verse', word_count: 200 },
];

describe('CommentaryTreeView', () => {
  const onSelectVerse = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading with abbreviation', () => {
    renderWithProviders(
      <CommentaryTreeView
        abbreviation="MHC"
        summaries={mockSummaries}
        currentVerseId={null}
        onSelectVerse={onSelectVerse}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/Browse MHC Commentary/)).toBeInTheDocument();
  });

  it('shows total entry count in footer', () => {
    renderWithProviders(
      <CommentaryTreeView
        abbreviation="MHC"
        summaries={mockSummaries}
        currentVerseId={null}
        onSelectVerse={onSelectVerse}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('3 total entries')).toBeInTheDocument();
  });

  it('shows empty message when no summaries', () => {
    renderWithProviders(
      <CommentaryTreeView
        abbreviation="MHC"
        summaries={[]}
        currentVerseId={null}
        onSelectVerse={onSelectVerse}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('No entries available')).toBeInTheDocument();
  });

  it('expands book to show chapters', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CommentaryTreeView
        abbreviation="MHC"
        summaries={mockSummaries}
        currentVerseId={null}
        onSelectVerse={onSelectVerse}
        onClose={onClose}
      />,
    );
    // There should be two books: Genesis (book 1) and John (book 43)
    // Click all arrows to expand all books and find at least one chapter heading
    const arrows = screen.getAllByText('▶');
    for (const arrow of arrows) {
      await user.click(arrow);
    }
    // After expanding, should see at least one chapter heading
    expect(screen.getAllByText(/Chapter \d+/).length).toBeGreaterThan(0);
  });

  it('calls onClose when Close button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CommentaryTreeView
        abbreviation="MHC"
        summaries={mockSummaries}
        currentVerseId={null}
        onSelectVerse={onSelectVerse}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when ✕ button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CommentaryTreeView
        abbreviation="MHC"
        summaries={mockSummaries}
        currentVerseId={null}
        onSelectVerse={onSelectVerse}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows no results for unmatched search query', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CommentaryTreeView
        abbreviation="MHC"
        summaries={mockSummaries}
        currentVerseId={null}
        onSelectVerse={onSelectVerse}
        onClose={onClose}
      />,
    );
    const input = screen.getByPlaceholderText(enString('commentaryTreeView.searchPlaceholder'));
    // The focus trap moves focus into the dialog on a requestAnimationFrame;
    // typing before it lands sends the keystrokes to whatever it focuses instead.
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    await user.type(input, 'xyzzy_no_match_12345');
    expect(screen.getByText('No matching verses found')).toBeInTheDocument();
  });

  it('auto-expands the current verse book and chapter', () => {
    renderWithProviders(
      <CommentaryTreeView
        abbreviation="MHC"
        summaries={mockSummaries}
        currentVerseId={43003016}
        onSelectVerse={onSelectVerse}
        onClose={onClose}
      />,
    );
    // The current verse's book should be expanded (showing chapter headings)
    expect(screen.getByText(/Chapter 3/)).toBeInTheDocument();
  });
});
