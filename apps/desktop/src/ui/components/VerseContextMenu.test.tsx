import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import VerseContextMenu, { withVerseMenuContext } from './VerseContextMenu';
import type { BibleVerse } from '../services/verseCopyService';

describe('withVerseMenuContext', () => {
  const v = (verseId: number) => ({ verse_id: verseId }) as unknown as BibleVerse;

  it('tells a menu command which verse was clicked', () => {
    expect(withVerseMenuContext(undefined, v(43003016), 'KJV')).toEqual({
      verse: { verseId: 43003016, verseIds: [43003016], module: 'KJV' },
    });
  });

  it('merges into object args and carries a selection', () => {
    expect(withVerseMenuContext({ mode: 'x' }, [v(1001001), v(1001002)], 'ASV')).toEqual({
      mode: 'x',
      verse: { verseId: 1001001, verseIds: [1001001, 1001002], module: 'ASV' },
    });
  });

  it('passes non-object args through unchanged', () => {
    expect(withVerseMenuContext('literal', v(1), 'KJV')).toBe('literal');
    expect(withVerseMenuContext([1, 2], v(1), 'KJV')).toEqual([1, 2]);
  });
});
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
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

function renderWithProviders(ui: React.ReactElement) {
  return render(<ContextProvider services={createMockServices()}>{ui}</ContextProvider>);
}

const mockVerse = { verse_id: 43003016, book_number: 43, chapter: 3, verse: 16, text: 'For God so loved the world' };
const mockContext = { bookName: 'John', chapter: 3, translation: 'KJV' };
const position = { x: 100, y: 200 };

