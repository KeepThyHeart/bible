/**
 * Mock Repository Implementations
 *
 * Provides mock implementations for non-Bible data repositories.
 * These are simpler data structures that don't require real SQLite testing.
 */

import { IBibleSearchRepository } from '../../Data/Repositories/IBibleSearchRepository';
import { IUserNoteRepository, NoteSummary } from '../../Data/Repositories/IUserNoteRepository';
import { ICollectionRepository } from '../../Data/Repositories/ICollectionRepository';
import { IBibleBookRepository } from '../../Data/Repositories/IBibleBookRepository';
import { SavedSearch } from '../../Data/Models/Main/SavedSearch';
import { BibleSearchIndex } from '../../Data/Models/Main/BibleSearchIndex';
import { BibleSearchVersePosition } from '../../Data/Models/Main/BibleSearchVersePosition';
import { UserNote } from '../../Data/Models/User/UserNote';
import { Collection, PinnedItem } from '../../Data/Models/User/Collection';
import { BibleBook } from '../../Data/Models/Main/BibleBook';
import { ChapterInfo } from '../../Data/Models/Main/ChapterInfo';
import { FTS5Match } from '../../types/search';
import { VerseId, NoteType, Testament } from '../../Data/Core/Types';
import { RepositoryQueryOptions } from '../../Data/Core/IRepository';

/**
 * Mock implementation of IBibleSearchRepository
 * Used for testing saved searches without a database
 */
export class MockBibleSearchRepository implements IBibleSearchRepository {
  private savedSearches: Map<number, SavedSearch> = new Map();
  private indexes: Map<string, BibleSearchIndex> = new Map();
  private versePositions: Map<string, BibleSearchVersePosition[]> = new Map();
  private nextSearchId = 1;

  // ========================================================================
  // Index Management
  // ========================================================================

  isBookIndexed(document: string, division: string): boolean {
    const key = `${document}:${division}`;
    const index = this.indexes.get(key);
    return index?.isIndexed === true;
  }

  getIndexMetadata(document: string, division: string): BibleSearchIndex | undefined {
    const key = `${document}:${division}`;
    return this.indexes.get(key);
  }

  buildBookIndex(
    document: string,
    division: string,
    _bookText: string,
    versePositions: BibleSearchVersePosition[]
  ): void {
    const key = `${document}:${division}`;
    const index = new BibleSearchIndex({
      // `type` is required and the timestamp field is `lastIndexed`; there is
      // no `bookText` on the model. The mock must only build records the
      // repository could actually return.
      type: 'bible',
      document,
      division,
      isIndexed: true,
      lastIndexed: new Date().toISOString(),
    });
    this.indexes.set(key, index);
    this.versePositions.set(key, versePositions);
  }

  clearBookIndex(document: string, division: string): void {
    const key = `${document}:${division}`;
    const index = this.indexes.get(key);
    if (index) {
      index.isIndexed = false;
      index.lastIndexed = undefined;
    }
  }

  deleteBookIndex(document: string, division: string): void {
    const key = `${document}:${division}`;
    this.indexes.delete(key);
    this.versePositions.delete(key);
  }

  getUnindexedBooks(document: string): BibleSearchIndex[] {
    return Array.from(this.indexes.values()).filter(
      idx => idx.document === document && !idx.isIndexed
    );
  }

  getIndexedBooks(document: string): BibleSearchIndex[] {
    return Array.from(this.indexes.values()).filter(
      idx => idx.document === document && idx.isIndexed
    );
  }

  // ========================================================================
  // Proximity Search (Book-Level FTS5)
  // ========================================================================

  searchProximity(
    _document: string,
    _terms: string[],
    _maxDistance: number,
    _division?: string
  ): FTS5Match[] {
    // Simple mock - return empty array
    // Real implementation uses SQLite FTS5
    return [];
  }

  searchPhrase(_document: string, _phrase: string, _division?: string): FTS5Match[] {
    // Simple mock - return empty array
    return [];
  }

