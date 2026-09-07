import { Metadata } from '../../Core/Types';

/**
 * Book section entity from a book module database
 * Represents a section in a book's table of contents with hierarchical structure
 */
export class BookSection {
  sectionId?: number;
  parentSectionId?: number;
  sectionNumber?: string; // e.g., "1.2.3" or "Chapter 5"
  title: string;
  content: string;
  contentFile?: string;
  wordCount?: number;
  metadata?: Metadata;

  constructor(data: {
    sectionId?: number;
    parentSectionId?: number;
    sectionNumber?: string;
    title: string;
    content: string;
    contentFile?: string;
    wordCount?: number;
    metadata?: Metadata;
  }) {
    this.sectionId = data.sectionId;
    this.parentSectionId = data.parentSectionId;
    this.sectionNumber = data.sectionNumber;
    this.title = data.title;
    this.content = data.content;
    this.contentFile = data.contentFile;
    this.wordCount = data.wordCount;
    this.metadata = data.metadata;
  }

  /**
   * Check if this is a top-level section (no parent)
   */
  isTopLevel(): boolean {
    return this.parentSectionId === undefined || this.parentSectionId === null;
  }

  /**
   * Check if this section has child sections
   * Note: This requires querying the database to determine
   */
  hasChildren(): boolean {
    // This will be determined by the repository when loading sections
    return false; // Default, should be set by repository if needed
  }

  /**
   * Get an excerpt of the content
   */
  getExcerpt(maxLength: number = 200): string {
    const plainText = this.content.replace(/<[^>]*>/g, ''); // Strip HTML
    return plainText.length > maxLength
      ? plainText.substring(0, maxLength) + '...'
      : plainText;
  }

  /**
   * Get the full section heading (section number + title)
   */
  getFullHeading(): string {
    if (this.sectionNumber) {
      return `${this.sectionNumber}. ${this.title}`;
    }
    return this.title;
  }

  /**
   * Get the depth level based on section number
   * e.g., "1.2.3" has depth 3, "5" has depth 1
   */
  getDepth(): number {
    if (!this.sectionNumber) {
      return 0;
    }
    return this.sectionNumber.split('.').length;
  }
}

/**
 * Summary of a book section for tree view/navigation
 * Lighter weight than full BookSection
 */
export interface BookSectionSummary {
  sectionId: number;
  parentSectionId?: number;
  sectionNumber?: string;
  title: string;
  wordCount?: number;
  hasChildren?: boolean;
}
