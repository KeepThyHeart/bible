import { ISql } from '../Core/ISql';
import { Collection, PinnedItem, PinnedItemType } from '../Models/User/Collection';
import { ICollectionRepository } from './ICollectionRepository';
import { verseRangeMatchesPoint } from '../Core/VerseRangeQuery';
import { CollectionRow, PinnedItemRow } from '../Core/RowTypes';
import { resolveOptionalRangeEnd } from '../Core/Types';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';

/**
 * Repository for managing Collections and Pinned Items in the user database
 */
export class CollectionRepository implements ICollectionRepository {
  constructor(private sql: ISql) {}

  // ===== Collection CRUD Operations =====

  create(collection: Collection): number {
    const result = this.sql.execute(
      `INSERT INTO collection (
        parent_collection_id, name, description, color, icon,
        created_date, modified_date, sort_order, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        collection.parentCollectionId ?? null,
        collection.name,
        collection.description ?? null,
        collection.color ?? null,
        collection.icon ?? null,
        collection.createdDate ?? new Date().toISOString(),
        collection.modifiedDate ?? new Date().toISOString(),
        collection.sortOrder,
        stringifyJsonField(collection.metadata)
      ]
    );
    return result.lastInsertRowId ?? 0;
  }

  update(collection: Collection): void {
    if (!collection.collectionId) {
      throw new Error('Cannot update collection without collectionId');
    }

    collection.touch(); // Update modified date

    this.sql.execute(
      `UPDATE collection SET
        parent_collection_id = ?,
        name = ?,
        description = ?,
        color = ?,
        icon = ?,
        modified_date = ?,
        sort_order = ?,
        metadata = ?
      WHERE collection_id = ?`,
      [
        collection.parentCollectionId ?? null,
        collection.name,
        collection.description ?? null,
        collection.color ?? null,
        collection.icon ?? null,
        collection.modifiedDate ?? null,
        collection.sortOrder,
        stringifyJsonField(collection.metadata),
        collection.collectionId
      ]
    );
  }

  delete(collectionId: number): void {
    // CASCADE delete will automatically remove pinned_items
    this.sql.execute('DELETE FROM collection WHERE collection_id = ?', [collectionId]);
  }

  getById(collectionId: number): Collection | undefined {
    const row = this.sql.queryOne<CollectionRow>(
      'SELECT * FROM collection WHERE collection_id = ?',
      [collectionId]
    );

    if (!row) return undefined;

    return this.mapRowToCollection(row);
  }

  getAll(): Collection[] {
    const rows = this.sql.queryAll<CollectionRow>('SELECT * FROM collection ORDER BY sort_order, name');
    return rows.map(row => this.mapRowToCollection(row));
  }

  getTopLevel(): Collection[] {
    const rows = this.sql.queryAll<CollectionRow>(
      'SELECT * FROM collection WHERE parent_collection_id IS NULL ORDER BY sort_order, name'
    );
    return rows.map(row => this.mapRowToCollection(row));
  }

  getChildren(parentId: number): Collection[] {
    const rows = this.sql.queryAll<CollectionRow>(
      'SELECT * FROM collection WHERE parent_collection_id = ? ORDER BY sort_order, name',
      [parentId]
    );
    return rows.map(row => this.mapRowToCollection(row));
  }

  getCollectionTree(): Collection[] {
    // Get all collections
    const allCollections = this.getAll();

    // Build a map for quick lookup
    const collectionMap = new Map<number, Collection>();
    allCollections.forEach(c => {
      if (c.collectionId) {
        collectionMap.set(c.collectionId, c);
      }
    });

    // Build the tree structure
    const topLevel: Collection[] = [];

    allCollections.forEach(collection => {
      if (collection.parentCollectionId) {
        // Add as child to parent
        const parent = collectionMap.get(collection.parentCollectionId);
        if (parent) {
          parent.addChild(collection);
        }
      } else {
        // Top-level collection
        topLevel.push(collection);
      }
    });

    return topLevel;
  }

  // ===== Pinned Item Operations =====

  addPinnedItem(item: PinnedItem): number {
    const result = this.sql.execute(
      `INSERT INTO pinned_item (
        collection_id, item_type, verse_id_start, verse_id_end,
        reference_id, reference_text, module_id, title, notes,
        created_date, sort_order, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.collectionId ?? null,
        item.itemType,
        item.verseIdStart ?? null,
        // R-1: a pin need not be a scripture pin, but if it is, both ends are set.
        resolveOptionalRangeEnd(item.verseIdStart, item.verseIdEnd),
        item.referenceId ?? null,
        item.referenceText ?? null,
        item.moduleId ?? null,
        item.title ?? null,
        item.notes ?? null,
        item.createdDate ?? new Date().toISOString(),
        item.sortOrder,
        stringifyJsonField(item.metadata)
      ]
    );
    return result.lastInsertRowId ?? 0;
  }

