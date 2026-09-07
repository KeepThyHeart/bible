import { Metadata } from '../../Core/Types';

/**
 * Chapter information entity from the main database
 * Contains verse counts and ID ranges for a specific chapter
 */
export class ChapterInfo {
  chapterInfoId?: number;
  bookId: number;
  chapter: number;
  verseCount: number;
  firstAbsoluteId: number;
  lastAbsoluteId: number;
  metadata?: Metadata;

  constructor(data: {
    chapterInfoId?: number;
    bookId: number;
    chapter: number;
    verseCount: number;
    firstAbsoluteId: number;
    lastAbsoluteId: number;
    metadata?: Metadata;
  }) {
    this.chapterInfoId = data.chapterInfoId;
    this.bookId = data.bookId;
    this.chapter = data.chapter;
    this.verseCount = data.verseCount;
    this.firstAbsoluteId = data.firstAbsoluteId;
    this.lastAbsoluteId = data.lastAbsoluteId;
    this.metadata = data.metadata;
  }

  /**
   * Get the range of absolute IDs for this chapter
   */
  getAbsoluteIdRange(): { first: number; last: number } {
    return {
      first: this.firstAbsoluteId,
      last: this.lastAbsoluteId
    };
  }

  /**
   * Check if an absolute ID falls within this chapter
   */
  containsAbsoluteId(absoluteId: number): boolean {
    return absoluteId >= this.firstAbsoluteId && absoluteId <= this.lastAbsoluteId;
  }
}
