/**
 * The flat bookmark slice - the surface the v1 bookmarks UI talks to.
 *
 * The tree-shaped collection state in the same store is the extension-facing
 * API and is not exercised here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({
  getBookmarks: vi.fn(),
  quickBookmarkVerse: vi.fn(),
  bookmarkPassage: vi.fn(),
  replaceBookmarkReference: vi.fn(),
  renameBookmark: vi.fn(),
  removePinnedItem: vi.fn(),
  removeVerseBookmark: vi.fn(),
  updatePinnedItem: vi.fn(),
  reorderPinnedItems: vi.fn(),
  getCollectionsContainingVerse: vi.fn(),
  getCollectionTree: vi.fn(),
  getAllCollections: vi.fn(),
  getPinnedItemsForCollection: vi.fn(),
}));

vi.mock('../services/collectionAPI', () => ({
  ...api,
  getCollectionById: vi.fn(),
  getTopLevelCollections: vi.fn(),
  getChildCollections: vi.fn(),
  createCollection: vi.fn(),
  updateCollection: vi.fn(),
  deleteCollection: vi.fn(),
  moveCollection: vi.fn(),
  searchCollections: vi.fn(),
  addVerseToCollection: vi.fn(),
  addPassageToCollection: vi.fn(),
  isVerseBookmarked: vi.fn(),
  movePinnedItemToCollection: vi.fn(),
  bulkAddVersesToCollection: vi.fn(),
  reorderCollections: vi.fn(),
}));

import { useBookmarkStore } from './useBookmarkStore';
import type { SerializedPinnedItem } from '../services/collectionAPI';

const JOHN_3_16 = 43003016;
const PSALM_23_1 = 19023001;

const item = (
  pinId: number,
  verseIdStart: number,
  extra: Partial<SerializedPinnedItem> = {},
): SerializedPinnedItem => ({
  pinId,
  itemType: 'verse',
  verseIdStart,
  sortOrder: pinId,
  ...extra,
});

describe('useBookmarkStore — flat bookmark list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBookmarkStore.setState({
      bookmarks: [],
      bookmarksLoaded: false,
      bookmarkedVerses: new Set<number>(),
      pinnedItems: [],
      error: null,
    });
  });

  it('loads the list and derives the marked-verse set from it', async () => {
    api.getBookmarks.mockResolvedValue([
      item(1, JOHN_3_16),
      item(2, PSALM_23_1),
    ]);

    await useBookmarkStore.getState().loadBookmarks();

    const state = useBookmarkStore.getState();
    expect(state.bookmarks).toHaveLength(2);
    expect(state.bookmarksLoaded).toBe(true);
    expect(state.bookmarkedVerses.has(JOHN_3_16)).toBe(true);
    expect(state.bookmarkedVerses.has(PSALM_23_1)).toBe(true);
  });

  it('marks a passage at its opening verse only', async () => {
    api.getBookmarks.mockResolvedValue([
      item(1, 45008028, { itemType: 'passage', verseIdEnd: 45008039 }),
    ]);

    await useBookmarkStore.getState().loadBookmarks();

    const { bookmarkedVerses } = useBookmarkStore.getState();
    expect(bookmarkedVerses.has(45008028)).toBe(true);
    // Not every verse of the range - that would put an identical marker
    // beside all twelve.
    expect(bookmarkedVerses.has(45008030)).toBe(false);
  });

  it('adds a verse through the quick-bookmark path', async () => {
    api.getBookmarks.mockResolvedValue([]);
    api.quickBookmarkVerse.mockResolvedValue(item(1, JOHN_3_16));

    await useBookmarkStore.getState().addBookmark(JOHN_3_16, undefined, 7);

    expect(api.quickBookmarkVerse).toHaveBeenCalledWith(JOHN_3_16, 7, undefined);
    expect(api.bookmarkPassage).not.toHaveBeenCalled();
  });

  it('adds a passage when the range spans more than one verse', async () => {
    api.getBookmarks.mockResolvedValue([]);
    api.bookmarkPassage.mockResolvedValue(item(1, 45008028));

    await useBookmarkStore.getState().addBookmark(45008028, 45008039, 7);

    expect(api.bookmarkPassage).toHaveBeenCalledWith(45008028, 45008039, 7, undefined);
    expect(api.quickBookmarkVerse).not.toHaveBeenCalled();
  });

  it('treats a one-verse range as a verse, not a passage', async () => {
    api.getBookmarks.mockResolvedValue([]);
    api.quickBookmarkVerse.mockResolvedValue(item(1, JOHN_3_16));

    await useBookmarkStore.getState().addBookmark(JOHN_3_16, JOHN_3_16, 7);

    expect(api.quickBookmarkVerse).toHaveBeenCalled();
    expect(api.bookmarkPassage).not.toHaveBeenCalled();
  });

  it('toggles a bookmarked verse off rather than adding a second', async () => {
    api.getBookmarks.mockResolvedValue([]);
    api.removeVerseBookmark.mockResolvedValue(undefined);
    api.getCollectionsContainingVerse.mockResolvedValue([]);
    api.getCollectionTree.mockResolvedValue([]);
    useBookmarkStore.setState({
      bookmarks: [item(1, JOHN_3_16)],
      bookmarkedVerses: new Set([JOHN_3_16]),
    });

    await useBookmarkStore.getState().toggleVerseBookmark(JOHN_3_16);

    expect(api.removeVerseBookmark).toHaveBeenCalledWith(JOHN_3_16);
    expect(api.quickBookmarkVerse).not.toHaveBeenCalled();
  });

  it('moves the list before the reorder write lands', async () => {
    const before = [item(1, JOHN_3_16), item(2, PSALM_23_1), item(3, 1001001)];
    useBookmarkStore.setState({ bookmarks: before });

    let resolveWrite: () => void = () => {};
    api.reorderPinnedItems.mockReturnValue(
      new Promise<void>(resolve => {
        resolveWrite = resolve;
      }),
    );
    api.getBookmarks.mockResolvedValue([before[2], before[0], before[1]]);

    const pending = useBookmarkStore.getState().reorderBookmarks([3, 1, 2]);

    // Optimistic: the row is already in its new place while the IPC is in
    // flight, so a drag does not visibly snap back.
    expect(useBookmarkStore.getState().bookmarks.map(b => b.pinId)).toEqual([3, 1, 2]);

    resolveWrite();
    await pending;
    expect(useBookmarkStore.getState().bookmarks.map(b => b.pinId)).toEqual([3, 1, 2]);
  });

  it('puts the old order back if the reorder write fails', async () => {
    const before = [item(1, JOHN_3_16), item(2, PSALM_23_1)];
    useBookmarkStore.setState({ bookmarks: before });
    api.reorderPinnedItems.mockRejectedValue(new Error('nope'));

    await expect(useBookmarkStore.getState().reorderBookmarks([2, 1])).rejects.toThrow('nope');

    expect(useBookmarkStore.getState().bookmarks.map(b => b.pinId)).toEqual([1, 2]);
    expect(useBookmarkStore.getState().error).toBe('nope');
  });

  it('toggles an unbookmarked passage on, keeping its range', async () => {
    api.getBookmarks.mockResolvedValue([]);
    api.bookmarkPassage.mockResolvedValue(item(1, 45008028));

    await useBookmarkStore.getState().toggleVerseBookmark(45008028, 45008039, 7);

    expect(api.bookmarkPassage).toHaveBeenCalledWith(45008028, 45008039, 7, undefined);
  });

  it('clears a blank note rather than storing whitespace', async () => {
    api.getBookmarks.mockResolvedValue([]);
    api.updatePinnedItem.mockResolvedValue(item(1, JOHN_3_16));
    useBookmarkStore.setState({ bookmarks: [item(1, JOHN_3_16, { notes: 'old' })] });

    await useBookmarkStore.getState().setBookmarkNotes(1, '   ');

    expect(api.updatePinnedItem).toHaveBeenCalledWith(
      expect.objectContaining({ pinId: 1, notes: undefined }),
    );
  });

  it('rebuilds the marked-verse set from the flat list, not the tree', async () => {
    // `refreshBookmarkedVerses` reading `pinnedItems` would empty the set the
    // gutter markers read from: only the (unmounted) collection tree ever
    // fills `pinnedItems`.
    useBookmarkStore.setState({
      bookmarks: [item(1, JOHN_3_16)],
      bookmarksLoaded: true,
      pinnedItems: [],
    });

    await useBookmarkStore.getState().refreshBookmarkedVerses();

    expect(useBookmarkStore.getState().bookmarkedVerses.has(JOHN_3_16)).toBe(true);
  });
});
