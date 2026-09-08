import { ISql, CollectionRepository } from '@bible/core';
import { BibleBookRepository } from '@bible/core';
import { CollectionService } from '@bible/core';
import { Collection, PinnedItem } from '@bible/core';
import { getSharedMainDb } from '../services/sharedMainDb';
import { initializeUserSchema } from '../schema/userSchema';
import { ipcHandler, IpcKnownError } from './handler-helper';

// Singleton instances
let collectionRepo: CollectionRepository | null = null;
let collectionService: CollectionService | null = null;

/**
 * Initialize the collection service
 * Call this on app startup
 */
export function initializeCollectionService(userDb: ISql) {
  // Reuse the shared main.db connection rather than opening a second one -
  // all handlers that need main.db go through `getSharedMainDb()`.
  const mainDb = getSharedMainDb();

  // Ensure collection tables exist in user database
  ensureCollectionSchema(userDb);

  // Create repository and service
  collectionRepo = new CollectionRepository(userDb);

  const bibleBookRepo = new BibleBookRepository(mainDb);
  collectionService = new CollectionService(collectionRepo, bibleBookRepo);

  // Initialize default collections on first run
  collectionService.initializeDefaultCollections();

  console.log('Collection service initialized successfully');
}

/**
 * Ensure collection tables exist in user database (delegates to centralized schema)
 */
function ensureCollectionSchema(db: ISql): void {
  initializeUserSchema(db);
}

/**
 * Get collection service instance
 */
function getCollectionService(): CollectionService {
  if (!collectionService) {
    throw new IpcKnownError('unavailable', 'Collection service not initialized');
  }
  return collectionService;
}

/**
 * Get collection repository instance
 */
function getCollectionRepo(): CollectionRepository {
  if (!collectionRepo) {
    throw new IpcKnownError('unavailable', 'Collection repository not initialized');
  }
  return collectionRepo;
}

/**
 * Register all IPC handlers for collection operations.
 *
 * Uses the `Result<T>` envelope convention.
 * The renderer side lives in `src/ui/services/collectionAPI.ts` and uses
 * `unwrap` from `src/ui/services/ipcResult.ts`.
 */