  searchFTS5(_document: string, _fts5Query: string, _division?: string): FTS5Match[] {
    // Simple mock - return empty array
    return [];
  }

  // ========================================================================
  // Verse Position Mapping
  // ========================================================================

  getVerseIdAtPosition(
    document: string,
    division: string,
    position: number
  ): VerseId | undefined {
    const key = `${document}:${division}`;
    const positions = this.versePositions.get(key) || [];

    for (const pos of positions) {
      if (position >= pos.startIndex && position < pos.endIndex) {
        return pos.verseId;
      }
    }

    return undefined;
  }

  getVersePosition(
    document: string,
    division: string,
    verseId: VerseId
  ): BibleSearchVersePosition | undefined {
    const key = `${document}:${division}`;
    const positions = this.versePositions.get(key) || [];
    return positions.find(p => p.verseId === verseId);
  }

  getVersesInRange(
    document: string,
    division: string,
    startPos: number,
    endPos: number
  ): BibleSearchVersePosition[] {
    const key = `${document}:${division}`;
    const positions = this.versePositions.get(key) || [];

    return positions.filter(
      p => p.startIndex < endPos && p.endIndex > startPos
    );
  }

  batchInsertVersePositions(positions: BibleSearchVersePosition[]): void {
    for (const pos of positions) {
      const key = `${pos.document}:${pos.division}`;
      const existing = this.versePositions.get(key) || [];
      existing.push(pos);
      this.versePositions.set(key, existing);
    }
  }

  // ========================================================================
  // Saved Searches
  // ========================================================================

  saveSearch(search: SavedSearch): SavedSearch {
    if (!search.searchId) {
      search.searchId = this.nextSearchId++;
      search.createdDate = new Date().toISOString();
    }
    this.savedSearches.set(search.searchId, search);
    return search;
  }

  getSavedSearches(): SavedSearch[] {
    return Array.from(this.savedSearches.values());
  }

  getSavedSearch(searchId: number): SavedSearch | undefined {
    return this.savedSearches.get(searchId);
  }

  updateSavedSearch(search: SavedSearch): SavedSearch {
    if (!search.searchId) {
      throw new Error('Cannot update search without searchId');
    }
    this.savedSearches.set(search.searchId, search);
    return search;
  }

  deleteSavedSearch(searchId: number): boolean {
    return this.savedSearches.delete(searchId);
  }

  getRecentSavedSearches(limit: number = 10): SavedSearch[] {
    return Array.from(this.savedSearches.values())
      .sort((a, b) => {
        const dateA = a.lastUsed || a.createdDate || '';
        const dateB = b.lastUsed || b.createdDate || '';
        return dateB.localeCompare(dateA);
      })
      .slice(0, limit);
  }

  getPopularSavedSearches(limit: number = 10): SavedSearch[] {
    return Array.from(this.savedSearches.values())
      .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
      .slice(0, limit);
  }

  clear(): void {
    this.savedSearches.clear();
    this.indexes.clear();
    this.versePositions.clear();
    this.nextSearchId = 1;
  }
}

/**
 * Mock implementation of IUserNoteRepository
 * Used for testing user notes without database
 */
export class MockUserNoteRepository implements IUserNoteRepository {
  private notes: Map<number, UserNote> = new Map();
  private nextNoteId = 1;

  // ========================================================================
  // Basic CRUD
  // ========================================================================

  create(note: UserNote): UserNote {
    note.noteId = this.nextNoteId++;
    note.createdDate = new Date().toISOString();
    note.modifiedDate = note.createdDate;
    this.notes.set(note.noteId, note);
    return note;
  }

  getById(id: number): UserNote | undefined {
    return this.notes.get(id);
  }

