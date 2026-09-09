import { ICollectionRepository } from '../Data/Repositories/ICollectionRepository';
import { IBibleBookRepository } from '../Data/Repositories/IBibleBookRepository';
import { Collection, PinnedItem } from '../Data/Models/User/Collection';
import { VerseIdHelper } from '../Data/Core/Types';

/**
 * Metadata key marking the one collection the flat bookmark surface reads and
 * writes.
 *
 * The default collection is identified by this flag and never by its name or
 * icon. A name match breaks the moment the user renames the collection, or a
 * localized build ships it under a translated name -- and it breaks silently,
 * because the lookup then misses the collection the user's bookmarks are
 * actually in and creates a second default beside it.
 *
 * The flag lives in `collection.metadata`, which the schema and repository
 * already carried, so adopting it needed no migration.
 */
const DEFAULT_BOOKMARKS_FLAG = 'isDefaultBookmarks';

/** Name and icon the pre-flag default collection was created with. */
const LEGACY_DEFAULT_NAME = 'Favorites';
const LEGACY_DEFAULT_ICON = '⭐';

/**
 * Service for managing collections (folders of bookmarked verses/passages).
 *
 * Provides higher-level operations on top of the collection repository,
 * including automatic default-collection creation, duplicate detection,
 * circular reference prevention, and human-readable reference formatting.
 *
 * Two surfaces sit side by side here:
 *
 * - The **collection/tree API** -- create, nest, move, and fill collections of
 *   your own. This is what the extension API is written against.
 * - The **flat bookmark API** -- {@link CollectionService.getBookmarks},
 *   {@link CollectionService.replaceBookmarkReference} and
 *   {@link CollectionService.renameBookmark}, plus the quick-bookmark methods.
 *   These all operate on the single default collection, which is how the app UI
 *   presents bookmarks: one list, no folders.
 *
 * @example
 * ```typescript
 * const service = new CollectionService(collectionRepo, bibleBookRepo);
 *
 * // Quick-bookmark a verse to the default collection
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
   * Quick-bookmark a single verse to the default collection.
   * Creates the default collection automatically if it does not yet exist.
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
    const target = this.getOrCreateDefaultCollection();

    const item = new PinnedItem({
      collectionId: target.collectionId,
      itemType: 'verse',
      verseIdStart: verseId,
      referenceText: this.formatVerseReference(verseId),
      moduleId,
      title,
      sortOrder: this.nextSortOrder(target.collectionId!)
    });

    return this.collectionRepo.addPinnedItem(item);
  }

  /**
   * Quick-bookmark a passage (range of verses) to the default collection.
   * Creates the default collection automatically if it does not yet exist.
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
    const target = this.getOrCreateDefaultCollection();

    const item = new PinnedItem({
      collectionId: target.collectionId,
      itemType: 'passage',
      verseIdStart,
      verseIdEnd,
      referenceText: this.formatPassageReference(verseIdStart, verseIdEnd),
      moduleId,
      title,
      sortOrder: this.nextSortOrder(target.collectionId!)
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

  // ===== Flat Bookmark Operations =====
  //
  // The app UI shows bookmarks as one flat, manually ordered list drawn from
  // the default collection. These methods are that list's whole vocabulary;
  // the collection/tree API below is what extensions address.

  /**
   * Every bookmark in the default collection, in the user's manual order.
   *
   * A read, so it never creates the default collection: a user who has not
   * bookmarked anything yet has no bookmarks and no collection to hold them,
   * and gets an empty list rather than an empty folder written to their
   * database. It will, however, adopt a legacy collection if one is there --
   * see {@link findDefaultCollection}.
   */
  getBookmarks(): PinnedItem[] {
    const target = this.findDefaultCollection();
    if (!target?.collectionId) {
      return [];
    }

    return this.collectionRepo.getPinnedItemsForCollection(target.collectionId);
  }

  /**
   * Re-point an existing bookmark at a different verse or passage.
   *
   * The title is deliberately left exactly as it is. A bookmark's title is the
   * user's name for it, not a cached copy of its reference: someone who named a
   * bookmark "Memorize this week" and then corrected the verse it points at
   * wants the name to survive the correction. The generated reference text is
   * refreshed instead, since that one *is* derived from the reference. To clear
   * or change a name, call {@link renameBookmark} -- that is the only method
   * that writes a title.
   *
   * Passing `verseIdEnd` (different from `verseIdStart`) turns the bookmark into
   * a passage; omitting it turns it back into a single verse.
   *
   * @param pinId - The pinned item to re-point
   * @param verseIdStart - New starting verse ID
   * @param verseIdEnd - New ending verse ID for a passage; omit for a single verse
   * @throws Error if the pinned item does not exist
   */
  replaceBookmarkReference(
    pinId: number,
    verseIdStart: number,
    verseIdEnd?: number
  ): void {
    const item = this.collectionRepo.getPinnedItem(pinId);
    if (!item) {
      throw new Error('Pinned item not found');
    }

    const isPassage = verseIdEnd !== undefined && verseIdEnd !== verseIdStart;

    item.itemType = isPassage ? 'passage' : 'verse';
    item.verseIdStart = verseIdStart;
    item.verseIdEnd = isPassage ? verseIdEnd : undefined;
    item.referenceText = isPassage
      ? this.formatPassageReference(verseIdStart, verseIdEnd!)
      : this.formatVerseReference(verseIdStart);

    this.collectionRepo.updatePinnedItem(item);
  }

  /**
   * Name a bookmark, or clear its name back to its reference.
   *
   * A blank or whitespace-only title is stored as no title at all, so the UI
   * falls back to the formatted reference rather than showing an empty row.
   * This is the mirror of {@link replaceBookmarkReference}: that one moves the
   * reference and leaves the name, this one changes the name and leaves the
   * reference.
   *
   * @param pinId - The pinned item to rename
   * @param title - New display title; omit or pass blank to clear it
   * @throws Error if the pinned item does not exist
   */
  renameBookmark(pinId: number, title?: string): void {
    const item = this.collectionRepo.getPinnedItem(pinId);
    if (!item) {
      throw new Error('Pinned item not found');
    }

    const trimmed = title?.trim();
    item.title = trimmed ? trimmed : undefined;

    this.collectionRepo.updatePinnedItem(item);
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
    // Prevent deleting the default collection -- it is where every quick
    // bookmark lands, so deleting it would strand the flat bookmark UI.
    const collection = this.collectionRepo.getById(collectionId);
    if (collection && this.isDefaultCollection(collection)) {
      throw new Error('Cannot delete the default Favorites collection');
    }

    this.collectionRepo.delete(collectionId);
  }

  /**
   * Get or create the default bookmarks collection.
   *
   * Resolution order: the collection carrying the {@link DEFAULT_BOOKMARKS_FLAG}
   * flag; failing that, a legacy "Favorites" collection, which is adopted in
   * place; failing that, a freshly created one.
   */
  getOrCreateDefaultCollection(): Collection {
    const existing = this.findDefaultCollection();
    if (existing) {
      return existing;
    }

    const collectionId = this.collectionRepo.create(
      new Collection({
        name: LEGACY_DEFAULT_NAME,
        description: 'My favorite verses',
        color: '#FFD700',
        icon: LEGACY_DEFAULT_ICON,
        sortOrder: 0,
        metadata: { [DEFAULT_BOOKMARKS_FLAG]: true }
      })
    );

    const created = this.collectionRepo.getById(collectionId);
    if (!created) {
      throw new Error('Failed to create the default bookmarks collection');
    }

    return created;
  }

  /**
   * Get or create the default bookmarks collection.
   *
   * @deprecated Use {@link getOrCreateDefaultCollection}. The default collection
   * is not identified by the name "Favorites", so this name misleads; it is kept
   * only because extensions compile against it.
   */
  getOrCreateFavorites(): Collection {
    return this.getOrCreateDefaultCollection();
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

    const item = new PinnedItem({
      collectionId,
      itemType: 'verse',
      verseIdStart: verseId,
      referenceText: this.formatVerseReference(verseId),
      moduleId,
      title,
      notes,
      sortOrder: this.nextSortOrder(collectionId)
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
    const item = new PinnedItem({
      collectionId,
      itemType: 'passage',
      verseIdStart,
      verseIdEnd,
      referenceText: this.formatPassageReference(verseIdStart, verseIdEnd),
      moduleId,
      title,
      notes,
      sortOrder: this.nextSortOrder(collectionId)
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
    item.sortOrder = this.nextSortOrder(targetCollectionId);

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
   * Next sort rank for an item appended to a collection: one past the highest
   * rank in use, not the number of items already there.
   *
   * The two agree only while nothing has ever been removed. Three items ranked
   * 0, 1, 2; delete the middle one and the count is 2 -- which is the rank the
   * last item still holds, so the appended item ties with it and the two swap
   * places arbitrarily from one read to the next. The old code took the count,
   * which was invisible while nothing displayed the order and became a visible
   * shuffle once the bookmark list became manually ordered.
   */
  private nextSortOrder(collectionId: number): number {
    const existing = this.collectionRepo.getPinnedItemsForCollection(collectionId);

    return existing.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1;
  }

  /**
   * Is this the collection the flat bookmark surface reads and writes?
   *
   * Answered by the flag alone -- never by name or icon, which the user is free
   * to change.
   */
  private isDefaultCollection(collection: Collection): boolean {
    return collection.metadata?.[DEFAULT_BOOKMARKS_FLAG] === true;
  }

  /**
   * Find the default bookmarks collection without creating one.
   *
   * If no collection carries the flag but a legacy "Favorites" one is present,
   * it is adopted: the flag is stamped onto it in place, keeping its name, icon
   * and every bookmark already in it. Adopting rather than creating is the whole
   * point -- a second default beside the first would leave the user's existing
   * bookmarks in a collection the UI no longer reads.
   */
  private findDefaultCollection(): Collection | undefined {
    const all = this.collectionRepo.getAll();

    const flagged = all.find(c => c.collectionId && this.isDefaultCollection(c));
    if (flagged) {
      return flagged;
    }

    const legacy = all.find(
      c =>
        c.collectionId &&
        c.name === LEGACY_DEFAULT_NAME &&
        c.icon === LEGACY_DEFAULT_ICON
    );
    if (!legacy) {
      return undefined;
    }

    legacy.metadata = { ...legacy.metadata, [DEFAULT_BOOKMARKS_FLAG]: true };
    this.collectionRepo.update(legacy);

    return legacy;
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
   * Initialize default collections on first run.
   *
   * Exactly one collection is seeded: the default bookmarks collection. Earlier
   * versions also seeded a "To Study" collection, which under a single-collection
   * UI would fill up with items the user has no way to see. An existing "To
   * Study" is left where it is -- it may well hold the user's verses, and the
   * extension API can still reach it.
   */
  initializeDefaultCollections(): void {
    this.getOrCreateDefaultCollection();
  }
}
