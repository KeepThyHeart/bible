import { VerseIdHelper } from '../../Core/Types';

/**
 * Bible Search Verse Position Model
 *
 * Maps individual verses to their character positions within indexed book text.
 * This allows converting FTS5 match positions back to specific verse IDs.
 */
export class BibleSearchVersePosition {
  positionId?: number;
  type: string;
  document: string;
  division: string;
  verseId: number;
  startIndex: number;
  endIndex: number;

  constructor(data: {
    positionId?: number;
    type: string;
    document: string;
    division: string;
    verseId: number;
    startIndex: number;
    endIndex: number;
  }) {
    this.positionId = data.positionId;
    this.type = data.type;
    this.document = data.document;
    this.division = data.division;
    this.verseId = data.verseId;
    this.startIndex = data.startIndex;
    this.endIndex = data.endIndex;
  }

  /**
   * Check if a given character position falls within this verse
   */
  containsPosition(position: number): boolean {
    return position >= this.startIndex && position < this.endIndex;
  }

  /**
   * Check if a position range overlaps with this verse
   */
  overlapsRange(start: number, end: number): boolean {
    return !(end <= this.startIndex || start >= this.endIndex);
  }

  /**
   * Get the length of this verse in characters
   */
  getLength(): number {
    return this.endIndex - this.startIndex;
  }

  /**
   * Get the book, chapter, and verse numbers from the verse ID
   */
  getVerseComponents(): { book: number; chapter: number; verse: number } {
    const parsed = VerseIdHelper.parse(this.verseId);
    return { book: parsed.bookNumber, chapter: parsed.chapter, verse: parsed.verse };
  }

  /**
   * Get a human-readable description
   */
  getDescription(): string {
    const { book, chapter, verse } = this.getVerseComponents();
    return `${this.document} ${book}:${chapter}:${verse} [${this.startIndex}-${this.endIndex})`;
  }
}
