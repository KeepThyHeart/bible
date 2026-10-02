/**
 * Similar passages (task 0070): shared types. Browser-safe: type-only imports.
 *
 * A source passage is compared by its own stored index vectors (no query
 * embedding), either through a precomputed neighbour table or a live scan.
 */

import type { VerseId } from '../../Data/Core/Types';
import type { SemanticLevel } from '../SemanticSearchService';
import type { BibleSectionKey } from '../BibleSections';
import type { SimilarRowKind } from './SimilarWeights';

export type { SemanticLevel };

export interface PassageRange {
  startVerseId: VerseId;
  endVerseId: VerseId;
}

export interface SimilarOptions {
  /** Default 20. */
  maxResults?: number;
  /** Default ['verse', 'paragraph']. */
  levels?: SemanticLevel[];
  /** Drop same-chapter hits within +-N verses of the source (and its paragraph). Default 5. */
  excludeNearby?: number;
  excludeSameChapter?: boolean;
  excludeSameBook?: boolean;
  /** 'other' = the opposite testament of the source. Default 'any'. */
  testament?: 'any' | 'ot' | 'nt' | 'other';
  /** Empty = all sections. */
  sections?: BibleSectionKey[];
  /** Known cross-references: flag (default), hide or ignore. */
  crossRefs?: 'flag' | 'hide' | 'ignore';
  /** Max results per book; 0 = off. Default 3. */
  perBookCap?: number;
  /** Default: max(source floor, top1 * 0.8). */
  minSimilarity?: number;
  source?: 'auto' | 'table' | 'live';
}

export type ResolvedSimilarOptions = Required<Omit<SimilarOptions, 'minSimilarity'>> & {
  minSimilarity: number | null;
};

export const DEFAULT_SIMILAR_OPTIONS: ResolvedSimilarOptions = {
  maxResults: 20,
  levels: ['verse', 'paragraph'],
  excludeNearby: 5,
  excludeSameChapter: false,
  excludeSameBook: false,
  testament: 'any',
  sections: [],
  crossRefs: 'flag',
  perBookCap: 3,
  minSimilarity: null,
  source: 'auto',
};

/** One passage, already aggregated over rows. `score` is on the source's own scale. */
export interface NeighbourHit extends PassageRange {
  level: SemanticLevel;
  score: number;
}

export interface SimilarPassage extends PassageRange {
  level: SemanticLevel;
  similarity: number;
  isCrossReference: boolean;
  crossesTestament: boolean;
  via: 'table' | 'live';
}

export interface SimilarResult {
  source: PassageRange;
  passages: SimilarPassage[];
  via: 'table' | 'live' | 'none';
  /** True when a multi-verse selection was answered from the union of its verses' table lists. */
  approximate: boolean;
  reason?: 'no-data' | 'range-needs-live';
  floor: number;
}

/** A stored index row used as a query. Unit length, in index space. */
export interface QueryRow {
  id: string;
  kind: SimilarRowKind;
  level: SemanticLevel;
  vector: Float32Array;
}

export interface RowHit extends PassageRange {
  id: string;
  level: SemanticLevel;
  similarity: number;
}

export interface IPassageVectorSource {
  neighbourFloor(): number;
  /** Rows at the given levels whose range lies inside the selection. */
  getPassageRows(r: PassageRange, levels: SemanticLevel[]): QueryRow[];
  /** One pass over the index for all queries; per query its top `topK` rows, any similarity. */
  searchRows(queries: Float32Array[], o: { levels: SemanticLevel[]; topK: number }): RowHit[][];
}

export interface NeighbourTableMeta {
  neighbourFloor: number;
  scoreMin: number;
  scoreMax: number;
  k: number;
  levels: SemanticLevel[];
  /** Verses around the source removed at build time. */
  excludeWindow: number;
  weights?: unknown;
  weightsHash?: string;
  sourceIndex?: string;
  sourceDims?: number;
  textSource?: string;
  builtAt?: string;
  builder?: string;
}

export interface INeighbourTable {
  readonly meta: NeighbourTableMeta;
  neighbourFloor(): number;
  /** Exact key (the verse, else the paragraph), or null so the caller falls back. */
  lookup(r: PassageRange): NeighbourHit[] | null;
  /** Max-merge over the verse keys inside the range; null when none. */
  lookupUnion(r: PassageRange): NeighbourHit[] | null;
}

// --- Match explanations ---------------------------------------------------------

export type MatchReason =
  | { kind: 'lemma'; strongs: string; lemma?: string; gloss?: string }
  | { kind: 'topic'; label: string; source: 'naves' | 'torrey' | 'tag' }
  | { kind: 'words'; words: string[] };

export interface PassageFacts {
  range: PassageRange;
  /** Language of `text` (e.g. 'en'). */
  language: string;
  /** Plain text of the passage in the display translation. */
  text: string;
  strongs: Array<{ strongs: string; lemma?: string; gloss?: string }>;
  topics: Array<{ label: string; source: 'naves' | 'torrey' | 'tag' }>;
}
