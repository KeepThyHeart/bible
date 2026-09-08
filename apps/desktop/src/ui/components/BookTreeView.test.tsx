import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import BookTreeView from './BookTreeView';
import type { BookSectionSummary } from '../stores/useBookStore';
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

const mockSummaries: BookSectionSummary[] = [
  { section_id: 1, parent_section_id: undefined, section_number: '1', title: 'Introduction', word_count: 500 },
  { section_id: 2, parent_section_id: 1, section_number: '1.1', title: 'Background', word_count: 200 },
  { section_id: 3, parent_section_id: 1, section_number: '1.2', title: 'Overview', word_count: 300 },
  { section_id: 4, parent_section_id: undefined, section_number: '2', title: 'Main Content', word_count: 1000 },
];

describe('BookTreeView', () => {
  const onSelectSection = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Table of Contents heading', () => {
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={mockSummaries}
        currentSectionId={null}
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(enString('ui.bookTreeView.tableOfContents'))).toBeInTheDocument();
  });

  it('renders top-level sections', () => {
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={mockSummaries}
        currentSectionId={null}
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Main Content')).toBeInTheDocument();
  });

  it('shows empty state when no sections', () => {
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={[]}
        currentSectionId={null}
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('No sections found')).toBeInTheDocument();
  });

  it('calls onSelectSection when a section is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={mockSummaries}
        currentSectionId={null}
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByText('Introduction'));
    expect(onSelectSection).toHaveBeenCalledWith(1);
  });

  it('expands children when expand button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={mockSummaries}
        currentSectionId={null}
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    // The disclosure control is named "Expand <section title>", not by the bare
    // ">" glyph, which tells a screen reader nothing.
    const expandBtn = screen.getAllByRole('button', { name: /^Expand / })[0];
    await user.click(expandBtn);
    expect(screen.getByText('Background')).toBeInTheDocument();
  });

  it('expands all when Expand All is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={mockSummaries}
        currentSectionId={null}
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByText('Expand All'));
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it('calls onClose when Close button is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={mockSummaries}
        currentSectionId={null}
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  /*
    The dialog is opened by the same click that starts the summaries fetch, so
    it has to be able to say "loading" and "that failed, try again" itself.
    Withholding the dialog until summaries exist would make the Contents button
    a no-op on first click and a permanent no-op on a failed query.
  */
  it('shows a loading state instead of "no sections" while summaries are in flight', () => {
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={[]}
        currentSectionId={null}
        isLoading
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('book-tree-loading')).toBeInTheDocument();
    expect(screen.queryByText('No sections found')).not.toBeInTheDocument();
  });

  it('reports a failed summaries load and offers a retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={[]}
        currentSectionId={null}
        error="database is locked"
        onRetry={onRetry}
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('book-tree-error')).toBeInTheDocument();
    expect(screen.getByText('database is locked')).toBeInTheDocument();

    await user.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('highlights current section', () => {
    renderWithProviders(
      <BookTreeView
        abbreviation="PILGRIM"
        summaries={mockSummaries}
        currentSectionId={4}
        onSelectSection={onSelectSection}
        onClose={onClose}
      />,
    );
    const mainContent = screen.getByText('Main Content');
    // Should have accent styling
    expect(mainContent).toHaveClass('text-accent');
  });
});