  getAll(options?: RepositoryQueryOptions): UserNote[] {
    let results = Array.from(this.notes.values());

    // Apply ordering if specified
    if (options?.orderBy) {
      results.sort((a, b) => {
        const aVal = (a as any)[options.orderBy!];
        const bVal = (b as any)[options.orderBy!];
        if (options.orderDirection === 'DESC') {
          return bVal > aVal ? 1 : -1;
        }
        return aVal > bVal ? 1 : -1;
      });
    }

    // Apply limit
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  update(note: UserNote): UserNote {
    if (!note.noteId) {
      throw new Error('Cannot update note without noteId');
    }
    note.modifiedDate = new Date().toISOString();
    this.notes.set(note.noteId, note);
    return note;
  }

  delete(id: number): boolean {
    return this.notes.delete(id);
  }

  // ========================================================================
  // Querying by Type and Attributes
  // ========================================================================

  getByType(noteType: NoteType): UserNote[] {
    return Array.from(this.notes.values()).filter(n => n.noteType === noteType);
  }

  getForVerse(verseId: VerseId): UserNote[] {
    return Array.from(this.notes.values()).filter(
      n => n.verseIdStart === verseId ||
           (n.verseIdStart !== undefined && n.verseIdEnd !== undefined &&
            verseId >= n.verseIdStart && verseId <= n.verseIdEnd)
    );
  }

  getForVerseRange(startVerseId: VerseId, endVerseId: VerseId): UserNote[] {
    return Array.from(this.notes.values()).filter(
      n => n.verseIdStart !== undefined &&
           n.verseIdStart >= startVerseId &&
           n.verseIdStart <= endVerseId
    );
  }

  getByTag(tag: string): UserNote[] {
    return Array.from(this.notes.values()).filter(n =>
      n.tags.includes(tag)
    );
  }

  getByUserCommentary(userCommentaryId: number): UserNote[] {
    return Array.from(this.notes.values()).filter(
      n => n.userCommentaryId === userCommentaryId
    );
  }

  getByDocumentType(documentType: string): UserNote[] {
    return Array.from(this.notes.values()).filter(
      n => n.documentType === documentType
    );
  }

  getBySeriesName(seriesName: string): UserNote[] {
    return Array.from(this.notes.values()).filter(
      n => n.seriesName === seriesName
    );
  }

  // ========================================================================
  // Hierarchy
  // ========================================================================

  getTopLevelNotes(): UserNote[] {
    return Array.from(this.notes.values()).filter(n => !n.parentNoteId);
  }

  getChildNotes(parentNoteId: number): UserNote[] {
    return Array.from(this.notes.values()).filter(
      n => n.parentNoteId === parentNoteId
    );
  }

  // ========================================================================
  // Search
  // ========================================================================

  search(query: string, _options?: RepositoryQueryOptions): UserNote[] {
    // Simple mock search - just look for substring matches
    const lowerQuery = query.toLowerCase();
    return Array.from(this.notes.values()).filter(n =>
      n.title?.toLowerCase().includes(lowerQuery) ||
      n.content.toLowerCase().includes(lowerQuery)
    );
  }

  // ========================================================================
  // Navigation
  // ========================================================================

  getNextVerseWithContent(currentVerseId: VerseId): VerseId | undefined {
    const notesWithVerses = Array.from(this.notes.values())
      .filter(n => n.verseIdStart !== undefined && n.verseIdStart > currentVerseId)
      .sort((a, b) => a.verseIdStart! - b.verseIdStart!);

    return notesWithVerses.length > 0 ? notesWithVerses[0].verseIdStart : undefined;
  }

  getPreviousVerseWithContent(currentVerseId: VerseId): VerseId | undefined {
    const notesWithVerses = Array.from(this.notes.values())
      .filter(n => n.verseIdStart !== undefined && n.verseIdStart < currentVerseId)
      .sort((a, b) => b.verseIdStart! - a.verseIdStart!);

    return notesWithVerses.length > 0 ? notesWithVerses[0].verseIdStart : undefined;
  }

  // ========================================================================
  // Summary
  // ========================================================================

  getAllNoteSummaries(): NoteSummary[] {
    // `NoteSummary` is deliberately narrow - it feeds the notes tree, which
    // shows a title and a date. The old mock also returned `noteType`, `tags`,
    // `parentNoteId` and a `contentPreview`, none of which the repository
    // produces; a test asserting on one of those was asserting on a fiction.
    return Array.from(this.notes.values()).map(n => ({
      noteId: n.noteId!,
      verseIdStart: n.verseIdStart!,
      verseIdEnd: n.verseIdEnd,
      title: n.title,
      modifiedDate: n.modifiedDate ?? '',
    }));
  }

  countDescendants(noteId: number): number {
    let count = 0;
    const walk = (parentId: number): void => {
      for (const note of this.notes.values()) {
        if (note.parentNoteId === parentId) {
          count++;
          walk(note.noteId!);
        }
      }
    };
    walk(noteId);
    return count;
  }

  getModifiedSince(since: string, limit?: number): UserNote[] {
    const matches = Array.from(this.notes.values())
      .filter(n => (n.modifiedDate ?? '') > since)
      .sort((a, b) => (b.modifiedDate ?? '').localeCompare(a.modifiedDate ?? ''));
    return limit === undefined ? matches : matches.slice(0, limit);
  }

  getVersesWithNotesInRange(startVerseId: VerseId, endVerseId: VerseId): VerseId[] {
    const verses = new Set<VerseId>();
    for (const note of this.notes.values()) {
      const start = note.verseIdStart;
      if (start !== undefined && start >= startVerseId && start <= endVerseId) {
        verses.add(start);
      }
    }
    return Array.from(verses).sort((a, b) => a - b);
  }

  // ========================================================================
  // Test Utilities
  // ========================================================================

  /**
   * Clear all mock data (for test cleanup)
   */
  clear(): void {
    this.notes.clear();
    this.nextNoteId = 1;
  }
}

/**
 * Mock implementation of ICollectionRepository
 * Used for testing collections and bookmarks without database
 */
export class MockCollectionRepository implements ICollectionRepository {
  private collections: Map<number, Collection> = new Map();
  private pinnedItems: Map<number, PinnedItem> = new Map();
  private nextCollectionId = 1;
  private nextPinId = 1;

