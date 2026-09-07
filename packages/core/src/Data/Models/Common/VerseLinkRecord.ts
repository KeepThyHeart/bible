import { VerseId, Metadata, SourceType, LinkType, resolveRangeEnd } from '../../Core/Types';

/**
 * A row of the unified `verse_link` table.
 *
 * ```sql
 * CREATE TABLE verse_link (
 *     link_id         INTEGER PRIMARY KEY AUTOINCREMENT,
 *     source_type     TEXT NOT NULL,
 *     source_id       INTEGER NOT NULL,
 *     verse_id_start  INTEGER NOT NULL,
 *     verse_id_end    INTEGER,          -- NULL = single verse
 *     link_type       TEXT NOT NULL DEFAULT 'reference',
 *     sort_order      INTEGER NOT NULL DEFAULT 0,
 *     context         TEXT,
 *     metadata        TEXT
 * );
 * ```
 *
 * This one table replaces the six legacy content->verse shapes:
 * `scripture_reference` (book), JSON `scripture_verses` (devotional), JSON
 * `example_verses` (dictionary), `topic_verses` (topical, with reversed column
 * names), `content_verse_link` / `note_verse_link` / `journal_verse_link` (user).
 * It is identical in every module database and in the user database.
 *
 * **Range convention:** see the single normative statement in `Core/Types.ts`
 * (search for "RANGE CONVENTION"). Do not rely on `verseIdEnd === undefined`
 * being distinguishable from `verseIdEnd === verseIdStart`; use
 * {@link VerseLinkRecord.effectiveEnd}.
 *
 * Named `VerseLinkRecord` rather than `VerseLink` because the legacy
 * note-scoped `VerseLink` interface (`Models/User/UserNote`) is still part of
 * the published `@bible/core` surface and is consumed by `@bible/desktop`.
 * Retiring that name is a
 */
export class VerseLinkRecord {
  linkId?: number;
  sourceType: SourceType;
  sourceId: number;
  /** Inclusive start of the linked verse range. */
  verseIdStart: VerseId;
  /** Inclusive end of the linked range; undefined for a single verse. */
  verseIdEnd?: VerseId;
  linkType: LinkType;
  sortOrder: number;
  /** Surrounding text/anchor phrase where the reference appears. */
  context?: string;
  metadata?: Metadata;

  constructor(data: {
    linkId?: number;
    sourceType: SourceType;
    sourceId: number;
    verseIdStart: VerseId;
    verseIdEnd?: VerseId;
    linkType?: LinkType;
    sortOrder?: number;
    context?: string;
    metadata?: Metadata;
  }) {
    this.linkId = data.linkId;
    this.sourceType = data.sourceType;
    this.sourceId = data.sourceId;
    this.verseIdStart = data.verseIdStart;
    this.verseIdEnd = data.verseIdEnd;
    this.linkType = data.linkType ?? 'reference';
    this.sortOrder = data.sortOrder ?? 0;
    this.context = data.context;
    this.metadata = data.metadata;
  }

  /** True when the link targets exactly one verse. */
  isSingleVerse(): boolean {
    return this.verseIdEnd === undefined || this.verseIdEnd === this.verseIdStart;
  }

  /** True when the link spans more than one verse. */
  isRange(): boolean {
    return !this.isSingleVerse();
  }

  /** Inclusive end of the range, defaulting to the start for single verses. */
  effectiveEnd(): VerseId {
    return resolveRangeEnd(this.verseIdStart, this.verseIdEnd);
  }

  /** Number of verse IDs spanned (1 for a single verse). */
  verseCount(): number {
    return this.effectiveEnd() - this.verseIdStart + 1;
  }

  /** True when `verseId` falls inside the inclusive range. */
  containsVerse(verseId: VerseId): boolean {
    return verseId >= this.verseIdStart && verseId <= this.effectiveEnd();
  }
}
