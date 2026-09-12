/**
 * The Bible pane's bookmark control: one star that opens the jump list, with
 * saving as an item inside it.
 *
 * Saving acts on the pane's current selection, so most of what is worth
 * asserting here is which verse (or passage) reaches the store - and that
 * merely opening the menu saves nothing.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  ctx: { value: {} as Record<string, unknown> },
  bible: {
    navigateToVerse: vi.fn(),
  },
}));

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `[${key}:${JSON.stringify(params)}]` : `[${key}]`,
    locale: 'en',
    i18n: {},
  }),
}));

vi.mock('../BiblePaneContext', () => ({
  useBiblePaneContext: () => h.ctx.value,
}));

vi.mock('../../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(h.bible),
    { getState: () => h.bible },
  ),
}));

import BookmarkMenu from './BookmarkMenu';
import { useBookmarkStore } from '../../stores/useBookmarkStore';

const PANEL = 'bible_1';
const JOHN_3_16 = 43003016;
const JOHN_3_17 = 43003017;

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    panelId: PANEL,
    activeTab: { tabId: 'tab1', abbreviation: 'KJV', moduleId: 7 },
    selectedVerseId: JOHN_3_16,
    selectionEndVerseId: null,
    ...overrides,
  };
}

describe('BookmarkMenu', () => {
  let addBookmark: Mock;
  let removeVerseFromAllCollections: Mock;
  let loadBookmarks: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    addBookmark = vi.fn().mockResolvedValue(undefined);
    removeVerseFromAllCollections = vi.fn().mockResolvedValue(undefined);
    loadBookmarks = vi.fn().mockResolvedValue(undefined);

    h.ctx.value = makeCtx();
    useBookmarkStore.setState({
      bookmarks: [],
      bookmarkedVerses: new Set<number>(),
      addBookmark,
      removeVerseFromAllCollections,
      loadBookmarks,
    });
  });

  it('opens the list without saving anything', async () => {
    const user = userEvent.setup();
    render(<BookmarkMenu />);

    await user.click(screen.getByTestId('bookmark-toggle'));

    // Coming back to a saved place is the common errand; the star must not
    // save a verse just because the reader wanted to look at the list.
    expect(addBookmark).not.toHaveBeenCalled();
    expect(screen.getByTestId('bookmark-add-current')).toBeInTheDocument();
  });

  it('bookmarks the selected verse from the menu', async () => {
    const user = userEvent.setup();
    render(<BookmarkMenu />);

    await user.click(screen.getByTestId('bookmark-toggle'));
    await user.click(screen.getByTestId('bookmark-add-current'));

    expect(addBookmark).toHaveBeenCalledWith(JOHN_3_16, undefined, 7);
  });

  it('bookmarks the whole passage when a range is selected', async () => {
    const user = userEvent.setup();
    h.ctx.value = makeCtx({ selectionEndVerseId: JOHN_3_17 });
    render(<BookmarkMenu />);

    await user.click(screen.getByTestId('bookmark-toggle'));
    await user.click(screen.getByTestId('bookmark-add-current'));

    expect(addBookmark).toHaveBeenCalledWith(JOHN_3_16, JOHN_3_17, 7);
  });

  it('offers removal instead when the verse already has a bookmark', async () => {
    const user = userEvent.setup();
    useBookmarkStore.setState({ bookmarkedVerses: new Set([JOHN_3_16]) });
    render(<BookmarkMenu />);

    const toggle = screen.getByTestId('bookmark-toggle');
    // The filled star is the readout that this verse is saved.
    expect(toggle).toHaveAttribute('data-bookmarked', 'true');

    await user.click(toggle);
    await user.click(screen.getByTestId('bookmark-remove-current'));

    expect(removeVerseFromAllCollections).toHaveBeenCalledWith(JOHN_3_16);
    expect(addBookmark).not.toHaveBeenCalled();
  });

  it('disables saving when no verse is selected, but still opens', async () => {
    const user = userEvent.setup();
    h.ctx.value = makeCtx({ selectedVerseId: null });
    render(<BookmarkMenu />);

    await user.click(screen.getByTestId('bookmark-toggle'));

    expect(screen.getByTestId('bookmark-add-current')).toBeDisabled();
    expect(screen.getByTestId('bookmark-manage')).toBeInTheDocument();
  });

  it('shows an empty state in the dropdown', async () => {
    const user = userEvent.setup();
    render(<BookmarkMenu />);

    await user.click(screen.getByTestId('bookmark-toggle'));

    expect(screen.getByText('[biblePane.noBookmarks]')).toBeInTheDocument();
  });

  it('navigates to a bookmark from the dropdown', async () => {
    const user = userEvent.setup();
    useBookmarkStore.setState({
      bookmarks: [
        { pinId: 1, itemType: 'verse', referenceText: 'Psalm 23:1',
          verseIdStart: 19023001, sortOrder: 0 },
      ],
    });
    render(<BookmarkMenu />);

    await user.click(screen.getByTestId('bookmark-toggle'));
    await user.click(screen.getByTestId('bookmark-jump-1'));

    expect(h.bible.navigateToVerse).toHaveBeenCalledWith(PANEL, 19023001);
  });

  it('caps the dropdown and says how many are not shown', async () => {
    const user = userEvent.setup();
    useBookmarkStore.setState({
      bookmarks: Array.from({ length: 15 }, (_, i) => ({
        pinId: i + 1,
        itemType: 'verse' as const,
        referenceText: `Psalm ${i + 1}:1`,
        verseIdStart: 19000001 + i * 1000,
        sortOrder: i,
      })),
    });
    render(<BookmarkMenu />);

    await user.click(screen.getByTestId('bookmark-toggle'));

    expect(screen.getByTestId('bookmark-jump-12')).toBeInTheDocument();
    expect(screen.queryByTestId('bookmark-jump-13')).not.toBeInTheDocument();
    expect(
      screen.getByText('[biblePane.bookmarksOverflow:{"count":3}]'),
    ).toBeInTheDocument();
  });

  it('asks the app to open the manager', async () => {
    const user = userEvent.setup();
    const listener = vi.fn();
    window.addEventListener('command:bookmarks:manage', listener);
    render(<BookmarkMenu />);

    await user.click(screen.getByTestId('bookmark-toggle'));
    await user.click(screen.getByTestId('bookmark-manage'));

    expect(listener).toHaveBeenCalled();
    window.removeEventListener('command:bookmarks:manage', listener);
  });
});
