import { create } from 'zustand';
import {
  SerializedCollection,
  SerializedPinnedItem,
  getAllCollections,
  getCollectionTree,
  createCollection,
  updateCollection,
  deleteCollection,
  getPinnedItemsForCollection,
  addVerseToCollection,
  addPassageToCollection,
  quickBookmarkVerse,
  removePinnedItem,
  removeVerseBookmark,
  isVerseBookmarked,
  getCollectionsContainingVerse,
  movePinnedItemToCollection,
  updatePinnedItem,
  bulkAddVersesToCollection,
  reorderCollections,
  reorderPinnedItems,
  getBookmarks,
  bookmarkPassage,
  replaceBookmarkReference,
  renameBookmark
} from '../services/collectionAPI';

interface BookmarkState {
  // Collections
  collections: SerializedCollection[];
  collectionTree: SerializedCollection[];
  selectedCollectionId: number | null;

  // Pinned items
  pinnedItems: SerializedPinnedItem[];
  pinnedItemsByCollection: Map<number, SerializedPinnedItem[]>;

  // Bookmarked verses cache (for quick lookup)
  bookmarkedVerses: Set<number>;

  // UI state
  loading: boolean;
  error: string | null;
  searchQuery: string;

  // View mode
  viewMode: 'flat' | 'tree';
  showEmptyCollections: boolean;

  // Actions - Collections
  loadCollections: () => Promise<void>;
  loadCollectionTree: () => Promise<void>;
  selectCollection: (collectionId: number | null) => void;
  createNewCollection: (data: Partial<SerializedCollection>) => Promise<SerializedCollection>;
  updateExistingCollection: (collection: SerializedCollection) => Promise<void>;
  deleteExistingCollection: (collectionId: number) => Promise<void>;
  searchCollections: (searchTerm: string) => void;
  reorderCollectionList: (collectionIds: number[]) => Promise<void>;

  // Actions - Pinned Items
  loadPinnedItems: (collectionId: number) => Promise<void>;
  loadCollectionItems: (collectionId: number) => Promise<void>;
  addVerse: (collectionId: number, verseId: number, moduleId?: number, title?: string, notes?: string) => Promise<void>;
  addPassage: (
    collectionId: number,
    verseIdStart: number,
    verseIdEnd: number,
    moduleId?: number,
    title?: string,
    notes?: string
  ) => Promise<void>;
  quickBookmark: (verseId: number, moduleId?: number, title?: string) => Promise<void>;
  removeItem: (pinId: number) => Promise<void>;
  removeVerseFromAllCollections: (verseId: number) => Promise<void>;
  moveItem: (pinId: number, targetCollectionId: number) => Promise<void>;
  updateItem: (item: SerializedPinnedItem) => Promise<void>;
  bulkAddVerses: (collectionId: number, verseIds: number[], moduleId?: number) => Promise<void>;
  reorderItems: (pinIds: number[]) => Promise<void>;

  // ===== Flat bookmark list =====
  //
  // What the v1 UI actually talks to. One collection, one ordered list; the
  // collection/tree state above is the extension-facing API and has no UI.

  /** The default collection's items, in the user's manual order. */
  bookmarks: SerializedPinnedItem[];
  /** False until `loadBookmarks` has resolved once. */
  bookmarksLoaded: boolean;

  loadBookmarks: () => Promise<void>;
  /** Bookmark a verse, or a passage when `verseIdEnd` is given. */
  addBookmark: (
    verseIdStart: number,
    verseIdEnd?: number,
    moduleId?: number,
    title?: string
  ) => Promise<void>;
  /** Re-point an existing bookmark; a custom title survives the move. */
  replaceBookmarkRef: (
    pinId: number,
    verseIdStart: number,
    verseIdEnd?: number
  ) => Promise<void>;
  /** Name a bookmark, or pass `undefined` to fall back to its reference. */
  setBookmarkTitle: (pinId: number, title?: string) => Promise<void>;
  setBookmarkNotes: (pinId: number, notes?: string) => Promise<void>;
  removeBookmark: (pinId: number) => Promise<void>;
  reorderBookmarks: (pinIds: number[]) => Promise<void>;
  /**
   * Add the selection if its first verse is not bookmarked, remove every
   * bookmark on that verse if it is. `verseIdEnd` saves a passage.
   */
  toggleVerseBookmark: (
    verseId: number,
    verseIdEnd?: number,
    moduleId?: number
  ) => Promise<void>;

