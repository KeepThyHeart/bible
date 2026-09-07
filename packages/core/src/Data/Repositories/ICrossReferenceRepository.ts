import { CrossReferenceGroup } from '../Models/CrossReference/CrossReferenceGroup';
import { ModuleCrossRefEntry } from '../Models/CrossReference/CrossReferenceEntry';
import { CrossReferenceModuleInfo } from '../Models/CrossReference/CrossReferenceModuleInfo';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import { VerseId } from '../Core/Types';

/**
 * Result combining a group with its entries
 */
export interface CrossReferenceGroupWithEntries {
  group: CrossReferenceGroup;
  entries: ModuleCrossRefEntry[];
}

/**
 * Reverse reference result
 */
export interface ReverseReference {
  sourceVerseId: VerseId;
  phrase?: string;
  note?: string;
}

/**
 * A reverse reference plus the passage it cites, so a caller asking about a
 * whole chapter can attribute each citing source to the individual verses it
 * covers. 11.6% of TSK's links target a multi-verse range.
 */
export interface RangeReverseReference extends ReverseReference {
  targetVerseIdStart: VerseId;
  targetVerseIdEnd: VerseId;
}

/**
 * Interface for Cross-Reference repository
 * Defines all operations for working with cross-reference databases
 */
export interface ICrossReferenceRepository {
  // Module Info
  getModuleInfo(): CrossReferenceModuleInfo | undefined;

  // Group Operations
  getGroupsForVerse(verseId: VerseId): CrossReferenceGroup[];
  /**
   * Target passages of a phrase group, from the unified `verse_link` table
   * (`source_type='cross_reference_group'`).
   */
  getEntriesForGroup(groupId: number): ModuleCrossRefEntry[];
  getGroupsWithEntries(verseId: VerseId): CrossReferenceGroupWithEntries[];

  // Verse Link Operations
  /** A group's targets as unified verse links. */
  getVerseLinksForGroup(groupId: number): VerseLinkRecord[];

  /**
   * Bulk variant: get every group (with entries) whose source anchor overlaps
   * the inclusive range. Used by chapter aggregation services to avoid the
   * N+1 query pattern of calling `getGroupsWithEntries` per verse.
   *
   * Groups are returned in `(verse_id_start, sort_order)` order; entries within each
   * group are returned in `sort_order` to match the legacy generation script.
   */
  getGroupsWithEntriesForRange(
    startVerseId: VerseId,
    endVerseId: VerseId
  ): CrossReferenceGroupWithEntries[];

  // Reverse Lookup
  getReverseReferences(verseId: VerseId): ReverseReference[];

  /**
   * Bulk variant of {@link getReverseReferences}: every citing reference for
   * any verse in the inclusive range, tagged with the target it cites.
   *
   * Study mode's "Cited in" row asked this per verse per module - ~31 IPC
   * round trips and 31 queries for one chapter of one module.
   */
  getReverseReferencesForRange(
    startVerseId: VerseId,
    endVerseId: VerseId
  ): RangeReverseReference[];

  // Counts
  getEntryCount(verseId: VerseId): number;
}
