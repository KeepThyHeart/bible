import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import { VerseId, SourceType, LinkType } from '../Core/Types';

/** Filters accepted by the verse-oriented lookups. */
export interface VerseLinkFilter {
  /** Restrict to links hanging off one kind of source row. */
  sourceType?: SourceType;
  /** Restrict to one kind of link. */
  linkType?: LinkType;
  /** Maximum rows to return. */
  limit?: number;
}

/**
 * Repository for the unified `verse_link` table.
 *
 * The table is byte-identical in every module database and in the user database,
 * so one repository serves them all - construct it against whichever connection
 * you need.
 */
export interface IVerseLinkRepository {
  /** True when `verse_link` actually carries rows for `sourceType`. */
  hasLinksFor(sourceType: SourceType): boolean;

  /** All links belonging to one source row, in `sort_order`. */
  getForSource(sourceType: SourceType, sourceId: number): VerseLinkRecord[];

  /**
   * Batch variant of {@link getForSource}. Returns a map keyed by `source_id`;
   * sources with no links are absent from the map.
   */
  getForSources(sourceType: SourceType, sourceIds: number[]): Map<number, VerseLinkRecord[]>;

  /** All links whose inclusive range covers `verseId`. */
  getForVerse(verseId: VerseId, filter?: VerseLinkFilter): VerseLinkRecord[];

  /** All links whose inclusive range overlaps `[startVerseId, endVerseId]`. */
  getForVerseRange(
    startVerseId: VerseId,
    endVerseId: VerseId,
    filter?: VerseLinkFilter
  ): VerseLinkRecord[];

  /** Distinct `source_id`s of a given kind that reference `verseId`. */
  getSourceIdsForVerse(sourceType: SourceType, verseId: VerseId): number[];

  /** Insert one link. Validates `source_type` and `link_type`. */
  create(link: VerseLinkRecord): VerseLinkRecord;

  /** Insert many links in a single transaction. */
  createMany(links: VerseLinkRecord[]): void;

  /** Delete every link belonging to a source row. Returns rows removed. */
  deleteForSource(sourceType: SourceType, sourceId: number): number;

  /** Delete a single link by id. */
  delete(linkId: number): boolean;
}
