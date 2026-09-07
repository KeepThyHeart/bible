import { Testament, Metadata } from '../../Core/Types';

/**
 * Bible book entity from the main database
 * Represents a book of the Bible with its metadata and structure
 */
export class BibleBook {
  bookId?: number;
  bookNumber: number;
  bookName: string;
  bookAbbreviation?: string;
  testament: Testament;
  bookGroup?: string;
  chapterCount: number;
  verseCount: number;
  metadata?: Metadata;

  constructor(data: {
    bookId?: number;
    bookNumber: number;
    bookName: string;
    bookAbbreviation?: string;
    testament: Testament;
    bookGroup?: string;
    chapterCount: number;
    verseCount: number;
    metadata?: Metadata;
  }) {
    this.bookId = data.bookId;
    this.bookNumber = data.bookNumber;
    this.bookName = data.bookName;
    this.bookAbbreviation = data.bookAbbreviation;
    this.testament = data.testament;
    this.bookGroup = data.bookGroup;
    this.chapterCount = data.chapterCount;
    this.verseCount = data.verseCount;
    this.metadata = data.metadata;
  }

  /**
   * Get the full display name with testament
   */
  getDisplayName(): string {
    return `${this.bookName} (${this.testament})`;
  }

  /**
   * Check if this is an Old Testament book
   */
  isOldTestament(): boolean {
    return this.testament === 'OT';
  }

  /**
   * Check if this is a New Testament book
   */
  isNewTestament(): boolean {
    return this.testament === 'NT';
  }

  /**
   * Get the abbreviation or default to first 3 characters of name
   */
  getAbbreviation(): string {
    return this.bookAbbreviation ?? this.bookName.substring(0, 3);
  }
}
