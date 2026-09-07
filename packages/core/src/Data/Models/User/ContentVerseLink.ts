import { VerseId, Metadata, LinkType, resolveRangeEnd } from '../../Core/Types';

/**
 * Content type for verse links.
 *
 * The user-database subset of `verse_link.source_type`; see `SOURCE_TYPES` in
 * `Core/Types.ts` for the full vocabulary.
 */
export type ContentType = 'note' | 'journal' | 'prayer' | 'document';

/**
 * Link type for verse references.
 *
 * Alias of {@link LinkType} in `Core/Types.ts` - the single source of truth for
 * the open enums, which carry no SQL CHECK constraints. The vocabulary
 * includes `'cross_reference'`.
 */
export type { LinkType };

/**
 * Unified content-verse link entity (user database).
 *
 * Superseded by the unified `verse_link` table and
 * {@link VerseLinkRecord} (`Models/Common/VerseLinkRecord`). Retained because
 * `content_verse_link` still exists in user databases.
 * point.
 */
export class ContentVerseLink {
  linkId?: number;
  contentType: ContentType;
  contentId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  linkType: LinkType;
  position?: number;
  metadata?: Metadata;

  constructor(data: {
    linkId?: number;
    contentType: ContentType;
    contentId: number;
    verseIdStart: VerseId;
    verseIdEnd?: VerseId;
    linkType?: LinkType;
    position?: number;
    metadata?: Metadata;
  }) {
    this.linkId = data.linkId;
    this.contentType = data.contentType;
    this.contentId = data.contentId;
    this.verseIdStart = data.verseIdStart;
    this.verseIdEnd = data.verseIdEnd;
    this.linkType = data.linkType ?? 'reference';
    this.position = data.position;
    this.metadata = data.metadata;
  }

  /**
   * Check if this link represents a verse range.
   * Range semantics: see the normative statement in `Core/Types.ts`.
   */
  isRange(): boolean {
    return resolveRangeEnd(this.verseIdStart, this.verseIdEnd) !== this.verseIdStart;
  }

  /**
   * Get context from metadata if available
   */
  getContext(): string | undefined {
    const ctx = this.metadata?.context;
    return typeof ctx === 'string' ? ctx : undefined;
  }
}
