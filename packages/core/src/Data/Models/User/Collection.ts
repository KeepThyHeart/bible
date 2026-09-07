import { Metadata, ItemType } from '../../Core/Types';

/**
 * Collection entity from the user database
 * Represents a user-created collection for organizing study materials
 */
export class Collection {
  collectionId?: number;
  parentCollectionId?: number;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  createdDate?: string;
  modifiedDate?: string;
  sortOrder: number;
  metadata?: Metadata;

  // Child collections (for nested structure)
  private childCollections: Collection[] = [];

  // Pinned items in this collection
  private pinnedItems: PinnedItem[] = [];

  constructor(data: {
    collectionId?: number;
    parentCollectionId?: number;
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    createdDate?: string;
    modifiedDate?: string;
    sortOrder?: number;
    metadata?: Metadata;
  }) {
    this.collectionId = data.collectionId;
    this.parentCollectionId = data.parentCollectionId;
    this.name = data.name;
    this.description = data.description;
    this.color = data.color;
    this.icon = data.icon;
    this.createdDate = data.createdDate;
    this.modifiedDate = data.modifiedDate;
    this.sortOrder = data.sortOrder ?? 0;
    this.metadata = data.metadata;
  }

  /**
   * Check if this is a top-level collection
   */
  isTopLevel(): boolean {
    return this.parentCollectionId === undefined || this.parentCollectionId === null;
  }

  /**
   * Check if this collection has child collections
   */
  hasChildren(): boolean {
    return this.childCollections.length > 0;
  }

  /**
   * Get child collections
   */
  getChildren(): Collection[] {
    return this.childCollections;
  }

  /**
   * Add a child collection
   */
  addChild(collection: Collection): void {
    collection.parentCollectionId = this.collectionId;
    this.childCollections.push(collection);
  }

  /**
   * Remove a child collection
   */
  removeChild(collectionId: number): boolean {
    const index = this.childCollections.findIndex(c => c.collectionId === collectionId);
    if (index !== -1) {
      this.childCollections.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get pinned items
   */
  getPinnedItems(): PinnedItem[] {
    return this.pinnedItems;
  }

  /**
   * Add a pinned item
   */
  addPinnedItem(item: PinnedItem): void {
    item.collectionId = this.collectionId!;
    this.pinnedItems.push(item);
  }

  /**
   * Remove a pinned item
   */
  removePinnedItem(pinId: number): boolean {
    const index = this.pinnedItems.findIndex(p => p.pinId === pinId);
    if (index !== -1) {
      this.pinnedItems.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Set all pinned items (from repository query)
   */
  setPinnedItems(items: PinnedItem[]): void {
    this.pinnedItems = items;
  }

  /**
   * Get item count
   */
  getItemCount(): number {
    return this.pinnedItems.length;
  }

  /**
   * Update the modified date to now
   */
  touch(): void {
    this.modifiedDate = new Date().toISOString();
  }
}

/**
 * Pinned item in a collection
 */
export class PinnedItem {
  pinId?: number;
  collectionId?: number;
  itemType: PinnedItemType;
  verseIdStart?: number;
  verseIdEnd?: number;
  referenceId?: number;
  referenceText?: string;
  moduleId?: number;
  title?: string;
  notes?: string;
  createdDate?: string;
  sortOrder: number;
  metadata?: Metadata;

  constructor(data: {
    pinId?: number;
    collectionId?: number;
    itemType: PinnedItemType;
    verseIdStart?: number;
    verseIdEnd?: number;
    referenceId?: number;
    referenceText?: string;
    moduleId?: number;
    title?: string;
    notes?: string;
    createdDate?: string;
    sortOrder?: number;
    metadata?: Metadata;
  }) {
    this.pinId = data.pinId;
    this.collectionId = data.collectionId;
    this.itemType = data.itemType;
    this.verseIdStart = data.verseIdStart;
    this.verseIdEnd = data.verseIdEnd;
    this.referenceId = data.referenceId;
    this.referenceText = data.referenceText;
    this.moduleId = data.moduleId;
    this.title = data.title;
    this.notes = data.notes;
    this.createdDate = data.createdDate;
    this.sortOrder = data.sortOrder ?? 0;
    this.metadata = data.metadata;
  }

  /**
   * Check if this is a verse or passage pin
   */
  isVersePinType(): boolean {
    return this.itemType === 'verse' || this.itemType === 'passage';
  }

  /**
   * Check if this is a verse range
   */
  isVerseRange(): boolean {
    return this.itemType === 'passage' && this.verseIdEnd !== undefined;
  }
}

/**
 * Types of items that can be pinned to a collection.
 *
 * Alias of {@link ItemType} in `Core/Types.ts` - the single source of truth for
 * the open enums, which carry no SQL CHECK constraints
 *. Validate with `assertItemType` at the repository boundary.
 */
export type PinnedItemType = ItemType;