  updatePinnedItem(item: PinnedItem): void {
    if (!item.pinId) {
      throw new Error('Cannot update pinned item without pinId');
    }

    this.sql.execute(
      `UPDATE pinned_item SET
        collection_id = ?,
        item_type = ?,
        verse_id_start = ?,
        verse_id_end = ?,
        reference_id = ?,
        reference_text = ?,
        module_id = ?,
        title = ?,
        notes = ?,
        sort_order = ?,
        metadata = ?
      WHERE pin_id = ?`,
      [
        item.collectionId ?? null,
        item.itemType,
        item.verseIdStart ?? null,
        // R-1: a pin need not be a scripture pin, but if it is, both ends are set.
        resolveOptionalRangeEnd(item.verseIdStart, item.verseIdEnd),
        item.referenceId ?? null,
        item.referenceText ?? null,
        item.moduleId ?? null,
        item.title ?? null,
        item.notes ?? null,
        item.sortOrder,
        stringifyJsonField(item.metadata),
        item.pinId
      ]
    );
  }

  deletePinnedItem(pinId: number): void {
    this.sql.execute('DELETE FROM pinned_item WHERE pin_id = ?', [pinId]);
  }

  getPinnedItem(pinId: number): PinnedItem | undefined {
    const row = this.sql.queryOne<PinnedItemRow>('SELECT * FROM pinned_item WHERE pin_id = ?', [pinId]);
    if (!row) return undefined;
    return this.mapRowToPinnedItem(row);
  }

  getPinnedItemsForCollection(collectionId: number): PinnedItem[] {
    const rows = this.sql.queryAll<PinnedItemRow>(
      'SELECT * FROM pinned_item WHERE collection_id = ? ORDER BY sort_order, created_date',
      [collectionId]
    );
    return rows.map(row => this.mapRowToPinnedItem(row));
  }

  getPinnedItemsByVerse(verseId: number): PinnedItem[] {
    const range = verseRangeMatchesPoint('verse_id_start', 'verse_id_end', verseId);
    const rows = this.sql.queryAll<PinnedItemRow>(
      `SELECT * FROM pinned_item
       WHERE ${range.sql}
       ORDER BY created_date DESC`,
      range.params
    );
    return rows.map(row => this.mapRowToPinnedItem(row));
  }

  // ===== Search & Query Operations =====

  findCollectionsByName(searchTerm: string): Collection[] {
    const rows = this.sql.queryAll<CollectionRow>(
      'SELECT * FROM collection WHERE name LIKE ? ORDER BY name',
      [`%${searchTerm}%`]
    );
    return rows.map(row => this.mapRowToCollection(row));
  }

  getCollectionsContainingVerse(verseId: number): Collection[] {
    const range = verseRangeMatchesPoint('p.verse_id_start', 'p.verse_id_end', verseId);
    const rows = this.sql.queryAll<CollectionRow>(
      `SELECT DISTINCT c.*
       FROM collection c
       INNER JOIN pinned_item p ON c.collection_id = p.collection_id
       WHERE ${range.sql}
       ORDER BY c.name`,
      range.params
    );
    return rows.map(row => this.mapRowToCollection(row));
  }

  isVerseBookmarked(verseId: number): boolean {
    const range = verseRangeMatchesPoint('verse_id_start', 'verse_id_end', verseId);
    const row = this.sql.queryOne(
      `SELECT COUNT(*) as count FROM pinned_item
       WHERE ${range.sql}`,
      range.params
    );
    return row ? (row.count as number) > 0 : false;
  }

  getCollectionItemCount(collectionId: number): number {
    const row = this.sql.queryOne(
      'SELECT COUNT(*) as count FROM pinned_item WHERE collection_id = ?',
      [collectionId]
    );
    return row ? (row.count as number) : 0;
  }

  // ===== Bulk Operations =====

  moveCollection(collectionId: number, newParentId: number | null): void {
    this.sql.execute(
      'UPDATE collection SET parent_collection_id = ?, modified_date = ? WHERE collection_id = ?',
      [newParentId, new Date().toISOString(), collectionId]
    );
  }

  reorderCollections(collectionIds: number[]): void {
    this.sql.transaction(() => {
      collectionIds.forEach((id, index) => {
        this.sql.execute(
          'UPDATE collection SET sort_order = ? WHERE collection_id = ?',
          [index, id]
        );
      });
    });
  }

  reorderPinnedItems(pinIds: number[]): void {
    this.sql.transaction(() => {
      pinIds.forEach((id, index) => {
        this.sql.execute(
          'UPDATE pinned_item SET sort_order = ? WHERE pin_id = ?',
          [index, id]
        );
      });
    });
  }

  // ===== Private Helper Methods =====

  private mapRowToCollection(row: CollectionRow): Collection {
    return new Collection({
      collectionId: row.collection_id,
      parentCollectionId: row.parent_collection_id,
      name: row.name,
      description: row.description,
      color: row.color,
      icon: row.icon,
      createdDate: row.created_date,
      modifiedDate: row.modified_date,
      sortOrder: row.sort_order,
      metadata: parseJsonField(row.metadata)
    });
  }

  private mapRowToPinnedItem(row: PinnedItemRow): PinnedItem {
    return new PinnedItem({
      pinId: row.pin_id,
      collectionId: row.collection_id,
      itemType: row.item_type as PinnedItemType,
      verseIdStart: row.verse_id_start,
      verseIdEnd: row.verse_id_end,
      referenceId: row.reference_id,
      referenceText: row.reference_text,
      moduleId: row.module_id,
      title: row.title,
      notes: row.notes,
      createdDate: row.created_date,
      sortOrder: row.sort_order,
      metadata: parseJsonField(row.metadata)
    });
  }
}
