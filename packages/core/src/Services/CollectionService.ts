import { ICollectionRepository } from '../Data/Repositories/ICollectionRepository';
import { IBibleBookRepository } from '../Data/Repositories/IBibleBookRepository';
import { Collection, PinnedItem } from '../Data/Models/User/Collection';
import { VerseIdHelper } from '../Data/Core/Types';

/**
 * Service for managing collections (folders of bookmarked verses/passages).
 *
 * Provides higher-level operations on top of the collection repository,
 * including automatic "Favorites" collection creation, duplicate detection,
 * circular reference prevention, and human-readable reference formatting.
 *
 * @example
 * ```typescript
 * const service = new CollectionService(collectionRepo, bibleBookRepo);
 *
 * // Quick-bookmark a verse to Favorites
 * await service.quickBookmarkVerse(43003016); // John 3:16
 *
 * // Create a custom collection and add verses
 * const collectionId = service.createCollection("Sermon Notes", undefined, "#FF5733");
 * service.addVerseToCollection(collectionId, 45008028); // Romans 8:28
 * ```
 */
export class CollectionService {
  constructor(
    private collectionRepo: ICollectionRepository,
    private bibleBookRepo: IBibleBookRepository
  ) {}

  // ===== Quick Bookmark Operations =====

  /**
   * Quick-bookmark a single verse to the default "Favorites" collection.
   * Creates the Favorites collection automatically if it does not yet exist.
   *
   * @param verseId - The calculated verse ID (e.g., 43003016 for John 3:16)
   * @param moduleId - Optional module ID to associate the bookmark with a specific Bible translation
   * @param title - Optional display title; if omitted, the formatted reference is used
   * @returns The newly created pinned item ID
   */
  async quickBookmarkVerse(
    verseId: number,
    moduleId?: number,
    title?: string
  ): Promise<number> {
    const favorites = this.getOrCreateFavorites();

    const item = new PinnedItem({
      collectionId: favorites.collectionId,
      itemType: 'verse',
      verseIdStart: verseId,
      referenceText: this.formatVerseReference(verseId),
      moduleId,
      title,
      sortOrder: 0
    });

    return this.collectionRepo.addPinnedItem(item);
  }

  /**
   * Quick-bookmark a passage (range of verses) to the default "Favorites" collection.
   * Creates the Favorites collection automatically if it does not yet exist.
   *
   * @param verseIdStart - Starting verse ID of the passage
   * @param verseIdEnd - Ending verse ID of the passage
   * @param moduleId - Optional module ID for a specific Bible translation
   * @param title - Optional display title
   * @returns The newly created pinned item ID
   */
  async quickBookmarkPassage(
    verseIdStart: number,
    verseIdEnd: number,
    moduleId?: number,
    title?: string
  ): Promise<number> {
    const favorites = this.getOrCreateFavorites();

    const item = new PinnedItem({
      collectionId: favorites.collectionId,
      itemType: 'passage',
      verseIdStart,
      verseIdEnd,
      referenceText: this.formatPassageReference(verseIdStart, verseIdEnd),
      moduleId,
      title,
      sortOrder: 0
    });

    return this.collectionRepo.addPinnedItem(item);
  }

  /**
   * Remove a verse bookmark from all collections
   */
  removeVerseBookmark(verseId: number): void {
    const pinnedItems = this.collectionRepo.getPinnedItemsByVerse(verseId);
    pinnedItems.forEach(item => {
      if (item.pinId) {
        this.collectionRepo.deletePinnedItem(item.pinId);
      }
    });
  }

  /**
   * Check if a verse is bookmarked in any collection
   */
  isVerseBookmarked(verseId: number): boolean {
    return this.collectionRepo.isVerseBookmarked(verseId);
  }

  // ===== Collection Management =====

  /**
   * Create a new collection with validation.
   *
   * Validates the name is non-empty, checks for circular parent references,
   * and automatically assigns the next sort order among siblings.
   *
   * @param name - Collection name (will be trimmed)
   * @param parentId - Optional parent collection ID for nesting
   * @param color - Optional hex color code for UI display (e.g., "#FF5733")
   * @param icon - Optional emoji or icon identifier
   * @param description - Optional description text
   * @returns The newly created collection ID
   * @throws Error if name is empty or parentId creates a circular reference
   */
  createCollection(
    name: string,
    parentId?: number,
    color?: string,
    icon?: string,
    description?: string
  ): number {
    // Validate name
    if (!name || name.trim().length === 0) {
      throw new Error('Collection name cannot be empty');
    }

    // Check for circular parent reference if parentId is provided
    if (parentId) {
      this.validateNoCircularReference(parentId, parentId);
    }

    // Get next sort order
    const siblings = parentId
      ? this.collectionRepo.getChildren(parentId)
      : this.collectionRepo.getTopLevel();
    const sortOrder = siblings.length;

    const collection = new Collection({
      name: name.trim(),
      parentCollectionId: parentId,
      color,
      icon,
      description,
      sortOrder
    });

    return this.collectionRepo.create(collection);
  }