export function registerCollectionHandlers() {
  // === Collection Operations ===

  ipcHandler<[], unknown[]>('collection:get-all', () => {
    const repo = getCollectionRepo();
    return repo.getAll().map(serializeCollection);
  });

  ipcHandler<[], unknown[]>('collection:get-tree', () => {
    const service = getCollectionService();
    return service.getCollectionTreeWithCounts().map(serializeCollection);
  });

  ipcHandler<[number], unknown | null>('collection:get-by-id', (collectionId) => {
    const repo = getCollectionRepo();
    const collection = repo.getById(collectionId);
    return collection ? serializeCollection(collection) : null;
  });

  ipcHandler<[], unknown[]>('collection:get-top-level', () => {
    const repo = getCollectionRepo();
    return repo.getTopLevel().map(serializeCollection);
  });

  ipcHandler<[number], unknown[]>('collection:get-children', (parentId) => {
    const repo = getCollectionRepo();
    return repo.getChildren(parentId).map(serializeCollection);
  });

  ipcHandler<[any], unknown | null>('collection:create', (data) => {
    const service = getCollectionService();
    const collectionId = service.createCollection(
      data.name,
      data.parentCollectionId,
      data.color,
      data.icon,
      data.description
    );
    const collection = getCollectionRepo().getById(collectionId);
    return collection ? serializeCollection(collection) : null;
  });

  ipcHandler<[any], unknown | null>('collection:update', (data) => {
    const service = getCollectionService();
    const collection = deserializeCollection(data);
    service.updateCollection(collection);
    const updated = getCollectionRepo().getById(collection.collectionId!);
    return updated ? serializeCollection(updated) : null;
  });

  ipcHandler<[number], void>('collection:delete', (collectionId) => {
    const service = getCollectionService();
    service.deleteCollection(collectionId);
  });

  ipcHandler<[number, number | null], void>('collection:move', (collectionId, newParentId) => {
    const repo = getCollectionRepo();
    repo.moveCollection(collectionId, newParentId);
  });

  ipcHandler<[string], unknown[]>('collection:search', (searchTerm) => {
    const repo = getCollectionRepo();
    return repo.findCollectionsByName(searchTerm).map(serializeCollection);
  });

  // === Pinned Item Operations ===

  ipcHandler<[number], unknown[]>('collection:get-items', (collectionId) => {
    const repo = getCollectionRepo();
    return repo.getPinnedItemsForCollection(collectionId).map(serializePinnedItem);
  });

  ipcHandler<
    [number, number, number | undefined, string | undefined, string | undefined],
    unknown | null
  >(
    'collection:add-verse',
    (collectionId, verseId, moduleId, title, notes) => {
      const service = getCollectionService();
      const pinId = service.addVerseToCollection(collectionId, verseId, moduleId, title, notes);
      const item = getCollectionRepo().getPinnedItem(pinId);
      return item ? serializePinnedItem(item) : null;
    }
  );

  ipcHandler<
    [number, number, number, number | undefined, string | undefined, string | undefined],
    unknown | null
  >(
    'collection:add-passage',
    (collectionId, verseIdStart, verseIdEnd, moduleId, title, notes) => {
      const service = getCollectionService();
      const pinId = service.addPassageToCollection(
        collectionId,
        verseIdStart,
        verseIdEnd,
        moduleId,
        title,
        notes
      );
      const item = getCollectionRepo().getPinnedItem(pinId);
      return item ? serializePinnedItem(item) : null;
    }
  );

  ipcHandler<[number, number | undefined, string | undefined], unknown | null>(
    'collection:quick-bookmark',
    async (verseId, moduleId, title) => {
      const service = getCollectionService();
      const pinId = await service.quickBookmarkVerse(verseId, moduleId, title);
      const item = getCollectionRepo().getPinnedItem(pinId);
      return item ? serializePinnedItem(item) : null;
    }
  );

  // === Flat Bookmark Operations (the v1 desktop UI's surface) ===
  //
  // The UI shows bookmarks as one flat list from the single default
  // collection. These four channels plus the existing `quick-bookmark`,
  // `remove-item`, `update-item`, `is-verse-bookmarked` and `reorder-items`
  // are all it needs; the tree-shaped channels above stay for the extension
  // API, which can still create and address collections of its own.

  ipcHandler<[], unknown[]>('collection:get-bookmarks', () => {
    const service = getCollectionService();
    return service.getBookmarks().map(serializePinnedItem);
  });

  ipcHandler<[number, number, number | undefined, string | undefined], unknown | null>(
    'collection:bookmark-passage',
    async (verseIdStart, verseIdEnd, moduleId, title) => {
      const service = getCollectionService();
      const pinId = await service.quickBookmarkPassage(
        verseIdStart,
        verseIdEnd,
        moduleId,
        title
      );
      const item = getCollectionRepo().getPinnedItem(pinId);
      return item ? serializePinnedItem(item) : null;
    }
  );

  ipcHandler<[number, number, number | undefined], unknown | null>(
    'collection:replace-bookmark-reference',
    (pinId, verseIdStart, verseIdEnd) => {
      const service = getCollectionService();
      service.replaceBookmarkReference(pinId, verseIdStart, verseIdEnd);
      const item = getCollectionRepo().getPinnedItem(pinId);
      return item ? serializePinnedItem(item) : null;
    }
  );

  ipcHandler<[number, string | undefined], unknown | null>(
    'collection:rename-bookmark',
    (pinId, title) => {
      const service = getCollectionService();
      service.renameBookmark(pinId, title);
      const item = getCollectionRepo().getPinnedItem(pinId);
      return item ? serializePinnedItem(item) : null;
    }
  );

  ipcHandler<[number], void>('collection:remove-item', (pinId) => {
    const repo = getCollectionRepo();
    repo.deletePinnedItem(pinId);
  });

  ipcHandler<[number], void>('collection:remove-verse-bookmark', (verseId) => {
    const service = getCollectionService();
    service.removeVerseBookmark(verseId);
  });

  ipcHandler<[number], boolean>('collection:is-verse-bookmarked', (verseId) => {
    const service = getCollectionService();
    return service.isVerseBookmarked(verseId);
  });

  ipcHandler<[number], unknown[]>('collection:get-containing-verse', (verseId) => {
    const repo = getCollectionRepo();
    return repo.getCollectionsContainingVerse(verseId).map(serializeCollection);
  });

  ipcHandler<[number, number], void>('collection:move-item', (pinId, targetCollectionId) => {
    const service = getCollectionService();
    service.moveToCollection(pinId, targetCollectionId);
  });

  ipcHandler<[any], unknown | null>('collection:update-item', (data) => {
    const repo = getCollectionRepo();
    const item = deserializePinnedItem(data);
    repo.updatePinnedItem(item);
    const updated = repo.getPinnedItem(item.pinId!);
    return updated ? serializePinnedItem(updated) : null;
  });

  ipcHandler<[number, number[], number | undefined], number[]>(
    'collection:bulk-add-verses',
    (collectionId, verseIds, moduleId) => {
      const service = getCollectionService();
      return service.bulkAddVersesToCollection(collectionId, verseIds, moduleId);
    }
  );

  ipcHandler<[number[]], void>('collection:reorder', (collectionIds) => {
    const repo = getCollectionRepo();
    repo.reorderCollections(collectionIds);
  });

  ipcHandler<[number[]], void>('collection:reorder-items', (pinIds) => {
    const repo = getCollectionRepo();
    repo.reorderPinnedItems(pinIds);
  });
}

