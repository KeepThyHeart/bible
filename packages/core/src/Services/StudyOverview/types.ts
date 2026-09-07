/**
 * Result types for StudyOverview aggregation services.
 *
 * These shapes mirror the wire format used by the pre-generated study cache
 * (see scripts/generate-study-cache.js and apps/web/server/routes/studyOverviewRoutes.ts).
 *
 * **Wire-format compatibility note:** field names are intentionally short
 * (m, mn, s, e, l, w, ...) and **must not be renamed** without also changing
 * the cache format and every consumer. Any changes here invalidate every
 * generated study_cache.db.
 */

import { VerseId } from '../../Data/Core/Types';

// -- Module reference ------------------------------------------------------

/**
 * A repository instance plus its associated module metadata.
 * Aggregation services accept arrays of these so each output entry can be
 * tagged with the originating module abbreviation and human-readable name.
 */
export interface AggregationModule<TRepo> {
  abbreviation: string;
  moduleName: string;
  repository: TRepo;
}

// -- Commentary overview ---------------------------------------------------

/**
 * One commentary entry's metadata (no body text) for a chapter overview.
 * Body text is fetched on demand from the originating commentary module.
 */
export interface ChapterCommentaryEntryOverview {
  /** Module abbreviation (e.g. "mhc") */
  m: string;
  /** Module display name */
  mn: string;
  /** Verse id range start */
  s: VerseId;
  /** Verse id range end (== s for single-verse entries) */
  e: VerseId;
  /** Entry level: 'verse' | 'passage' | 'chapter' | 'book' */
  l: string;
  /** Word count of the entry body */
  w: number;
}

export type ChapterCommentaryOverview = ChapterCommentaryEntryOverview[];

// -- Topics ----------------------------------------------------------------

/**
 * One ancestor of a topic: `[topicId, name, recursiveVerseCount]`.
 *
 * A tuple keeps the cache compact. The names duplicate `p`, but `p` is a
 * pre-joined display string that cannot be split back into ancestors safely
 * (a topic name may itself contain " > ") and carries no ids at all - which
 * is what left every breadcrumb ancestor unopenable in the study pane.
 */
export type VerseTopicAncestor = [topicId: number, name: string, verseCount: number];

/** One topic occurrence at a verse, tagged with its source module. */
export interface VerseTopicEntry {
  /** Topic id within its module */
  id: number;
  /** Topic name */
  n: string;
  /** Parent chain joined with " > " (omitted if root) */
  p?: string;
  /**
   * Ancestors root-first, one tuple each (omitted if root). Consumers should
   * prefer this over `p`: it is the only form carrying the ids needed to open
   * an ancestor topic. Caches generated before this field existed have `p`
   * only, so readers must tolerate its absence.
   */
  a?: VerseTopicAncestor[];
  /** Recursive verse count for this topic + descendants */
  vc: number;
  /** Source module abbreviation */
  src: string;
  /** Source module display name */
  sn: string;
  /** Optional topic description */
  d?: string;
}

/** Map of verseId (as string key) to topic entries. */
export type TopicsByVerse = Record<string, VerseTopicEntry[]>;

// -- Cross-references ------------------------------------------------------

export interface VerseCrossRefGroup {
  id: number;
  /** Phrase scope (omitted if the group is general) */
  ph?: string;
  so: number;
}

export interface VerseCrossRefEntry {
  /** Target verse id */
  tv: VerseId;
  /** Target verse range end (omitted if single verse) */
  tve?: VerseId;
  /** Note (omitted if absent) */
  n?: string;
  so: number;
}

export interface VerseCrossRefBlock {
  src: string;
  g: VerseCrossRefGroup;
  e: VerseCrossRefEntry[];
}

export type CrossRefsByVerse = Record<string, VerseCrossRefBlock[]>;

// -- Tag-graph entities ----------------------------------------------------

export interface VerseEntityEntry {
  /** Entity id */
  eid: string;
  /** Entity category: 'people' | 'places' | 'objects' | 'themes' */
  cat: string;
  /** Entity display name */
  n: string;
  /** Range end verse id (omitted if single verse) */
  eve?: VerseId;
  /** Source label (omitted if absent) */
  src?: string;
}

export type EntitiesByVerse = Record<string, VerseEntityEntry[]>;

// -- Helpers ---------------------------------------------------------------

/**
 * Compute the inclusive verse-id range for a given (book, chapter).
 * Matches the script's `chapterStart`/`chapterEnd` helpers.
 */
export function chapterStart(book: number, chapter: number): VerseId {
  return book * 1000000 + chapter * 1000;
}
export function chapterEnd(book: number, chapter: number): VerseId {
  return book * 1000000 + chapter * 1000 + 999;
}
