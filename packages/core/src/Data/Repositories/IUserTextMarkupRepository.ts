import { UserTextMarkup } from '../Models/User/UserTextMarkup';
import { VerseId, HighlightColor } from '../Core/Types';

/**
 * Repository interface for user text markup (highlights, underlines, etc.)
 */
export interface IUserTextMarkupRepository {
  /**
   * Create a new markup
   * Automatically resolves overlaps before inserting
   */
  create(markup: UserTextMarkup): Promise<UserTextMarkup>;

  /**
   * Update an existing markup
   */
  update(markup: UserTextMarkup): Promise<void>;

  /**
   * Delete a markup by ID
   */
  delete(markupId: number): Promise<void>;

  /**
   * Get a markup by ID
   */
  getById(markupId: number): Promise<UserTextMarkup | null>;

  /**
   * Get all markups for a specific verse in a specific module
   */
  getForVerse(verseId: VerseId, moduleId: number): Promise<UserTextMarkup[]>;

  /**
   * Get all markups for a verse range in a specific module
   * Useful for loading highlights for a chapter
   */
  getForVerseRange(
    startVerseId: VerseId,
    endVerseId: VerseId,
    moduleId: number
  ): Promise<UserTextMarkup[]>;

  /**
   * Get all markups in a specific module
   */
  getForModule(moduleId: number): Promise<UserTextMarkup[]>;

  /**
   * Get all markups by color
   */
  getByColor(color: HighlightColor, moduleId?: number): Promise<UserTextMarkup[]>;

  /**
   * Get all markups linked to a specific note
   */
  getByNote(noteId: number): Promise<UserTextMarkup[]>;

  /**
   * Delete all markups for a specific verse
   */
  deleteForVerse(verseId: VerseId, moduleId: number): Promise<void>;

  /**
   * Delete all markups in a verse range (e.g., entire chapter)
   */
  deleteForVerseRange(
    startVerseId: VerseId,
    endVerseId: VerseId,
    moduleId: number
  ): Promise<void>;

  /**
   * Count total markups for a module
   */
  countForModule(moduleId: number): Promise<number>;

  /**
   * Find overlapping markups (for conflict resolution)
   */
  findOverlapping(
    verseIdStart: VerseId,
    verseIdEnd: VerseId | null,
    moduleId: number
  ): Promise<UserTextMarkup[]>;
}