/**
 * Serialize Collection for IPC transmission
 */
function serializeCollection(collection: Collection): any {
  return {
    collectionId: collection.collectionId,
    parentCollectionId: collection.parentCollectionId,
    name: collection.name,
    description: collection.description,
    color: collection.color,
    icon: collection.icon,
    createdDate: collection.createdDate,
    modifiedDate: collection.modifiedDate,
    sortOrder: collection.sortOrder,
    metadata: collection.metadata,
    children: collection.getChildren().map(serializeCollection)
  };
}

/**
 * Deserialize collection data to Collection instance
 */
function deserializeCollection(data: any): Collection {
  return new Collection({
    collectionId: data.collectionId,
    parentCollectionId: data.parentCollectionId,
    name: data.name,
    description: data.description,
    color: data.color,
    icon: data.icon,
    createdDate: data.createdDate,
    modifiedDate: data.modifiedDate,
    sortOrder: data.sortOrder,
    metadata: data.metadata
  });
}

/**
 * Serialize PinnedItem for IPC transmission
 */
function serializePinnedItem(item: PinnedItem): any {
  return {
    pinId: item.pinId,
    collectionId: item.collectionId,
    itemType: item.itemType,
    verseIdStart: item.verseIdStart,
    verseIdEnd: item.verseIdEnd,
    referenceId: item.referenceId,
    referenceText: item.referenceText,
    moduleId: item.moduleId,
    title: item.title,
    notes: item.notes,
    createdDate: item.createdDate,
    sortOrder: item.sortOrder,
    metadata: item.metadata
  };
}

/**
 * Deserialize pinned item data to PinnedItem instance
 */
function deserializePinnedItem(data: any): PinnedItem {
  return new PinnedItem({
    pinId: data.pinId,
    collectionId: data.collectionId,
    itemType: data.itemType,
    verseIdStart: data.verseIdStart,
    verseIdEnd: data.verseIdEnd,
    referenceId: data.referenceId,
    referenceText: data.referenceText,
    moduleId: data.moduleId,
    title: data.title,
    notes: data.notes,
    createdDate: data.createdDate,
    sortOrder: data.sortOrder,
    metadata: data.metadata
  });
}

/**
 * Close collection resources
 */
export function closeCollectionService() {
  collectionRepo = null;
  collectionService = null;
  // The main.db handle is owned by `sharedMainDb`; don't close it here.
}
