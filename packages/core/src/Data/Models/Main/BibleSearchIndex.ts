/**
 * Bible Search Index Model
 *
 * Represents book-level search index metadata.
 * The actual FTS5 index is stored in the bible_search_index virtual table.
 * This model represents the metadata table that tracks indexing status.
 */
export class BibleSearchIndex {
  indexId?: number;
  type: string;
  document: string;
  division: string;
  lastIndexed?: string;
  isIndexed: boolean;
  metadata?: Record<string, any>;

  constructor(data: {
    indexId?: number;
    type: string;
    document: string;
    division: string;
    lastIndexed?: string;
    isIndexed: boolean;
    metadata?: Record<string, any>;
  }) {
    this.indexId = data.indexId;
    this.type = data.type;
    this.document = data.document;
    this.division = data.division;
    this.lastIndexed = data.lastIndexed;
    this.isIndexed = data.isIndexed;
    this.metadata = data.metadata;
  }

  /**
   * Check if this index needs to be rebuilt
   */
  needsReindexing(): boolean {
    return !this.isIndexed;
  }

  /**
   * Get a human-readable description of this index
   */
  getDescription(): string {
    return `${this.type}:${this.document}:${this.division}`;
  }

  /**
   * Get the book number as an integer
   */
  getBookNumber(): number {
    return parseInt(this.division, 10);
  }

  /**
   * Mark as indexed with current timestamp
   */
  markAsIndexed(): void {
    this.isIndexed = true;
    this.lastIndexed = new Date().toISOString();
  }

  /**
   * Mark as needing reindexing
   */
  markForReindex(): void {
    this.isIndexed = false;
  }
}