describe('VerseContextMenu', () => {
  const onClose = vi.fn();
  const onOpenCopyOptions = vi.fn();
  const onOpenHighlightMenu = vi.fn();
  const onAddNote = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders as a menu with aria role', () => {
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onOpenCopyOptions={onOpenCopyOptions}
      />,
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('shows Copy Passage option when onOpenCopyOptions is provided', () => {
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onOpenCopyOptions={onOpenCopyOptions}
      />,
    );
    expect(screen.getByText('ui.verseContextMenu.copyPassage')).toBeInTheDocument();
  });

  it('calls onOpenCopyOptions and onClose when copy is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onOpenCopyOptions={onOpenCopyOptions}
      />,
    );
    await user.click(screen.getByText('ui.verseContextMenu.copyPassage'));
    expect(onOpenCopyOptions).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows highlight option when onOpenHighlightMenu is provided', () => {
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onOpenHighlightMenu={onOpenHighlightMenu}
      />,
    );
    expect(screen.getByText('ui.verseContextMenu.highlightUnderline')).toBeInTheDocument();
  });

  it('shows add note option when onAddNote is provided', () => {
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onAddNote={onAddNote}
      />,
    );
    expect(screen.getByText('ui.verseContextMenu.addNote')).toBeInTheDocument();
  });

  it('closes when Escape key is pressed', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  // -- Bookmarks ----------------------------------------------------------
  //
  // The menu offers bookmarking only when the host wires it up; a pane that
  // passes no `onAddBookmark` gets the menu it had before the feature landed.

  it('offers no bookmark option when the host does not wire one up', () => {
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
      />,
    );
    expect(screen.queryByTestId('verse-bookmarks')).not.toBeInTheDocument();
  });

  it('opens the bookmarks flyout and adds a new bookmark', async () => {
    const user = userEvent.setup();
    const onAddBookmark = vi.fn();
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onAddBookmark={onAddBookmark}
      />,
    );

    await user.click(screen.getByTestId('verse-bookmarks'));
    // The flyout opens beside the item; the menu behind it stays put.
    expect(screen.getByTestId('verse-bookmarks-submenu')).toBeInTheDocument();
    expect(screen.getByTestId('verse-bookmarks')).toBeInTheDocument();

    await user.click(screen.getByTestId('verse-add-bookmark'));
    expect(onAddBookmark).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('lists existing bookmarks as replace targets', async () => {
    const user = userEvent.setup();
    const onReplaceBookmark = vi.fn();
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onAddBookmark={vi.fn()}
        onReplaceBookmark={onReplaceBookmark}
        bookmarks={[
          { pinId: 7, itemType: 'verse', referenceText: 'Romans 5:12',
            title: 'Where I am reading in Romans', sortOrder: 0 },
          { pinId: 8, itemType: 'verse', referenceText: 'Psalm 23:1', sortOrder: 1 },
        ]}
      />,
    );

    await user.click(screen.getByTestId('verse-bookmarks'));

    // A named bookmark shows its name; an unnamed one shows its reference.
    expect(screen.getByText('Where I am reading in Romans')).toBeInTheDocument();
    expect(screen.getByText('Psalm 23:1')).toBeInTheDocument();

    await user.click(screen.getByTestId('verse-replace-bookmark-7'));
    expect(onReplaceBookmark).toHaveBeenCalledWith(7);
  });

  it('opens the bookmarks flyout on hover, without leaving the menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onAddBookmark={vi.fn()}
        onOpenCopyOptions={vi.fn()}
      />,
    );

    const item = screen.getByTestId('verse-bookmarks');
    await user.hover(item);
    expect(screen.getByTestId('verse-bookmarks-submenu')).toBeInTheDocument();
    // Copy Passage stays visible; the drill-in view must not hide it.
    expect(screen.getByText('ui.verseContextMenu.copyPassage')).toBeInTheDocument();

    // Closing is on a grace timer, so the pointer can travel from the item to
    // the panel without the panel vanishing under it.
    await user.unhover(item);
    await waitFor(() =>
      expect(screen.queryByTestId('verse-bookmarks-submenu')).not.toBeInTheDocument(),
    );
  });

  it('closes the flyout on Escape before closing the menu', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onAddBookmark={vi.fn()}
        onOpenCopyOptions={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('verse-bookmarks'));
    // Opening moves focus into the flyout a frame later. A real Escape always
    // comes after that, so wait for it rather than racing the frame.
    await waitFor(() =>
      expect(screen.getByTestId('verse-bookmarks-submenu')).toContainElement(
        document.activeElement as HTMLElement,
      ),
    );
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('verse-bookmarks-submenu')).not.toBeInTheDocument();
    expect(screen.getByTestId('verse-bookmarks')).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no removal for a verse that is not bookmarked', () => {
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onAddBookmark={vi.fn()}
        onRemoveBookmark={vi.fn()}
        isBookmarked={false}
      />,
    );
    expect(screen.queryByTestId('verse-remove-bookmark')).not.toBeInTheDocument();
  });

  it('removes the bookmark from a verse that has one', async () => {
    const user = userEvent.setup();
    const onRemoveBookmark = vi.fn();
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        onAddBookmark={vi.fn()}
        onRemoveBookmark={onRemoveBookmark}
        isBookmarked
      />,
    );

    await user.click(screen.getByTestId('verse-remove-bookmark'));
    expect(onRemoveBookmark).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows remove highlight option when markupId is provided', () => {
    const onRemoveHighlight = vi.fn();
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        markupId={42}
        onRemoveHighlight={onRemoveHighlight}
      />,
    );
    expect(screen.getByText('ui.verseContextMenu.removeHighlight')).toBeInTheDocument();
  });

  it('calls removeHighlight and onClose when remove highlight is clicked', async () => {
    const user = userEvent.setup();
    const onRemoveHighlight = vi.fn();
    renderWithProviders(
      <VerseContextMenu
        verses={mockVerse}
        context={mockContext}
        position={position}
        onClose={onClose}
        markupId={42}
        onRemoveHighlight={onRemoveHighlight}
      />,
    );
    await user.click(screen.getByText('ui.verseContextMenu.removeHighlight'));
    expect(onRemoveHighlight).toHaveBeenCalledWith(42);
    expect(onClose).toHaveBeenCalled();
  });
});