  /**
   * Update collection with validation
   */
  updateCollection(collection: Collection): void {
    if (!collection.collectionId) {
      throw new Error('Cannot update collection without ID');
    }

    // Check for circular reference if changing parent
    if (collection.parentCollectionId) {
      this.validateNoCircularReference(
        collection.collectionId,
        collection.parentCollectionId
      );
    }

    this.collectionRepo.update(collection);
  }

  /**
   * Delete a collection (will cascade delete all pinned items)
   */
  deleteCollection(collectionId: number): void {
    // Prevent deleting the default Favorites collection
    const collection = this.collectionRepo.getById(collectionId);
    if (collection?.name === 'Favorites' && collection?.icon === '⭐') {
      throw new Error('Cannot delete the default Favorites collection');
    }

    this.collectionRepo.delete(collectionId);
  }

  /**
   * Get or create the default "Favorites" collection
   */
  getOrCreateFavorites(): Collection {
    const all = this.collectionRepo.getAll();
    const favorites = all.find(c => c.name === 'Favorites' && c.icon === '⭐');

    if (favorites && favorites.collectionId) {
      return favorites;
    }

    // Create favorites collection
    const collectionId = this.collectionRepo.create(
      new Collection({
        name: 'Favorites',
        description: 'My favorite verses',
        color: '#FFD700',
        icon: '⭐',
        sortOrder: 0
      })
    );

    const created = this.collectionRepo.getById(collectionId);
    if (!created) {
      throw new Error('Failed to create Favorites collection');
    }

    return created;
  }

  /**
   * Get the full collection tree with item counts
   */
  getCollectionTreeWithCounts(): Collection[] {
    const tree = this.collectionRepo.getCollectionTree();

    // Add item counts to each collection
    const addCounts = (collections: Collection[]): Collection[] => {
      return collections.map(collection => {
        if (collection.collectionId) {
          const count = this.collectionRepo.getCollectionItemCount(
            collection.collectionId
          );
          // Store count in metadata
          collection.metadata = {
            ...collection.metadata,
            itemCount: count
          };

          // Recursively add counts to children
          if (collection.hasChildren()) {
            const children = collection.getChildren();
            collection['childCollections'] = addCounts(children);
          }
        }
        return collection;
      });
    };

    return addCounts(tree);
  }

  // ===== Pinned Item Management =====

  /**
   * Add a verse to a specific collection.
   * Prevents duplicate entries (same verse + module) in the same collection.
   *
   * @param collectionId - Target collection ID
   * @param verseId - The calculated verse ID to add
   * @param moduleId - Optional module ID to scope the bookmark to a translation
   * @param title - Optional display title
   * @param notes - Optional notes to attach to the bookmarked verse
   * @returns The newly created pinned item ID
   * @throws Error if the verse is already in this collection with the same moduleId
   */
  addVerseToCollection(
    collectionId: number,
    verseId: number,
    moduleId?: number,
    title?: string,
    notes?: string
  ): number {
    // Check for duplicates
    const existing = this.collectionRepo.getPinnedItemsForCollection(collectionId);
    const duplicate = existing.find(
      item =>
        item.itemType === 'verse' &&
        item.verseIdStart === verseId &&
        item.moduleId === moduleId
    );

    if (duplicate) {
      throw new Error('This verse is already in this collection');
    }

    // Get sort order (add to end)
    const sortOrder = existing.length;

    const item = new PinnedItem({
      collectionId,
      itemType: 'verse',
      verseIdStart: verseId,
      referenceText: this.formatVerseReference(verseId),
      moduleId,
      title,
      notes,
      sortOrder
    });

    return this.collectionRepo.addPinnedItem(item);
  }

