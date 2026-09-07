import { VerseId, HighlightColor, Metadata } from '../../Core/Types';
import { normalizeMarkupColor, markupColorName } from '../../Core/Colors';

/**
 * Metadata structure for text markup
 * Extensible design allows future markup types without schema changes
 */
export interface TextMarkupMetadata extends Metadata {
  markupType?: 'highlight' | 'underline' | 'both' | string;  // string allows future types
  underlineStyle?: 'solid' | 'wavy' | 'dotted' | 'dashed';
  underlineColor?: HighlightColor;  // Independent underline color

  // Future markup properties (examples)
  strikeColor?: HighlightColor;
  boxStyle?: 'solid' | 'dashed' | 'rounded';
  borderColor?: string;
  backgroundColor?: string;

  wordCount?: number;
  version?: number;

  // Allow additional properties for future extensibility
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * User text markup entity from the user database.
 * Represents any type of text markup (highlight, underline, strikethrough, etc.)
 *
 * ## Colour storage
 *
 * Stored as hex `#RRGGBB`, matching
 * `collection.color`. This is live user data, so {@link color} accepts either -
 * it is typed `string` rather than `HighlightColor` for exactly that reason.
 * Use {@link getColorHex} for a canonical hex value and {@link getColorName}
 * when you need the palette swatch.
 *
 * ## Word offsets
 *
 * {@link textStart} / {@link textEnd} are 0-based inclusive word indices, which
 * is the project-wide convention and was already true for this table.
 */
export class UserTextMarkup {
  markupId?: number;
  moduleId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  /** First word covered. 0-based, inclusive. */
  textStart?: number;
  /** Last word covered. 0-based, inclusive. */
  textEnd?: number;
  /**
   * Primary colour. Written as hex `#RRGGBB`; a palette name is also accepted.
   * Read through {@link getColorHex} / {@link getColorName}.
   */
  color: string;
  noteId?: number;
  createdDate?: string;
  metadata?: TextMarkupMetadata;

  constructor(data: {
    markupId?: number;      // Renamed from highlightId
    moduleId: number;
    verseIdStart: VerseId;
    verseIdEnd?: VerseId;
    textStart?: number;
    textEnd?: number;
    /** Hex `#RRGGBB` or a palette name (v1). */
    color: string;
    noteId?: number;
    createdDate?: string;
    metadata?: TextMarkupMetadata;
  }) {
    this.markupId = data.markupId;
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
    return this.verseIdEnd === undefined || this.verseIdEnd === null;
  }

  /**
   * Check if this is a multi-verse highlight
   */
  isMultiVerse(): boolean {
    return !this.isSingleVerse();
  }

  /**
   * Check if this is a partial text highlight (not whole verses)
   */
  isPartialText(): boolean {
    return this.textStart !== undefined && this.textEnd !== undefined;
  }

  /**
   * Check if this highlight has an associated note
   */
  hasNote(): boolean {
    return this.noteId !== undefined && this.noteId !== null;
  }

  /**
   * Get the verse range
   */
  getVerseRange(): { start: VerseId; end: VerseId } {
    return {
      start: this.verseIdStart,
      end: this.verseIdEnd || this.verseIdStart
    };
  }

  /**
   * Get markup type (default: 'highlight')
   */
  getMarkupType(): 'highlight' | 'underline' | 'both' {
    return (this.metadata?.markupType as 'highlight' | 'underline' | 'both') || 'highlight';
  }

  /**
   * Get underline style (default: 'solid')
   */
  getUnderlineStyle(): 'solid' | 'wavy' | 'dotted' | 'dashed' {
    return this.metadata?.underlineStyle || 'solid';
  }

  /**
   * Canonical `#RRGGBB` for this markup, resolving a palette name if needed.
   */
  getColorHex(): string {
    return normalizeMarkupColor(this.color);
  }

  /**
   * The palette swatch name, when the colour is one of the six. Returns
   * undefined for a custom colour - fall back to {@link getColorHex}.
   */
  getColorName(): HighlightColor | undefined {
    return markupColorName(this.color);
  }

  /**
   * Get underline color (default: same as highlight color), as canonical hex.
   */
  getUnderlineColor(): string {
    return normalizeMarkupColor(this.metadata?.underlineColor ?? this.color);
  }

  /**
   * Check if this highlight includes highlighting (background color)
   */
  hasHighlight(): boolean {
    const type = this.getMarkupType();
    return type === 'highlight' || type === 'both';
  }

  /**
   * Check if this highlight includes underlining
   */
  hasUnderline(): boolean {
    const type = this.getMarkupType();
    return type === 'underline' || type === 'both';
  }

  /**
   * Check if a specific verse is covered by this highlight
   */
  coversVerse(verseId: VerseId): boolean {
    const start = this.verseIdStart;
    const end = this.verseIdEnd || start;
    return verseId >= start && verseId <= end;
  }

  /**
   * Get word range for a specific verse within this highlight
   * Returns null if verse is not covered
   */
  getWordRangeForVerse(verseId: VerseId): { start: number; end: number | null } | null {
    if (!this.coversVerse(verseId)) {
      return null;
    }

    const start = this.verseIdStart;
    const end = this.verseIdEnd || start;

    if (start === end) {
      // Single verse - use specified word range
      return {
        start: this.textStart ?? 0,
        end: this.textEnd ?? null
      };
    }

    if (verseId === start) {
      // First verse - from textStart to end of verse
      return {
        start: this.textStart ?? 0,
        end: null  // null = to end of verse
      };
    }

    if (verseId === end) {
      // Last verse - from start of verse to textEnd
      return {
        start: 0,
        end: this.textEnd ?? null
      };
    }

    // Middle verse - entire verse
    return {
      start: 0,
      end: null  // null = to end of verse
    };
  }
}