  // ===== Collection CRUD =====

  create(collection: Collection): number {
    collection.collectionId = this.nextCollectionId++;
    collection.createdDate = new Date().toISOString();
    collection.modifiedDate = collection.createdDate;
    this.collections.set(collection.collectionId, collection);
    return collection.collectionId;
  }

  update(collection: Collection): void {
    if (!collection.collectionId) {
      throw new Error('Cannot update collection without ID');
    }
    collection.modifiedDate = new Date().toISOString();
    this.collections.set(collection.collectionId, collection);
  }

  delete(collectionId: number): void {
    // Delete all pinned items in this collection
    Array.from(this.pinnedItems.values())
      .filter(item => item.collectionId === collectionId)
      .forEach(item => {
        if (item.pinId) {
          this.pinnedItems.delete(item.pinId);
        }
      });
    this.collections.delete(collectionId);
  }

  getById(collectionId: number): Collection | undefined {
    return this.collections.get(collectionId);
  }

  getAll(): Collection[] {
    return Array.from(this.collections.values());
  }

  getTopLevel(): Collection[] {
    return Array.from(this.collections.values()).filter(
      c => !c.parentCollectionId
    );
  }

  getChildren(parentId: number): Collection[] {
    return Array.from(this.collections.values()).filter(
      c => c.parentCollectionId === parentId
    );
  }

  getCollectionTree(): Collection[] {
    const buildTree = (parentId?: number): Collection[] => {
      const collections = parentId
        ? this.getChildren(parentId)
        : this.getTopLevel();

      return collections.map(collection => {
        const children = buildTree(collection.collectionId);
        if (children.length > 0) {
          children.forEach(child => collection.addChild(child));
        }
        return collection;
      });
    };

    return buildTree();
  }

  // ===== Pinned Item Operations =====

  addPinnedItem(item: PinnedItem): number {
    item.pinId = this.nextPinId++;
    item.createdDate = new Date().toISOString();
    this.pinnedItems.set(item.pinId, item);
    return item.pinId;
  }

  updatePinnedItem(item: PinnedItem): void {
    if (!item.pinId) {
      throw new Error('Cannot update pinned item without ID');
    }
    this.pinnedItems.set(item.pinId, item);
  }

