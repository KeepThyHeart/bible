import { Collection, PinnedItem } from '../Models/User/Collection';

/**
 * Repository interface for managing Collections and Pinned Items
 * Collections are user-created organizational containers (like bookmarks/folders)
 */
export interface ICollectionRepository {
  // ===== Collection CRUD Operations =====

  /**
   * Create a new collection
   * @returns The ID of the newly created collection
   */
  create(collection: Collection): number;

  /**
   * Update an existing collection
   */
  update(collection: Collection): void;

  /**
   * Delete a collection and all its pinned items
   * (CASCADE delete from database)
   */
  delete(collectionId: number): void;

  /**
   * Get a collection by ID
   */
  getById(collectionId: number): Collection | undefined;

  /**
   * Get all collections (flat list)
   */
  getAll(): Collection[];

  /**
   * Get only top-level collections (parent_collection_id IS NULL)
   */
  getTopLevel(): Collection[];

  /**
   * Get child collections of a parent
   */
  getChildren(parentId: number): Collection[];

  /**
   * Get a hierarchical tree of all collections
   * (Collections with child collections populated)
   */
  getCollectionTree(): Collection[];

  // ===== Pinned Item Operations =====

  /**
   * Add a pinned item to a collection
   * @returns The ID of the newly created pinned item
   */
  addPinnedItem(item: PinnedItem): number;

  /**
   * Update an existing pinned item
   */
  updatePinnedItem(item: PinnedItem): void;

  /**
   * Delete a pinned item
   */
  deletePinnedItem(pinId: number): void;

  /**
   * Get a single pinned item by ID
   */
  getPinnedItem(pinId: number): PinnedItem | undefined;

  /**
   * Get all pinned items for a specific collection
   * @returns Pinned items sorted by sort_order
   */
  getPinnedItemsForCollection(collectionId: number): PinnedItem[];

  /**
   * Get all pinned items that reference a specific verse
   * (Useful for checking if a verse is bookmarked)
   */
  getPinnedItemsByVerse(verseId: number): PinnedItem[];

  // ===== Search & Query Operations =====

  /**
   * Find collections by name (case-insensitive search)
   */
  findCollectionsByName(searchTerm: string): Collection[];

  /**
   * Get all collections that contain a specific verse
   * @returns Collections that have a pinned item referencing this verse
   */
  getCollectionsContainingVerse(verseId: number): Collection[];

  /**
   * Check if a verse is pinned in any collection
   */
  isVerseBookmarked(verseId: number): boolean;

  /**
   * Get the total count of pinned items in a collection
   */
  getCollectionItemCount(collectionId: number): number;

  // ===== Bulk Operations =====

  /**
   * Move a collection to a different parent
   * @param collectionId The collection to move
   * @param newParentId The new parent (null for top-level)
   */
  moveCollection(collectionId: number, newParentId: number | null): void;

  /**
   * Reorder collections within the same parent
   * @param collectionIds Array of collection IDs in desired order
   */
  reorderCollections(collectionIds: number[]): void;

  /**
   * Reorder pinned items within a collection
   * @param pinIds Array of pin IDs in desired order
   */
  reorderPinnedItems(pinIds: number[]): void;
}
