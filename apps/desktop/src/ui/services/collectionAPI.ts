/**
 * Collection and Bookmark API.
 *
 * Uses the `Result<T>` envelope convention. Each
 * call goes through `unwrap` which converts an `{ ok: false, error }` envelope
 * into a thrown `IpcResultError`.
 */

import { unwrap } from './ipcResult';

export interface SerializedCollection {
  collectionId?: number;
  parentCollectionId?: number;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  createdDate?: string;
  modifiedDate?: string;
  sortOrder: number;
  metadata?: any;
  children?: SerializedCollection[];
}

export interface SerializedPinnedItem {
  pinId?: number;
  collectionId?: number;
  itemType: 'verse' | 'passage' | 'note' | 'commentary' | 'dictionary_entry' | 'book_section' | 'image';
  verseIdStart?: number;
  verseIdEnd?: number;
  referenceId?: number;
  referenceText?: string;
  moduleId?: number;
  title?: string;
  notes?: string;
  createdDate?: string;
  sortOrder: number;
  metadata?: any;
}

const invoke: typeof window.electron.ipcRenderer.invoke = (channel, ...args) =>
  window.electron.ipcRenderer.invoke(channel, ...args);

// Collection operations
export async function getAllCollections(): Promise<SerializedCollection[]> {
  return unwrap<SerializedCollection[]>(invoke('collection:get-all'));
}

export async function getCollectionTree(): Promise<SerializedCollection[]> {
  return unwrap<SerializedCollection[]>(invoke('collection:get-tree'));
}

export async function getCollectionById(collectionId: number): Promise<SerializedCollection | null> {
  return unwrap<SerializedCollection | null>(invoke('collection:get-by-id', collectionId));
}

export async function getTopLevelCollections(): Promise<SerializedCollection[]> {
  return unwrap<SerializedCollection[]>(invoke('collection:get-top-level'));
}

export async function getChildCollections(parentId: number): Promise<SerializedCollection[]> {
  return unwrap<SerializedCollection[]>(invoke('collection:get-children', parentId));
}

export async function createCollection(data: Partial<SerializedCollection>): Promise<SerializedCollection> {
  return unwrap<SerializedCollection>(invoke('collection:create', data));
}

export async function updateCollection(collection: SerializedCollection): Promise<SerializedCollection> {
  return unwrap<SerializedCollection>(invoke('collection:update', collection));
}

export async function deleteCollection(collectionId: number): Promise<void> {
  await unwrap<void>(invoke('collection:delete', collectionId));
}

export async function moveCollection(collectionId: number, newParentId: number | null): Promise<void> {
  await unwrap<void>(invoke('collection:move', collectionId, newParentId));
}

export async function searchCollections(searchTerm: string): Promise<SerializedCollection[]> {
  return unwrap<SerializedCollection[]>(invoke('collection:search', searchTerm));
}

// Pinned item operations
export async function getPinnedItemsForCollection(collectionId: number): Promise<SerializedPinnedItem[]> {
  return unwrap<SerializedPinnedItem[]>(invoke('collection:get-items', collectionId));
}

export async function addVerseToCollection(
  collectionId: number,
  verseId: number,
  moduleId?: number,
  title?: string,
  notes?: string
): Promise<SerializedPinnedItem> {
  return unwrap<SerializedPinnedItem>(
    invoke('collection:add-verse', collectionId, verseId, moduleId, title, notes)
  );
}

export async function addPassageToCollection(
  collectionId: number,
  verseIdStart: number,
  verseIdEnd: number,
  moduleId?: number,
  title?: string,
  notes?: string
): Promise<SerializedPinnedItem> {
  return unwrap<SerializedPinnedItem>(
    invoke(
      'collection:add-passage',
      collectionId,
      verseIdStart,
      verseIdEnd,
      moduleId,
      title,
      notes
    )
  );
}

export async function quickBookmarkVerse(
  verseId: number,
  moduleId?: number,
  title?: string
): Promise<SerializedPinnedItem> {
  return unwrap<SerializedPinnedItem>(
    invoke('collection:quick-bookmark', verseId, moduleId, title)
  );
}

// Flat bookmark operations - the surface the v1 bookmarks UI uses. Everything
// above is the tree-shaped API kept for extensions.

/** Every bookmark in the default collection, in the user's manual order. */
export async function getBookmarks(): Promise<SerializedPinnedItem[]> {
  return unwrap<SerializedPinnedItem[]>(invoke('collection:get-bookmarks'));
}

export async function bookmarkPassage(
  verseIdStart: number,
  verseIdEnd: number,
  moduleId?: number,
  title?: string
): Promise<SerializedPinnedItem> {
  return unwrap<SerializedPinnedItem>(
    invoke('collection:bookmark-passage', verseIdStart, verseIdEnd, moduleId, title)
  );
}

/**
 * Re-point an existing bookmark at a different verse or passage, leaving any
 * custom title in place.
 */
export async function replaceBookmarkReference(
  pinId: number,
  verseIdStart: number,
  verseIdEnd?: number
): Promise<SerializedPinnedItem> {
  return unwrap<SerializedPinnedItem>(
    invoke('collection:replace-bookmark-reference', pinId, verseIdStart, verseIdEnd)
  );
}

/** Name a bookmark, or pass `undefined` to clear it back to its reference. */
export async function renameBookmark(
  pinId: number,
  title?: string
): Promise<SerializedPinnedItem> {
  return unwrap<SerializedPinnedItem>(invoke('collection:rename-bookmark', pinId, title));
}

export async function removePinnedItem(pinId: number): Promise<void> {
  await unwrap<void>(invoke('collection:remove-item', pinId));
}

export async function removeVerseBookmark(verseId: number): Promise<void> {
  await unwrap<void>(invoke('collection:remove-verse-bookmark', verseId));
}

export async function isVerseBookmarked(verseId: number): Promise<boolean> {
  return unwrap<boolean>(invoke('collection:is-verse-bookmarked', verseId));
}

export async function getCollectionsContainingVerse(verseId: number): Promise<SerializedCollection[]> {
  return unwrap<SerializedCollection[]>(invoke('collection:get-containing-verse', verseId));
}

export async function movePinnedItemToCollection(pinId: number, targetCollectionId: number): Promise<void> {
  await unwrap<void>(invoke('collection:move-item', pinId, targetCollectionId));
}

export async function updatePinnedItem(item: SerializedPinnedItem): Promise<SerializedPinnedItem> {
  return unwrap<SerializedPinnedItem>(invoke('collection:update-item', item));
}

export async function bulkAddVersesToCollection(
  collectionId: number,
  verseIds: number[],
  moduleId?: number
): Promise<number[]> {
  return unwrap<number[]>(
    invoke('collection:bulk-add-verses', collectionId, verseIds, moduleId)
  );
}

export async function reorderCollections(collectionIds: number[]): Promise<void> {
  await unwrap<void>(invoke('collection:reorder', collectionIds));
}

export async function reorderPinnedItems(pinIds: number[]): Promise<void> {
  await unwrap<void>(invoke('collection:reorder-items', pinIds));
}