  deletePinnedItem(pinId: number): void {
    this.pinnedItems.delete(pinId);
  }

  getPinnedItem(pinId: number): PinnedItem | undefined {
    return this.pinnedItems.get(pinId);
  }

  getPinnedItemsForCollection(collectionId: number): PinnedItem[] {
    return Array.from(this.pinnedItems.values())
      .filter(item => item.collectionId === collectionId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getPinnedItemsByVerse(verseId: number): PinnedItem[] {
    return Array.from(this.pinnedItems.values()).filter(
      item =>
        item.verseIdStart === verseId ||
        (item.verseIdStart !== undefined &&
          item.verseIdEnd !== undefined &&
          verseId >= item.verseIdStart &&
          verseId <= item.verseIdEnd)
    );
  }

  // ===== Search & Query =====

  findCollectionsByName(searchTerm: string): Collection[] {
    const lowerSearch = searchTerm.toLowerCase();
    return Array.from(this.collections.values()).filter(c =>
      c.name.toLowerCase().includes(lowerSearch)
    );
  }

  getCollectionsContainingVerse(verseId: number): Collection[] {
    const collectionIds = new Set(
      this.getPinnedItemsByVerse(verseId).map(item => item.collectionId)
    );
    return Array.from(this.collections.values()).filter(c =>
      c.collectionId && collectionIds.has(c.collectionId)
    );
  }

  isVerseBookmarked(verseId: number): boolean {
    return this.getPinnedItemsByVerse(verseId).length > 0;
  }

  getCollectionItemCount(collectionId: number): number {
    return this.getPinnedItemsForCollection(collectionId).length;
  }

  // ===== Bulk Operations =====

  moveCollection(collectionId: number, newParentId: number | null): void {
    const collection = this.collections.get(collectionId);
    if (collection) {
      collection.parentCollectionId = newParentId ?? undefined;
      collection.modifiedDate = new Date().toISOString();
    }
  }

  reorderCollections(collectionIds: number[]): void {
    collectionIds.forEach((id, index) => {
      const collection = this.collections.get(id);
      if (collection) {
        collection.sortOrder = index;
      }
    });
  }

  reorderPinnedItems(pinIds: number[]): void {
    pinIds.forEach((id, index) => {
      const item = this.pinnedItems.get(id);
      if (item) {
        item.sortOrder = index;
      }
    });
  }

  // ===== Test Utilities =====

  clear(): void {
    this.collections.clear();
    this.pinnedItems.clear();
    this.nextCollectionId = 1;
    this.nextPinId = 1;
  }
}

/**
 * Mock implementation of IBibleBookRepository
 * Used for testing with a small set of Bible books
 */
export class MockBibleBookRepository implements IBibleBookRepository {
  private books: Map<number, BibleBook> = new Map();
  private chapterInfo: Map<string, ChapterInfo> = new Map();

  constructor() {
    // Initialize with some common books
    this.initializeDefaultBooks();
  }

  private initializeDefaultBooks(): void {
    const defaultBooks = [
      new BibleBook({
        bookId: 1,
        bookNumber: 1,
        bookName: 'Genesis',
        bookAbbreviation: 'Gen',
        testament: 'OT',
        bookGroup: 'Law',
        chapterCount: 50,
        verseCount: 1533,
      }),
      new BibleBook({
        bookId: 19,
        bookNumber: 19,
        bookName: 'Psalms',
        bookAbbreviation: 'Ps',
        testament: 'OT',
        bookGroup: 'Poetry',
        chapterCount: 150,
        verseCount: 2461,
      }),
      new BibleBook({
        bookId: 40,
        bookNumber: 40,
        bookName: 'Matthew',
        bookAbbreviation: 'Matt',
        testament: 'NT',
        bookGroup: 'Gospels',
        chapterCount: 28,
        verseCount: 1071,
      }),
      new BibleBook({
        bookId: 43,
        bookNumber: 43,
        bookName: 'John',
        bookAbbreviation: 'John',
        testament: 'NT',
        bookGroup: 'Gospels',
        chapterCount: 21,
        verseCount: 879,
      }),
      new BibleBook({
        bookId: 45,
        bookNumber: 45,
        bookName: 'Romans',
        bookAbbreviation: 'Rom',
        testament: 'NT',
        bookGroup: 'Pauline Epistles',
        chapterCount: 16,
        verseCount: 433,
      }),
      new BibleBook({
        bookId: 46,
        bookNumber: 46,
        bookName: '1 Corinthians',
        bookAbbreviation: '1 Cor',
        testament: 'NT',
        bookGroup: 'Pauline Epistles',
        chapterCount: 16,
        verseCount: 437,
      }),
      new BibleBook({
        bookId: 66,
        bookNumber: 66,
        bookName: 'Revelation',
        bookAbbreviation: 'Rev',
        testament: 'NT',
        bookGroup: 'Apocalyptic',
        chapterCount: 22,
        verseCount: 404,
      }),
    ];

    defaultBooks.forEach(book => {
      if (book.bookId) {
        this.books.set(book.bookId, book);
      }
    });
  }

  getById(id: number): BibleBook | undefined {
    return this.books.get(id);
  }

  getByBookNumber(bookNumber: number): BibleBook | undefined {
    return Array.from(this.books.values()).find(b => b.bookNumber === bookNumber);
  }

  getByName(name: string): BibleBook | undefined {
    const lowerName = name.toLowerCase();
    return Array.from(this.books.values()).find(
      b => b.bookName.toLowerCase() === lowerName
    );
  }

  getAll(options?: RepositoryQueryOptions): BibleBook[] {
    let results = Array.from(this.books.values());

    // Apply ordering
    if (options?.orderBy) {
      results.sort((a, b) => {
        const aVal = (a as any)[options.orderBy!];
        const bVal = (b as any)[options.orderBy!];
        if (options.orderDirection === 'DESC') {
          return bVal > aVal ? 1 : -1;
        }
        return aVal > bVal ? 1 : -1;
      });
    }

    // Apply limit
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  getByTestament(testament: Testament): BibleBook[] {
    return Array.from(this.books.values()).filter(b => b.testament === testament);
  }

  getByBookGroup(bookGroup: string): BibleBook[] {
    return Array.from(this.books.values()).filter(b => b.bookGroup === bookGroup);
  }

  create(entity: BibleBook): BibleBook {
    if (!entity.bookId) {
      entity.bookId = Math.max(...Array.from(this.books.keys()), 0) + 1;
    }
    this.books.set(entity.bookId, entity);
    return entity;
  }

  update(entity: BibleBook): BibleBook {
    if (!entity.bookId) {
      throw new Error('Cannot update book without ID');
    }
    this.books.set(entity.bookId, entity);
    return entity;
  }

  delete(id: number): boolean {
    return this.books.delete(id);
  }

  getTotalVerseCount(): number {
    return Array.from(this.books.values()).reduce(
      (sum, book) => sum + book.verseCount,
      0
    );
  }

  search(query: string): BibleBook[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.books.values()).filter(
      b =>
        b.bookName.toLowerCase().includes(lowerQuery) ||
        b.bookAbbreviation?.toLowerCase().includes(lowerQuery)
    );
  }

  // Chapter Info methods
  getChapterInfo(bookId: number, chapter: number): ChapterInfo | undefined {
    const key = `${bookId}:${chapter}`;
    return this.chapterInfo.get(key);
  }

  getBookChapterInfo(bookId: number): ChapterInfo[] {
    return Array.from(this.chapterInfo.values()).filter(
      info => info.bookId === bookId
    );
  }

  getChapterInfoByBookNumber(bookNumber: number): ChapterInfo[] {
    const book = this.getByBookNumber(bookNumber);
    if (!book || !book.bookId) return [];
    return this.getBookChapterInfo(book.bookId);
  }

  // Test utilities
  clear(): void {
    this.books.clear();
    this.chapterInfo.clear();
    this.initializeDefaultBooks();
  }
}
