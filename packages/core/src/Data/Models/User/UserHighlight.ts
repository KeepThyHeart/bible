import { VerseId, HighlightColor, Metadata } from '../../Core/Types';

/**
 * User highlight entity from the user database
 * Represents highlighted text in a Bible module
 */
export class UserHighlight {
  highlightId?: number;
  moduleId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  textStart?: number;
  textEnd?: number;
  color: HighlightColor;
  noteId?: number;
  createdDate?: string;
  metadata?: Metadata;

  constructor(data: {
    highlightId?: number;
    moduleId: number;
    verseIdStart: VerseId;
    verseIdEnd?: VerseId;
    textStart?: number;
    textEnd?: number;
    color: HighlightColor;
    noteId?: number;
    createdDate?: string;
    metadata?: Metadata;
  }) {
    this.highlightId = data.highlightId;
    this.moduleId = data.moduleId;
    this.verseIdStart = data.verseIdStart;
    this.verseIdEnd = data.verseIdEnd;
    this.textStart = data.textStart;
    this.textEnd = data.textEnd;
    this.color = data.color;
    this.noteId = data.noteId;
    this.createdDate = data.createdDate;
    this.metadata = data.metadata;
  }

  /**
   * Check if this is a single verse highlight
   */
  isSingleVerse(): boolean {
    return this.verseIdEnd === undefined || this.verseIdEnd === this.verseIdStart;
  }

  /**
   * Check if this is a partial text highlight (within a verse)
   */
  isPartialText(): boolean {
    return this.textStart !== undefined && this.textEnd !== undefined;
  }

  /**
   * Check if this highlight has an associated note
   */
  hasNote(): boolean {
    return this.noteId !== undefined;
  }

  /**
   * Get the verse range
   */
  getVerseRange(): { start: VerseId; end?: VerseId } {
    return {
      start: this.verseIdStart,
      end: this.verseIdEnd
    };
  }
}