  /**
   * Add a passage to a collection
   */
  addPassageToCollection(
    collectionId: number,
    verseIdStart: number,
    verseIdEnd: number,
    moduleId?: number,
    title?: string,
    notes?: string
  ): number {
    // Get sort order (add to end)
    const existing = this.collectionRepo.getPinnedItemsForCollection(collectionId);
    const sortOrder = existing.length;

    const item = new PinnedItem({
      collectionId,
      itemType: 'passage',
      verseIdStart,
      verseIdEnd,
      referenceText: this.formatPassageReference(verseIdStart, verseIdEnd),
      moduleId,
      title,
      notes,
      sortOrder
    });

    return this.collectionRepo.addPinnedItem(item);
  }

  /**
   * Bulk-add multiple verses to a collection, silently skipping duplicates.
   *
   * @param collectionId - Target collection ID
   * @param verseIds - Array of verse IDs to add
   * @param moduleId - Optional module ID applied to all bookmarks
   * @returns Array of pinned item IDs for successfully added verses
   */
  bulkAddVersesToCollection(
    collectionId: number,
    verseIds: number[],
    moduleId?: number
  ): number[] {
    const pinIds: number[] = [];

    for (const verseId of verseIds) {
      try {
        const pinId = this.addVerseToCollection(collectionId, verseId, moduleId);
        pinIds.push(pinId);
      } catch (error) {
        // Skip duplicates
        console.warn(`Skipped duplicate verse ${verseId}:`, error);
      }
    }

    return pinIds;
  }

  /**
   * Move pinned item to different collection
   */
  moveToCollection(pinId: number, targetCollectionId: number): void {
    const item = this.collectionRepo.getPinnedItem(pinId);
    if (!item) {
      throw new Error('Pinned item not found');
    }

    item.collectionId = targetCollectionId;

    // Update sort order to add at end
    const existing = this.collectionRepo.getPinnedItemsForCollection(
      targetCollectionId
    );
    item.sortOrder = existing.length;

    this.collectionRepo.updatePinnedItem(item);
  }

  // ===== Utility Methods =====

  /**
   * Format a verse reference for display (e.g., "John 3:16")
   */
  formatVerseReference(verseId: number): string {
    const parsed = VerseIdHelper.parse(verseId);
    const book = this.bibleBookRepo.getByBookNumber(parsed.bookNumber);

    if (!book) {
      return `Book ${parsed.bookNumber}:${parsed.chapter}:${parsed.verse}`;
    }

    return `${book.bookName} ${parsed.chapter}:${parsed.verse}`;
  }

  /**
   * Format a passage reference (e.g., "Romans 8:28-39")
   */
  formatPassageReference(verseIdStart: number, verseIdEnd: number): string {
    const start = VerseIdHelper.parse(verseIdStart);
    const end = VerseIdHelper.parse(verseIdEnd);
    const book = this.bibleBookRepo.getByBookNumber(start.bookNumber);

    if (!book) {
      return `Book ${start.bookNumber}:${start.chapter}:${start.verse}-${end.verse}`;
    }

    // Same chapter
    if (start.bookNumber === end.bookNumber && start.chapter === end.chapter) {
      return `${book.bookName} ${start.chapter}:${start.verse}-${end.verse}`;
    }

    // Different chapters
    return `${book.bookName} ${start.chapter}:${start.verse} - ${end.chapter}:${end.verse}`;
  }

  /**
   * Validate no circular parent references
   */
  private validateNoCircularReference(
    collectionId: number,
    parentId: number
  ): void {
    if (collectionId === parentId) {
      throw new Error('Collection cannot be its own parent');
    }

    // Walk up the parent chain to check for cycles
    let currentId: number | undefined = parentId;
    const visited = new Set<number>([collectionId]);

    while (currentId) {
      if (visited.has(currentId)) {
        throw new Error('Circular parent reference detected');
      }

      visited.add(currentId);
      const parent = this.collectionRepo.getById(currentId);
      currentId = parent?.parentCollectionId;
    }
  }

  // ===== Default Collections Setup =====

  /**
   * Initialize default collections on first run
   */
  initializeDefaultCollections(): void {
    const existing = this.collectionRepo.getAll();

    // Create Favorites if it doesn't exist
    if (!existing.find(c => c.name === 'Favorites' && c.icon === '⭐')) {
      this.collectionRepo.create(
        new Collection({
          name: 'Favorites',
          description: 'My favorite verses',
          color: '#FFD700',
          icon: '⭐',
          sortOrder: 0
        })
      );
    }

    // Create "To Study" if it doesn't exist
    if (!existing.find(c => c.name === 'To Study')) {
      this.collectionRepo.create(
        new Collection({
          name: 'To Study',
          description: 'Verses to study later',
          color: '#4A90E2',
          icon: '📝',
          sortOrder: 1
        })
      );
    }
  }
}
