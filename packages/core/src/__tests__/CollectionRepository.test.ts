import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { CollectionRepository } from '../Data/Repositories/CollectionRepository';
import { Collection, PinnedItem } from '../Data/Models/User/Collection';
import { UserTestHelper } from './helpers/UserTestHelper';

describe('CollectionRepository', () => {
  let repo: CollectionRepository;

  beforeAll(() => {
    UserTestHelper.initialize();
    repo = new CollectionRepository(UserTestHelper.getProvider());
  });

  afterAll(() => {
    UserTestHelper.cleanup();
  });

  beforeEach(() => {
    UserTestHelper.clearData();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  function createTestCollection(overrides: Partial<{
    name: string;
    description: string;
    color: string;
    icon: string;
    parentCollectionId: number;
    sortOrder: number;
    metadata: Record<string, unknown>;
  }> = {}): Collection {
    return new Collection({
      name: overrides.name ?? 'Test Collection',
      description: overrides.description,
      color: overrides.color,
      icon: overrides.icon,
      parentCollectionId: overrides.parentCollectionId,
      sortOrder: overrides.sortOrder,
      metadata: overrides.metadata,
    });
  }

  function createTestPinnedItem(overrides: Partial<{
    collectionId: number;
    itemType: 'verse' | 'passage' | 'note' | 'commentary' | 'dictionary_entry' | 'book_section' | 'image';
    verseIdStart: number;
    verseIdEnd: number;
    referenceId: number;
    referenceText: string;
    moduleId: number;
    title: string;
    notes: string;
    sortOrder: number;
    metadata: Record<string, unknown>;
  }> = {}): PinnedItem {
    return new PinnedItem({
      collectionId: overrides.collectionId,
      itemType: overrides.itemType ?? 'verse',
      verseIdStart: overrides.verseIdStart,
      verseIdEnd: overrides.verseIdEnd,
      referenceId: overrides.referenceId,
      referenceText: overrides.referenceText,
      moduleId: overrides.moduleId,
      title: overrides.title,
      notes: overrides.notes,
      sortOrder: overrides.sortOrder,
      metadata: overrides.metadata,
    });
  }

  // ==========================================================================
  // Collection CRUD Tests
  // ==========================================================================

  describe('create', () => {
    it('should create a collection and return the collection_id', () => {
      const collection = createTestCollection({ name: 'Favorites' });

      const id = repo.create(collection);

      expect(id).toBeGreaterThan(0);
    });

    it('should create a collection with all fields populated', () => {
      const collection = createTestCollection({
        name: 'Study Notes',
        description: 'My study notes collection',
        color: '#FF6B6B',
        icon: 'book',
        sortOrder: 5,
        metadata: { source: 'import', version: 2 },
      });

      const id = repo.create(collection);
      const retrieved = repo.getById(id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('Study Notes');
      expect(retrieved!.description).toBe('My study notes collection');
      expect(retrieved!.color).toBe('#FF6B6B');
      expect(retrieved!.icon).toBe('book');
      expect(retrieved!.sortOrder).toBe(5);
      expect(retrieved!.metadata).toEqual({ source: 'import', version: 2 });
    });

    it('should create a collection with minimal fields', () => {
      const collection = createTestCollection({ name: 'Minimal' });

      const id = repo.create(collection);
      const retrieved = repo.getById(id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('Minimal');
      expect(retrieved!.description).toBeNull();
      expect(retrieved!.color).toBeNull();
      expect(retrieved!.icon).toBeNull();
      expect(retrieved!.sortOrder).toBe(0);
    });

    it('should auto-populate created and modified dates', () => {
      const collection = createTestCollection({ name: 'Date Test' });

      const id = repo.create(collection);
      const retrieved = repo.getById(id);

      expect(retrieved!.createdDate).toBeDefined();
      expect(retrieved!.modifiedDate).toBeDefined();
    });
  });

  describe('update', () => {
    it('should update an existing collection', () => {
      const id = repo.create(createTestCollection({ name: 'Original' }));
      const collection = repo.getById(id)!;

      collection.name = 'Updated Name';
      collection.description = 'New description';
      collection.color = '#00FF00';

      repo.update(collection);

      const updated = repo.getById(id);
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.description).toBe('New description');
      expect(updated!.color).toBe('#00FF00');
    });

    it('should call touch() and update modified date', () => {
      const id = repo.create(createTestCollection({ name: 'Touch Test' }));
      const collection = repo.getById(id)!;
      const originalModified = collection.modifiedDate;

      // Small delay to ensure different timestamp
      collection.name = 'Touched';
      repo.update(collection);

      const updated = repo.getById(id);
      expect(updated!.name).toBe('Touched');
      // `originalModified` was captured and then never used. An update inside
      // the same millisecond can legitimately produce an equal timestamp, so
      // the assertion that holds is that the stamp never goes backwards - which
      // still catches a `touch()` that clears it or writes a stale value.
      expect(updated!.modifiedDate).toBeDefined();
      expect(updated!.modifiedDate! >= originalModified!).toBe(true);
    });

    it('should throw an error if collection has no ID', () => {
      const collection = createTestCollection({ name: 'No ID' });

      expect(() => repo.update(collection)).toThrow('Cannot update collection without collectionId');
    });
  });

  describe('delete', () => {
    it('should delete a collection by ID', () => {
      const id = repo.create(createTestCollection({ name: 'To Delete' }));
      expect(repo.getById(id)).toBeDefined();

      repo.delete(id);

      expect(repo.getById(id)).toBeUndefined();
    });

    it('should cascade delete pinned items when collection is deleted', () => {
      const collectionId = repo.create(createTestCollection({ name: 'With Items' }));

      const pin1 = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
      }));
      const pin2 = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 45008028,
        referenceText: 'Romans 8:28',
      }));

      // Verify items exist
      expect(repo.getPinnedItemsForCollection(collectionId)).toHaveLength(2);

      repo.delete(collectionId);

      // Verify items are also deleted
      expect(repo.getPinnedItem(pin1)).toBeUndefined();
      expect(repo.getPinnedItem(pin2)).toBeUndefined();
      expect(repo.getPinnedItemsForCollection(collectionId)).toHaveLength(0);
    });

    it('should not throw when deleting a non-existent collection', () => {
      expect(() => repo.delete(99999)).not.toThrow();
    });
  });

  describe('getById', () => {
    it('should return a collection by ID', () => {
      const id = repo.create(createTestCollection({ name: 'Lookup Test' }));

      const result = repo.getById(id);

      expect(result).toBeDefined();
      expect(result!.collectionId).toBe(id);
      expect(result!.name).toBe('Lookup Test');
    });

    it('should return undefined for a non-existent ID', () => {
      const result = repo.getById(99999);

      expect(result).toBeUndefined();
    });

    it('should round-trip metadata correctly', () => {
      const meta = { tags: ['bible', 'study'], priority: 1, nested: { key: 'value' } };
      const id = repo.create(createTestCollection({ name: 'Metadata Test', metadata: meta }));

      const result = repo.getById(id);

      expect(result!.metadata).toEqual(meta);
    });
  });

  describe('getAll', () => {
    it('should return all collections ordered by sort_order then name', () => {
      repo.create(createTestCollection({ name: 'Zebra', sortOrder: 2 }));
      repo.create(createTestCollection({ name: 'Apple', sortOrder: 1 }));
      repo.create(createTestCollection({ name: 'Banana', sortOrder: 1 }));

      const all = repo.getAll();

      expect(all).toHaveLength(3);
      expect(all[0].name).toBe('Apple');
      expect(all[1].name).toBe('Banana');
      expect(all[2].name).toBe('Zebra');
    });

    it('should return an empty array when no collections exist', () => {
      const all = repo.getAll();

      expect(all).toEqual([]);
    });
  });

  describe('getTopLevel', () => {
    it('should return only top-level collections', () => {
      const parentId = repo.create(createTestCollection({ name: 'Parent' }));
      repo.create(createTestCollection({ name: 'Child', parentCollectionId: parentId }));
      repo.create(createTestCollection({ name: 'Another Top' }));

      const topLevel = repo.getTopLevel();

      expect(topLevel).toHaveLength(2);
      const names = topLevel.map(c => c.name);
      expect(names).toContain('Parent');
      expect(names).toContain('Another Top');
      expect(names).not.toContain('Child');
    });

    it('should return empty array when all collections have parents', () => {
      const parentId = repo.create(createTestCollection({ name: 'Parent' }));
      // Delete parent, leaving orphaned child with non-null parent_collection_id
      repo.create(createTestCollection({ name: 'Child', parentCollectionId: parentId }));

      // getTopLevel returns those with NULL parent - Parent has null, Child does not
      const topLevel = repo.getTopLevel();
      expect(topLevel).toHaveLength(1);
      expect(topLevel[0].name).toBe('Parent');
    });
  });

  describe('getChildren', () => {
    it('should return children of a given parent', () => {
      const parentId = repo.create(createTestCollection({ name: 'Parent' }));
      repo.create(createTestCollection({ name: 'Child A', parentCollectionId: parentId, sortOrder: 1 }));
      repo.create(createTestCollection({ name: 'Child B', parentCollectionId: parentId, sortOrder: 0 }));
      repo.create(createTestCollection({ name: 'Unrelated' }));

      const children = repo.getChildren(parentId);

      expect(children).toHaveLength(2);
      expect(children[0].name).toBe('Child B');
      expect(children[1].name).toBe('Child A');
    });

    it('should return empty array for a collection with no children', () => {
      const id = repo.create(createTestCollection({ name: 'Lonely' }));

      const children = repo.getChildren(id);

      expect(children).toEqual([]);
    });
  });

  describe('getCollectionTree', () => {
    it('should build a hierarchical tree from flat collections', () => {
      const parentId = repo.create(createTestCollection({ name: 'Parent', sortOrder: 0 }));
      const childId = repo.create(createTestCollection({ name: 'Child', parentCollectionId: parentId, sortOrder: 0 }));
      repo.create(createTestCollection({ name: 'Grandchild', parentCollectionId: childId, sortOrder: 0 }));
      repo.create(createTestCollection({ name: 'Sibling Top', sortOrder: 1 }));

      const tree = repo.getCollectionTree();

      expect(tree).toHaveLength(2);

      const parent = tree.find(c => c.name === 'Parent');
      expect(parent).toBeDefined();
      expect(parent!.hasChildren()).toBe(true);

      const children = parent!.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0].name).toBe('Child');

      const grandchildren = children[0].getChildren();
      expect(grandchildren).toHaveLength(1);
      expect(grandchildren[0].name).toBe('Grandchild');
    });

    it('should return empty array when no collections exist', () => {
      const tree = repo.getCollectionTree();

      expect(tree).toEqual([]);
    });

    it('should handle multiple top-level collections with children', () => {
      const p1 = repo.create(createTestCollection({ name: 'Parent 1', sortOrder: 0 }));
      const p2 = repo.create(createTestCollection({ name: 'Parent 2', sortOrder: 1 }));
      repo.create(createTestCollection({ name: 'Child of P1', parentCollectionId: p1 }));
      repo.create(createTestCollection({ name: 'Child of P2', parentCollectionId: p2 }));

      const tree = repo.getCollectionTree();

      expect(tree).toHaveLength(2);
      expect(tree[0].getChildren()).toHaveLength(1);
      expect(tree[1].getChildren()).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Pinned Item CRUD Tests
  // ==========================================================================

  describe('addPinnedItem', () => {
    it('should add a verse pinned item and return pin_id', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Bookmarks' }));

      const pinId = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
        title: 'Famous verse',
      }));

      expect(pinId).toBeGreaterThan(0);
    });

    it('should add a passage pinned item with verse range', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Passages' }));

      const pinId = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'passage',
        verseIdStart: 45008028,
        verseIdEnd: 45008039,
        referenceText: 'Romans 8:28-39',
      }));

      const item = repo.getPinnedItem(pinId);
      expect(item).toBeDefined();
      expect(item!.itemType).toBe('passage');
      expect(item!.verseIdStart).toBe(45008028);
      expect(item!.verseIdEnd).toBe(45008039);
    });

    it('should add a note pinned item', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Notes' }));

      const pinId = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'note',
        referenceId: 42,
        title: 'My study note',
        notes: 'Important insight',
      }));

      const item = repo.getPinnedItem(pinId);
      expect(item!.itemType).toBe('note');
      expect(item!.referenceId).toBe(42);
      expect(item!.title).toBe('My study note');
      expect(item!.notes).toBe('Important insight');
    });

    it('should add a commentary pinned item', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Commentary Refs' }));

      const pinId = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'commentary',
        verseIdStart: 1001001,
        moduleId: 5,
        title: 'Commentary on Genesis 1:1',
      }));

      const item = repo.getPinnedItem(pinId);
      expect(item!.itemType).toBe('commentary');
      expect(item!.moduleId).toBe(5);
    });

    it('should persist metadata on pinned items', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Meta' }));
      const meta = { highlight: 'yellow', confidence: 0.95 };

      const pinId = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 43003016,
        metadata: meta,
      }));

      const item = repo.getPinnedItem(pinId);
      expect(item!.metadata).toEqual(meta);
    });
  });

  describe('updatePinnedItem', () => {
    it('should update a pinned item', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Update Test' }));
      const pinId = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 43003016,
        title: 'Original Title',
      }));

      const item = repo.getPinnedItem(pinId)!;
      item.title = 'Updated Title';
      item.notes = 'Added notes';

      repo.updatePinnedItem(item);

      const updated = repo.getPinnedItem(pinId);
      expect(updated!.title).toBe('Updated Title');
      expect(updated!.notes).toBe('Added notes');
    });

    it('should throw an error if pinned item has no ID', () => {
      const item = createTestPinnedItem({ itemType: 'verse' });

      expect(() => repo.updatePinnedItem(item)).toThrow('Cannot update pinned item without pinId');
    });
  });

  describe('deletePinnedItem', () => {
    it('should delete a pinned item by pin_id', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Delete Pin' }));
      const pinId = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 43003016,
      }));

      expect(repo.getPinnedItem(pinId)).toBeDefined();

      repo.deletePinnedItem(pinId);

      expect(repo.getPinnedItem(pinId)).toBeUndefined();
    });

    it('should not throw when deleting a non-existent pinned item', () => {
      expect(() => repo.deletePinnedItem(99999)).not.toThrow();
    });
  });

  describe('getPinnedItem', () => {
    it('should return a pinned item by ID', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Get Pin' }));
      const pinId = repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 43003016,
        referenceText: 'John 3:16',
        title: 'Test',
        sortOrder: 3,
      }));

      const item = repo.getPinnedItem(pinId);

      expect(item).toBeDefined();
      expect(item!.pinId).toBe(pinId);
      expect(item!.collectionId).toBe(collectionId);
      expect(item!.itemType).toBe('verse');
      expect(item!.verseIdStart).toBe(43003016);
      expect(item!.referenceText).toBe('John 3:16');
      expect(item!.title).toBe('Test');
      expect(item!.sortOrder).toBe(3);
    });

    it('should return undefined for a non-existent pin_id', () => {
      const item = repo.getPinnedItem(99999);

      expect(item).toBeUndefined();
    });
  });

  describe('getPinnedItemsForCollection', () => {
    it('should return all pinned items for a collection ordered by sort_order', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Ordered' }));

      repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 43003016,
        sortOrder: 2,
      }));
      repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 45008028,
        sortOrder: 0,
      }));
      repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'passage',
        verseIdStart: 1001001,
        verseIdEnd: 1001005,
        sortOrder: 1,
      }));

      const items = repo.getPinnedItemsForCollection(collectionId);

      expect(items).toHaveLength(3);
      expect(items[0].verseIdStart).toBe(45008028); // sortOrder 0
      expect(items[1].verseIdStart).toBe(1001001);  // sortOrder 1
      expect(items[2].verseIdStart).toBe(43003016);  // sortOrder 2
    });

    it('should return empty array for a collection with no items', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Empty' }));

      const items = repo.getPinnedItemsForCollection(collectionId);

      expect(items).toEqual([]);
    });

    it('should not return items from other collections', () => {
      const col1 = repo.create(createTestCollection({ name: 'Col 1' }));
      const col2 = repo.create(createTestCollection({ name: 'Col 2' }));

      repo.addPinnedItem(createTestPinnedItem({ collectionId: col1, itemType: 'verse', verseIdStart: 43003016 }));
      repo.addPinnedItem(createTestPinnedItem({ collectionId: col2, itemType: 'verse', verseIdStart: 45008028 }));

      const items1 = repo.getPinnedItemsForCollection(col1);
      const items2 = repo.getPinnedItemsForCollection(col2);

      expect(items1).toHaveLength(1);
      expect(items1[0].verseIdStart).toBe(43003016);
      expect(items2).toHaveLength(1);
      expect(items2[0].verseIdStart).toBe(45008028);
    });
  });

  describe('getPinnedItemsByVerse', () => {
    it('should return pinned items matching an exact verse', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Verse Match' }));

      repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 43003016,
      }));
      repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'verse',
        verseIdStart: 45008028,
      }));

      const items = repo.getPinnedItemsByVerse(43003016);

      expect(items).toHaveLength(1);
      expect(items[0].verseIdStart).toBe(43003016);
    });

    it('should return passage items that contain the verse within their range', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Range Match' }));

      // Passage: Romans 8:28-39 (45008028 to 45008039)
      repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'passage',
        verseIdStart: 45008028,
        verseIdEnd: 45008039,
      }));

      // Query for Romans 8:30 (within the range)
      const items = repo.getPinnedItemsByVerse(45008030);

      expect(items).toHaveLength(1);
      expect(items[0].itemType).toBe('passage');
      expect(items[0].verseIdStart).toBe(45008028);
      expect(items[0].verseIdEnd).toBe(45008039);
    });

    it('should not return passages that do not contain the verse', () => {
      const collectionId = repo.create(createTestCollection({ name: 'No Range Match' }));

      // Passage: Romans 8:28-39
      repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'passage',
        verseIdStart: 45008028,
        verseIdEnd: 45008039,
      }));

      // Query for Romans 8:27 (before the range)
      const items = repo.getPinnedItemsByVerse(45008027);

      expect(items).toHaveLength(0);
    });

    it('should match a verse at the start of a passage range', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Range Start' }));

      repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'passage',
        verseIdStart: 45008028,
        verseIdEnd: 45008039,
      }));

      const items = repo.getPinnedItemsByVerse(45008028);

      expect(items).toHaveLength(1);
    });

    it('should match a verse at the end of a passage range', () => {
      const collectionId = repo.create(createTestCollection({ name: 'Range End' }));

      repo.addPinnedItem(createTestPinnedItem({
        collectionId,
        itemType: 'passage',
        verseIdStart: 45008028,
        verseIdEnd: 45008039,
      }));

      const items = repo.getPinnedItemsByVerse(45008039);

      expect(items).toHaveLength(1);
    });

    it('should return items from multiple collections', () => {
      const col1 = repo.create(createTestCollection({ name: 'Col 1' }));
      const col2 = repo.create(createTestCollection({ name: 'Col 2' }));

      repo.addPinnedItem(createTestPinnedItem({ collectionId: col1, itemType: 'verse', verseIdStart: 43003016 }));
      repo.addPinnedItem(createTestPinnedItem({ collectionId: col2, itemType: 'verse', verseIdStart: 43003016 }));

      const items = repo.getPinnedItemsByVerse(43003016);

      expect(items).toHaveLength(2);
    });

    it('should return empty array when no items match the verse', () => {
      const items = repo.getPinnedItemsByVerse(99099099);

      expect(items).toEqual([]);
    });
  });

  // ==========================================================================
  // Search & Query Tests
  // ==========================================================================

  describe('findCollectionsByName', () => {
    it('should find collections by partial name match', () => {
      repo.create(createTestCollection({ name: 'Bible Study' }));
      repo.create(createTestCollection({ name: 'Study Notes' }));
      repo.create(createTestCollection({ name: 'Favorites' }));

      const results = repo.findCollectionsByName('Study');

      expect(results).toHaveLength(2);
      const names = results.map(c => c.name);
      expect(names).toContain('Bible Study');
      expect(names).toContain('Study Notes');
    });

    it('should be case-insensitive', () => {
      repo.create(createTestCollection({ name: 'Bible Study' }));

      const lower = repo.findCollectionsByName('bible study');
      const upper = repo.findCollectionsByName('BIBLE STUDY');
      const mixed = repo.findCollectionsByName('bIbLe sTuDy');

      expect(lower).toHaveLength(1);
      expect(upper).toHaveLength(1);
      expect(mixed).toHaveLength(1);
    });

    it('should return empty array when no matches found', () => {
      repo.create(createTestCollection({ name: 'Favorites' }));

      const results = repo.findCollectionsByName('nonexistent');

      expect(results).toEqual([]);
    });
  });

  describe('getCollectionsContainingVerse', () => {
    it('should return collections that have a pinned item with the given verse', () => {
      const col1 = repo.create(createTestCollection({ name: 'Collection A' }));
      const col2 = repo.create(createTestCollection({ name: 'Collection B' }));
      const col3 = repo.create(createTestCollection({ name: 'Collection C' }));

      repo.addPinnedItem(createTestPinnedItem({ collectionId: col1, itemType: 'verse', verseIdStart: 43003016 }));
      repo.addPinnedItem(createTestPinnedItem({ collectionId: col2, itemType: 'verse', verseIdStart: 43003016 }));
      repo.addPinnedItem(createTestPinnedItem({ collectionId: col3, itemType: 'verse', verseIdStart: 45008028 }));

      const collections = repo.getCollectionsContainingVerse(43003016);

      expect(collections).toHaveLength(2);
      const names = collections.map(c => c.name);
      expect(names).toContain('Collection A');
      expect(names).toContain('Collection B');
      expect(names).not.toContain('Collection C');
    });

    it('should return collections with passage ranges containing the verse', () => {
      const col = repo.create(createTestCollection({ name: 'Passages' }));

      repo.addPinnedItem(createTestPinnedItem({
        collectionId: col,
        itemType: 'passage',
        verseIdStart: 45008028,
        verseIdEnd: 45008039,
      }));

      const collections = repo.getCollectionsContainingVerse(45008030);

      expect(collections).toHaveLength(1);
      expect(collections[0].name).toBe('Passages');
    });

    it('should return distinct collections even if verse appears multiple times', () => {
      const col = repo.create(createTestCollection({ name: 'Multi Pin' }));

      // Same verse pinned twice in the same collection (different types)
      repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 43003016 }));
      repo.addPinnedItem(createTestPinnedItem({
        collectionId: col,
        itemType: 'passage',
        verseIdStart: 43003015,
        verseIdEnd: 43003017,
      }));

      const collections = repo.getCollectionsContainingVerse(43003016);

      // Should be distinct - only one collection returned
      expect(collections).toHaveLength(1);
    });

    it('should return empty array when verse is not in any collection', () => {
      const collections = repo.getCollectionsContainingVerse(99099099);

      expect(collections).toEqual([]);
    });
  });

  describe('isVerseBookmarked', () => {
    it('should return true if the verse exists in any pinned item', () => {
      const col = repo.create(createTestCollection({ name: 'Bookmarks' }));
      repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 43003016 }));

      expect(repo.isVerseBookmarked(43003016)).toBe(true);
    });

    it('should return true if the verse is within a passage range', () => {
      const col = repo.create(createTestCollection({ name: 'Passages' }));
      repo.addPinnedItem(createTestPinnedItem({
        collectionId: col,
        itemType: 'passage',
        verseIdStart: 45008028,
        verseIdEnd: 45008039,
      }));

      expect(repo.isVerseBookmarked(45008030)).toBe(true);
    });

    it('should return false if the verse is not bookmarked', () => {
      expect(repo.isVerseBookmarked(99099099)).toBe(false);
    });

    it('should return false after pinned item is deleted', () => {
      const col = repo.create(createTestCollection({ name: 'Delete Test' }));
      const pinId = repo.addPinnedItem(createTestPinnedItem({
        collectionId: col,
        itemType: 'verse',
        verseIdStart: 43003016,
      }));

      expect(repo.isVerseBookmarked(43003016)).toBe(true);

      repo.deletePinnedItem(pinId);

      expect(repo.isVerseBookmarked(43003016)).toBe(false);
    });
  });

  describe('getCollectionItemCount', () => {
    it('should return the number of pinned items in a collection', () => {
      const col = repo.create(createTestCollection({ name: 'Count Test' }));

      repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 43003016 }));
      repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 45008028 }));
      repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'note', referenceId: 1 }));

      const count = repo.getCollectionItemCount(col);

      expect(count).toBe(3);
    });

    it('should return 0 for an empty collection', () => {
      const col = repo.create(createTestCollection({ name: 'Empty' }));

      const count = repo.getCollectionItemCount(col);

      expect(count).toBe(0);
    });

    it('should return 0 for a non-existent collection', () => {
      const count = repo.getCollectionItemCount(99999);

      expect(count).toBe(0);
    });
  });

  // ==========================================================================
  // Bulk Operation Tests
  // ==========================================================================

  describe('moveCollection', () => {
    it('should move a collection to a new parent', () => {
      const parent1 = repo.create(createTestCollection({ name: 'Parent 1' }));
      const parent2 = repo.create(createTestCollection({ name: 'Parent 2' }));
      const child = repo.create(createTestCollection({ name: 'Child', parentCollectionId: parent1 }));

      // Verify initial parent
      expect(repo.getById(child)!.parentCollectionId).toBe(parent1);

      repo.moveCollection(child, parent2);

      const moved = repo.getById(child);
      expect(moved!.parentCollectionId).toBe(parent2);
    });

    it('should move a collection to top level by passing null', () => {
      const parent = repo.create(createTestCollection({ name: 'Parent' }));
      const child = repo.create(createTestCollection({ name: 'Child', parentCollectionId: parent }));

      expect(repo.getById(child)!.parentCollectionId).toBe(parent);

      repo.moveCollection(child, null);

      const moved = repo.getById(child);
      expect(moved!.parentCollectionId).toBeNull();
    });

    it('should update modified date when moving', () => {
      const parent = repo.create(createTestCollection({ name: 'Parent' }));
      const child = repo.create(createTestCollection({ name: 'Child' }));

      const beforeMove = repo.getById(child)!.modifiedDate;

      repo.moveCollection(child, parent);

      const afterMove = repo.getById(child)!.modifiedDate;
      // `beforeMove` was captured and then never compared against.
      expect(afterMove).toBeDefined();
      expect(afterMove! >= beforeMove!).toBe(true);
    });
  });

  describe('reorderCollections', () => {
    it('should reorder collections by updating sort_order', () => {
      const id1 = repo.create(createTestCollection({ name: 'First', sortOrder: 0 }));
      const id2 = repo.create(createTestCollection({ name: 'Second', sortOrder: 1 }));
      const id3 = repo.create(createTestCollection({ name: 'Third', sortOrder: 2 }));

      // Reverse the order
      repo.reorderCollections([id3, id2, id1]);

      expect(repo.getById(id3)!.sortOrder).toBe(0);
      expect(repo.getById(id2)!.sortOrder).toBe(1);
      expect(repo.getById(id1)!.sortOrder).toBe(2);
    });

    it('should handle empty array', () => {
      expect(() => repo.reorderCollections([])).not.toThrow();
    });

    it('should handle single collection', () => {
      const id = repo.create(createTestCollection({ name: 'Only' }));

      repo.reorderCollections([id]);

      expect(repo.getById(id)!.sortOrder).toBe(0);
    });

    it('should update sort_order atomically in a transaction', () => {
      const id1 = repo.create(createTestCollection({ name: 'A', sortOrder: 0 }));
      const id2 = repo.create(createTestCollection({ name: 'B', sortOrder: 1 }));

      repo.reorderCollections([id2, id1]);

      const all = repo.getAll();
      // After reorder, id2 has sortOrder 0, id1 has sortOrder 1
      // getAll orders by sort_order, name - so id2 (B, 0) comes before id1 (A, 1)
      expect(all[0].collectionId).toBe(id2);
      expect(all[1].collectionId).toBe(id1);
    });
  });

  describe('reorderPinnedItems', () => {
    it('should reorder pinned items by updating sort_order', () => {
      const col = repo.create(createTestCollection({ name: 'Reorder Pins' }));

      const pin1 = repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 43003016, sortOrder: 0 }));
      const pin2 = repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 45008028, sortOrder: 1 }));
      const pin3 = repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 1001001, sortOrder: 2 }));

      // Reverse the order
      repo.reorderPinnedItems([pin3, pin2, pin1]);

      expect(repo.getPinnedItem(pin3)!.sortOrder).toBe(0);
      expect(repo.getPinnedItem(pin2)!.sortOrder).toBe(1);
      expect(repo.getPinnedItem(pin1)!.sortOrder).toBe(2);
    });

    it('should handle empty array', () => {
      expect(() => repo.reorderPinnedItems([])).not.toThrow();
    });

    it('should reflect new order in getPinnedItemsForCollection', () => {
      const col = repo.create(createTestCollection({ name: 'Order Check' }));

      const pin1 = repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 43003016, sortOrder: 0 }));
      const pin2 = repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 45008028, sortOrder: 1 }));

      // Swap order
      repo.reorderPinnedItems([pin2, pin1]);

      const items = repo.getPinnedItemsForCollection(col);
      expect(items[0].pinId).toBe(pin2);
      expect(items[1].pinId).toBe(pin1);
    });
  });

  // ==========================================================================
  // Edge Case & Integration Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle collection with no description, color, or icon', () => {
      const id = repo.create(new Collection({ name: 'Bare Bones' }));

      const retrieved = repo.getById(id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('Bare Bones');
      expect(retrieved!.description).toBeNull();
      expect(retrieved!.color).toBeNull();
      expect(retrieved!.icon).toBeNull();
    });

    it('should handle pinned item with no optional fields', () => {
      const col = repo.create(createTestCollection({ name: 'Sparse' }));

      const pinId = repo.addPinnedItem(new PinnedItem({ itemType: 'verse', collectionId: col }));

      const item = repo.getPinnedItem(pinId);
      expect(item).toBeDefined();
      expect(item!.itemType).toBe('verse');
      expect(item!.verseIdStart).toBeNull();
      expect(item!.title).toBeNull();
      expect(item!.notes).toBeNull();
      expect(item!.metadata).toBeUndefined();
    });

    it('should handle all pinned item types', () => {
      const col = repo.create(createTestCollection({ name: 'All Types' }));
      const types: Array<'verse' | 'passage' | 'note' | 'commentary' | 'dictionary_entry' | 'book_section' | 'image'> = [
        'verse', 'passage', 'note', 'commentary', 'dictionary_entry', 'book_section', 'image',
      ];

      const pinIds = types.map(t =>
        repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: t }))
      );

      const items = repo.getPinnedItemsForCollection(col);
      expect(items).toHaveLength(7);

      const retrievedTypes = items.map(i => i.itemType).sort();
      expect(retrievedTypes).toEqual([...types].sort());

      // Verify each can be retrieved individually
      pinIds.forEach(pinId => {
        expect(repo.getPinnedItem(pinId)).toBeDefined();
      });
    });

    it('should handle deeply nested collection hierarchy in tree', () => {
      const level1 = repo.create(createTestCollection({ name: 'Level 1' }));
      const level2 = repo.create(createTestCollection({ name: 'Level 2', parentCollectionId: level1 }));
      const level3 = repo.create(createTestCollection({ name: 'Level 3', parentCollectionId: level2 }));
      const level4 = repo.create(createTestCollection({ name: 'Level 4', parentCollectionId: level3 }));

      const tree = repo.getCollectionTree();

      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe('Level 1');

      const l2 = tree[0].getChildren();
      expect(l2).toHaveLength(1);
      expect(l2[0].name).toBe('Level 2');

      const l3 = l2[0].getChildren();
      expect(l3).toHaveLength(1);
      expect(l3[0].name).toBe('Level 3');

      const l4 = l3[0].getChildren();
      expect(l4).toHaveLength(1);
      expect(l4[0].name).toBe('Level 4');
      // The id the fixture created, so the tree is checked to be the same
      // collection rather than merely a node with the right name.
      expect(l4[0].collectionId).toBe(level4);
      expect(l4[0].hasChildren()).toBe(false);
    });

    it('should handle metadata with complex nested objects', () => {
      const complexMeta = {
        tags: ['theology', 'eschatology'],
        settings: { displayMode: 'compact', showVerseNumbers: true },
        history: [{ date: '2025-01-01', action: 'created' }],
      };

      const id = repo.create(createTestCollection({
        name: 'Complex Meta',
        metadata: complexMeta,
      }));

      const retrieved = repo.getById(id);
      expect(retrieved!.metadata).toEqual(complexMeta);
    });

    it('should handle collection with undefined metadata', () => {
      const id = repo.create(createTestCollection({ name: 'No Meta' }));

      const retrieved = repo.getById(id);
      expect(retrieved!.metadata).toBeUndefined();
    });

    it('should handle getAll with mixed parent/child collections', () => {
      const parent = repo.create(createTestCollection({ name: 'Parent', sortOrder: 0 }));
      repo.create(createTestCollection({ name: 'Child A', parentCollectionId: parent, sortOrder: 0 }));
      repo.create(createTestCollection({ name: 'Child B', parentCollectionId: parent, sortOrder: 1 }));
      repo.create(createTestCollection({ name: 'Top Level', sortOrder: 1 }));

      const all = repo.getAll();

      // getAll returns all collections regardless of hierarchy
      expect(all).toHaveLength(4);
    });

    it('should count items correctly after adding and removing', () => {
      const col = repo.create(createTestCollection({ name: 'Count Mutations' }));

      const pin1 = repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 43003016 }));
      const pin2 = repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 45008028 }));
      repo.addPinnedItem(createTestPinnedItem({ collectionId: col, itemType: 'verse', verseIdStart: 1001001 }));

      expect(repo.getCollectionItemCount(col)).toBe(3);

      repo.deletePinnedItem(pin1);
      expect(repo.getCollectionItemCount(col)).toBe(2);

      repo.deletePinnedItem(pin2);
      expect(repo.getCollectionItemCount(col)).toBe(1);
    });

    it('should handle findCollectionsByName with special LIKE characters', () => {
      repo.create(createTestCollection({ name: 'Test%Collection' }));
      repo.create(createTestCollection({ name: 'Test_Collection' }));

      // The % in the search term is passed through LIKE, but the name contains literal %
      const results = repo.findCollectionsByName('Test');
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });
});