  // Queries
  checkIfBookmarked: (verseId: number) => Promise<boolean>;
  getCollectionsForVerse: (verseId: number) => Promise<SerializedCollection[]>;
  refreshBookmarkedVerses: () => Promise<void>;

  // UI
  setViewMode: (mode: 'flat' | 'tree') => void;
  toggleEmptyCollections: () => void;
  setError: (error: string | null) => void;
}

/**
 * The verses the Bible pane should mark in its gutter.
 *
 * A passage is marked at its opening verse only. Expanding the whole range
 * would put an identical marker beside every verse of, say, Psalm 119 - noise
 * rather than information - and the marker's job is to say "a bookmark starts
 * here", which is exactly where the reader wants to click.
 */
function markedVerses(items: SerializedPinnedItem[]): Set<number> {
  return new Set(
    items
      .filter(item => item.verseIdStart !== undefined)
      .map(item => item.verseIdStart!)
  );
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  // Initial state
  collections: [],
  collectionTree: [],
  selectedCollectionId: null,
  pinnedItems: [],
  pinnedItemsByCollection: new Map(),
  bookmarkedVerses: new Set(),
  loading: false,
  error: null,
  searchQuery: '',
  viewMode: 'flat',
  showEmptyCollections: true,
  bookmarks: [],
  bookmarksLoaded: false,

  // ===== Flat bookmark list =====

  loadBookmarks: async () => {
    try {
      const bookmarks = await getBookmarks();
      set({
        bookmarks,
        bookmarksLoaded: true,
        bookmarkedVerses: markedVerses(bookmarks)
      });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  addBookmark: async (
    verseIdStart: number,
    verseIdEnd?: number,
    moduleId?: number,
    title?: string
  ) => {
    try {
      if (verseIdEnd !== undefined && verseIdEnd !== verseIdStart) {
        await bookmarkPassage(verseIdStart, verseIdEnd, moduleId, title);
      } else {
        await quickBookmarkVerse(verseIdStart, moduleId, title);
      }
      await get().loadBookmarks();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  replaceBookmarkRef: async (pinId: number, verseIdStart: number, verseIdEnd?: number) => {
    try {
      await replaceBookmarkReference(pinId, verseIdStart, verseIdEnd);
      await get().loadBookmarks();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  setBookmarkTitle: async (pinId: number, title?: string) => {
    try {
      await renameBookmark(pinId, title);
      await get().loadBookmarks();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  setBookmarkNotes: async (pinId: number, notes?: string) => {
    const existing = get().bookmarks.find(b => b.pinId === pinId);
    if (!existing) return;
    try {
      const trimmed = notes?.trim();
      await updatePinnedItem({ ...existing, notes: trimmed ? trimmed : undefined });
      await get().loadBookmarks();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  removeBookmark: async (pinId: number) => {
    try {
      await removePinnedItem(pinId);
      await get().loadBookmarks();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  reorderBookmarks: async (pinIds: number[]) => {
    // Move the list first: a drag that snapped back while the write was in
    // flight read as the drop having failed.
    const previous = get().bookmarks;
    const byId = new Map(previous.map(b => [b.pinId, b]));
    const optimistic = pinIds
      .map(id => byId.get(id))
      .filter((b): b is SerializedPinnedItem => b !== undefined);
    set({ bookmarks: optimistic });

    try {
      await reorderPinnedItems(pinIds);
      await get().loadBookmarks();
    } catch (error: unknown) {
      set({
        bookmarks: previous,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  },

  toggleVerseBookmark: async (verseId: number, verseIdEnd?: number, moduleId?: number) => {
    // `bookmarkedVerses` rather than a scan of `bookmarks`: it is the same set
    // the toolbar ribbon and the verse markers read, so the toggle can never
    // disagree with what the reader is looking at.
    if (get().bookmarkedVerses.has(verseId)) {
      await get().removeVerseFromAllCollections(verseId);
      await get().loadBookmarks();
      return;
    }
    await get().addBookmark(verseId, verseIdEnd, moduleId);
  },

  // Load all collections (flat list)
  loadCollections: async () => {
    set({ loading: true, error: null });
    try {
      const collections = await getAllCollections();
      set({ collections, loading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },

  // Load collection tree
  loadCollectionTree: async () => {
    set({ loading: true, error: null });
    try {
      const tree = await getCollectionTree();
      set({ collectionTree: tree, loading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },

  // Select a collection and load its items
  selectCollection: async (collectionId: number | null) => {
    set({ selectedCollectionId: collectionId });
    if (collectionId) {
      await get().loadPinnedItems(collectionId);
    } else {
      set({ pinnedItems: [] });
    }
  },

  // Create new collection
  createNewCollection: async (data: Partial<SerializedCollection>) => {
    set({ loading: true, error: null });
    try {
      const collection = await createCollection(data);

      // Refresh collections
      await get().loadCollectionTree();

      set({ loading: false });
      return collection;
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Update collection
  updateExistingCollection: async (collection: SerializedCollection) => {
    set({ loading: true, error: null });
    try {
      const updated = await updateCollection(collection);

      // Update in local state
      set(state => ({
        collections: state.collections.map(c =>
          c.collectionId === updated.collectionId ? updated : c
        ),
        loading: false
      }));

      // Refresh tree
      await get().loadCollectionTree();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Delete collection
  deleteExistingCollection: async (collectionId: number) => {
    set({ loading: true, error: null });
    try {
      await deleteCollection(collectionId);

      // Remove from local state
      set(state => ({
        collections: state.collections.filter(c => c.collectionId !== collectionId),
        selectedCollectionId: state.selectedCollectionId === collectionId ? null : state.selectedCollectionId,
        pinnedItems: state.selectedCollectionId === collectionId ? [] : state.pinnedItems,
        loading: false
      }));

      // Refresh tree
      await get().loadCollectionTree();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Search collections
  searchCollections: (searchTerm: string) => {
    set({ searchQuery: searchTerm });
  },

  // Reorder collections
  reorderCollectionList: async (collectionIds: number[]) => {
    try {
      await reorderCollections(collectionIds);
      // Refresh to get new order
      await get().loadCollectionTree();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  // Load pinned items for a collection
  loadPinnedItems: async (collectionId: number) => {
    set({ loading: true, error: null });
    try {
      const items = await getPinnedItemsForCollection(collectionId);
      set({ pinnedItems: items, loading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  },

  // Load collection items and add to the map (used by sidebar for multiple collections)
  loadCollectionItems: async (collectionId: number) => {
    try {
      const items = await getPinnedItemsForCollection(collectionId);
      set(state => {
        const newMap = new Map(state.pinnedItemsByCollection);
        newMap.set(collectionId, items);
        return { pinnedItemsByCollection: newMap };
      });
    } catch (error: unknown) {
      console.error(`Failed to load items for collection ${collectionId}:`, error);
    }
  },

  // Add verse to collection
  addVerse: async (
    collectionId: number,
    verseId: number,
    moduleId?: number,
    title?: string,
    notes?: string
  ) => {
    set({ loading: true, error: null });
    try {
      const item = await addVerseToCollection(collectionId, verseId, moduleId, title, notes);

      // Add to local state if this is the selected collection
      const { selectedCollectionId } = get();
      if (selectedCollectionId === collectionId) {
        set(state => ({
          pinnedItems: [...state.pinnedItems, item],
          loading: false
        }));
      } else {
        set({ loading: false });
      }

      // Refresh sidebar items for this collection
      await get().loadCollectionItems(collectionId);

      // Add to bookmarked verses cache
      set(state => ({
        bookmarkedVerses: new Set([...state.bookmarkedVerses, verseId])
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Add passage to collection
  addPassage: async (
    collectionId: number,
    verseIdStart: number,
    verseIdEnd: number,
    moduleId?: number,
    title?: string,
    notes?: string
  ) => {
    set({ loading: true, error: null });
    try {
      const item = await addPassageToCollection(
        collectionId,
        verseIdStart,
        verseIdEnd,
        moduleId,
        title,
        notes
      );

      // Add to local state if this is the selected collection
      const { selectedCollectionId } = get();
      if (selectedCollectionId === collectionId) {
        set(state => ({
          pinnedItems: [...state.pinnedItems, item],
          loading: false
        }));
      } else {
        set({ loading: false });
      }

      // Note: For passages, we don't add individual verses to cache
      // The cache is for exact verse matches only
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Quick bookmark (to Favorites)
  quickBookmark: async (verseId: number, moduleId?: number, title?: string) => {
    set({ loading: true, error: null });
    try {
      await quickBookmarkVerse(verseId, moduleId, title);

      // Find the default bookmarks collection in the tree. Matched on the
      // metadata flag, not on name + icon: the collection is user-renameable
      // and its name is localised, so matching on a name/icon pair would miss
      // a renamed default and silently skip the refresh below. Core stamps
      // the flag (and adopts a legacy "Favorites" in place) -- see
      // CollectionService.
      const { selectedCollectionId, collectionTree } = get();
      const favorites = collectionTree.find(c => c.metadata?.isDefaultBookmarks === true);

      if (favorites && favorites.collectionId) {
        // If Favorites is selected, refresh the main items view
        if (selectedCollectionId === favorites.collectionId) {
          await get().loadPinnedItems(favorites.collectionId);
        }

        // Always refresh the sidebar collection items map
        await get().loadCollectionItems(favorites.collectionId);
      }

      // Refresh the collection tree to update item counts
      await get().loadCollectionTree();

      // Add to bookmarked verses cache
      set(state => ({
        bookmarkedVerses: new Set([...state.bookmarkedVerses, verseId]),
        loading: false
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Remove pinned item
  removeItem: async (pinId: number) => {
    set({ loading: true, error: null });
    try {
      // Find the item to get its collection ID and verse ID before removing
      const { pinnedItems, pinnedItemsByCollection } = get();
      const item = pinnedItems.find(i => i.pinId === pinId);

      // Also check in pinnedItemsByCollection map if not found in main list
      let itemToRemove = item;
      let collectionIdForItem: number | undefined = item?.collectionId;

      if (!itemToRemove && pinnedItemsByCollection.size > 0) {
        // Search through all collections to find the item
        for (const [collId, items] of pinnedItemsByCollection.entries()) {
          const foundItem = items.find(i => i.pinId === pinId);
          if (foundItem) {
            itemToRemove = foundItem;
            collectionIdForItem = collId;
            break;
          }
        }
      }

      await removePinnedItem(pinId);

      // Remove from local state (main pinnedItems)
      set(state => ({
        pinnedItems: state.pinnedItems.filter(i => i.pinId !== pinId),
        loading: false
      }));

      // Immediately update the pinnedItemsByCollection map to remove the item
      if (collectionIdForItem) {
        set(state => {
          const newMap = new Map(state.pinnedItemsByCollection);
          const currentItems = newMap.get(collectionIdForItem!) || [];
          newMap.set(
            collectionIdForItem!,
            currentItems.filter(i => i.pinId !== pinId)
          );
          return { pinnedItemsByCollection: newMap };
        });

        // Also refresh from backend to ensure consistency
        await get().loadCollectionItems(collectionIdForItem);
      }

      // Refresh the collection tree to update item counts
      await get().loadCollectionTree();

      // Update bookmarked verses cache
      if (itemToRemove?.verseIdStart) {
        await get().refreshBookmarkedVerses();
      }
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Remove verse from all collections
  removeVerseFromAllCollections: async (verseId: number) => {
    set({ loading: true, error: null });
    try {
      // Get collections containing this verse before removing
      const affectedCollections = await getCollectionsContainingVerse(verseId);

      await removeVerseBookmark(verseId);

      // Refresh current collection's items if selected
      const { selectedCollectionId } = get();
      if (selectedCollectionId) {
        await get().loadPinnedItems(selectedCollectionId);
      }

      // Refresh sidebar items for all affected collections
      for (const collection of affectedCollections) {
        if (collection.collectionId) {
          await get().loadCollectionItems(collection.collectionId);
        }
      }

      // Remove from bookmarked verses cache
      set(state => {
        const newSet = new Set(state.bookmarkedVerses);
        newSet.delete(verseId);
        return { bookmarkedVerses: newSet, loading: false };
      });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Move item to different collection
  moveItem: async (pinId: number, targetCollectionId: number) => {
    set({ loading: true, error: null });
    try {
      await movePinnedItemToCollection(pinId, targetCollectionId);

      // Refresh current collection's items
      const { selectedCollectionId } = get();
      if (selectedCollectionId) {
        await get().loadPinnedItems(selectedCollectionId);
      }

      set({ loading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Update pinned item
  updateItem: async (item: SerializedPinnedItem) => {
    set({ loading: true, error: null });
    try {
      const updated = await updatePinnedItem(item);

      // Update in local state
      set(state => ({
        pinnedItems: state.pinnedItems.map(i =>
          i.pinId === updated.pinId ? updated : i
        ),
        loading: false
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Bulk add verses
  bulkAddVerses: async (collectionId: number, verseIds: number[], moduleId?: number) => {
    set({ loading: true, error: null });
    try {
      await bulkAddVersesToCollection(collectionId, verseIds, moduleId);

      // Refresh items if this is the selected collection
      const { selectedCollectionId } = get();
      if (selectedCollectionId === collectionId) {
        await get().loadPinnedItems(collectionId);
      }

      // Add all to bookmarked verses cache
      set(state => ({
        bookmarkedVerses: new Set([...state.bookmarkedVerses, ...verseIds]),
        loading: false
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
      throw error;
    }
  },

  // Reorder items
  reorderItems: async (pinIds: number[]) => {
    try {
      await reorderPinnedItems(pinIds);

      // Refresh current collection's items
      const { selectedCollectionId } = get();
      if (selectedCollectionId) {
        await get().loadPinnedItems(selectedCollectionId);
      }
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  // Check if verse is bookmarked
  checkIfBookmarked: async (verseId: number) => {
    // First check cache
    const { bookmarkedVerses } = get();
    if (bookmarkedVerses.has(verseId)) {
      return true;
    }

    // Query backend if not in cache
    try {
      const isBookmarked = await isVerseBookmarked(verseId);

      // Update cache
      if (isBookmarked) {
        set(state => ({
          bookmarkedVerses: new Set([...state.bookmarkedVerses, verseId])
        }));
      }

      return isBookmarked;
    } catch (error: unknown) {
      console.error('Failed to check bookmark status:', error);
      return false;
    }
  },

  // Get collections containing a verse
  getCollectionsForVerse: async (verseId: number) => {
    try {
      return await getCollectionsContainingVerse(verseId);
    } catch (error: unknown) {
      console.error('Failed to get collections for verse:', error);
      set({ error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  },

  // Refresh bookmarked verses cache
  refreshBookmarkedVerses: async () => {
    try {
      // Prefer the flat list once it has loaded. Rebuilding from
      // `pinnedItems` - which only the (unmounted) collection tree ever fills
      // - emptied the cache the gutter markers read from, so a bookmark
      // vanished from the margin the moment anything called through here.
      const { bookmarks, bookmarksLoaded, pinnedItems } = get();
      if (bookmarksLoaded) {
        set({ bookmarkedVerses: markedVerses(bookmarks) });
        return;
      }

      set({ bookmarkedVerses: markedVerses(pinnedItems) });
    } catch (error: unknown) {
      console.error('Failed to refresh bookmarked verses:', error);
    }
  },

  // UI actions
  setViewMode: (mode: 'flat' | 'tree') => {
    set({ viewMode: mode });
  },

  toggleEmptyCollections: () => {
    set(state => ({ showEmptyCollections: !state.showEmptyCollections }));
  },

  setError: (error: string | null) => {
    set({ error });
  }
}));

// Cross-store when-context publishing (selectedVerseIsBookmarked) lives in
// `storeSync.ts` so this store stays free of imports from other stores.
