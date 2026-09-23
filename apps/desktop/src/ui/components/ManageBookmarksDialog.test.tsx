import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManageBookmarksDialog from './ManageBookmarksDialog';
import { useBookmarkStore } from '../stores/useBookmarkStore';
import { useBibleStore } from '../stores/useBibleStore';
import { enT } from '../testing/enCatalog';
import type { SerializedPinnedItem } from '../services/collectionAPI';

// The component resolves its own strings; mocking the hook keeps the test
// free of a ContextProvider while still asserting the shipped English.
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    locale: 'en' as const,
    i18n: {},
  }),
}));

/**
 * Let the dialog finish mounting before interacting with it.
 *
 * `activateFocusTrap` moves focus to the first focusable element on a
 * `requestAnimationFrame`. Fire a click before that frame runs and the trap
 * lands afterwards, blurring whatever inline editor the click just opened -
 * which commits and closes it. A real user never types that fast; the test
 * has to wait for the same reason.
 */
const settle = () =>
  act(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  });

const bookmark = (
  pinId: number,
  referenceText: string,
  extra: Partial<SerializedPinnedItem> = {},
): SerializedPinnedItem => ({
  pinId,
  itemType: 'verse',
  referenceText,
  sortOrder: pinId,
  ...extra,
});

describe('ManageBookmarksDialog', () => {
  let loadBookmarks: Mock;
  let setBookmarkTitle: Mock;
  let removeBookmark: Mock;
  let reorderBookmarks: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    loadBookmarks = vi.fn().mockResolvedValue(undefined);
    setBookmarkTitle = vi.fn().mockResolvedValue(undefined);
    removeBookmark = vi.fn().mockResolvedValue(undefined);
    reorderBookmarks = vi.fn().mockResolvedValue(undefined);

    useBookmarkStore.setState({
      bookmarks: [
        bookmark(1, 'John 3:16'),
        bookmark(2, 'Romans 5:12', { title: 'Where I am reading in Romans' }),
        bookmark(3, 'Psalm 23:1'),
      ],
      loadBookmarks,
      setBookmarkTitle,
      removeBookmark,
      reorderBookmarks,
    });
  });

  it('lists bookmarks, showing a name in place of the reference', () => {
    render(<ManageBookmarksDialog onClose={vi.fn()} />);

    expect(screen.getByText('John 3:16')).toBeInTheDocument();
    expect(screen.getByText('Where I am reading in Romans')).toBeInTheDocument();
    // A named bookmark still shows its reference underneath.
    expect(screen.getByText('Romans 5:12')).toBeInTheDocument();
  });

  it('shows an empty state rather than an empty list', () => {
    useBookmarkStore.setState({ bookmarks: [] });
    render(<ManageBookmarksDialog onClose={vi.fn()} />);

    expect(screen.getByTestId('bookmarks-empty')).toBeInTheDocument();
  });

  it('renames a bookmark', async () => {
    const user = userEvent.setup();
    render(<ManageBookmarksDialog onClose={vi.fn()} />);

    await settle();

    await user.click(screen.getByTestId('bookmark-rename-1'));
    await user.type(screen.getByTestId('bookmark-name-input-1'), 'The gospel');
    await user.keyboard('{Enter}');

    expect(setBookmarkTitle).toHaveBeenCalledWith(1, 'The gospel');
  });

  it('offers no notes editor — a bookmark is a place, not a record', async () => {
    render(<ManageBookmarksDialog onClose={vi.fn()} />);

    await settle();

    expect(screen.queryByTestId('bookmark-notes-1')).not.toBeInTheDocument();
  });

  it('removes a bookmark', async () => {
    const user = userEvent.setup();
    render(<ManageBookmarksDialog onClose={vi.fn()} />);

    await settle();

    await user.click(screen.getByTestId('bookmark-remove-2'));

    expect(removeBookmark).toHaveBeenCalledWith(2);
  });

  it('reorders from the drag handle, persisting the whole order', async () => {
    const user = userEvent.setup();
    render(<ManageBookmarksDialog onClose={vi.fn()} />);

    await settle();

    // The handle is the only reordering control left: dragging is the gesture,
    // and the arrow keys on it are the same move without a mouse.
    screen.getByTestId('bookmark-handle-1').focus();
    await user.keyboard('{ArrowDown}');

    expect(reorderBookmarks).toHaveBeenCalledWith([2, 1, 3]);
  });

  it('does not run off either end of the list', async () => {
    const user = userEvent.setup();
    render(<ManageBookmarksDialog onClose={vi.fn()} />);

    await settle();

    screen.getByTestId('bookmark-handle-1').focus();
    await user.keyboard('{ArrowUp}');
    screen.getByTestId('bookmark-handle-3').focus();
    await user.keyboard('{ArrowDown}');

    expect(reorderBookmarks).not.toHaveBeenCalled();
  });

  it('navigates to a bookmark and closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const navigateToVerseInPrimary = vi.fn();
    useBibleStore.setState({ navigateToVerseInPrimary });

    useBookmarkStore.setState({
      bookmarks: [bookmark(1, 'John 3:16', { verseIdStart: 43003016 })],
    });

    render(<ManageBookmarksDialog onClose={onClose} />);
    await settle();

    await user.click(screen.getByTestId('bookmark-goto-1'));

    expect(navigateToVerseInPrimary).toHaveBeenCalledWith(43003016);
    expect(onClose).toHaveBeenCalled();
  });

  it('lets Escape back out of an inline rename without closing the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ManageBookmarksDialog onClose={onClose} />);

    await settle();

    await user.click(screen.getByTestId('bookmark-rename-1'));
    await user.type(screen.getByTestId('bookmark-name-input-1'), 'Half-typed');
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('bookmark-name-input-1')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Escape cancels. The blur that follows the input unmounting must not
    // save the draft behind it.
    expect(setBookmarkTitle).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape even when focus has fallen outside the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ManageBookmarksDialog onClose={onClose} />);

    await settle();

    // Clicking inert chrome, or arriving from the popover that opened this,
    // can leave focus on <body>. A keydown handler bound to the dialog never
    // sees Escape from there, which is what made it look unclosable.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});
