/**
 * Provider-neutral keyword search types for the swappable data access layer
 * (task 0026, revision 2, subtask M1).
 *
 * `KeywordQuery` is deliberately never an FTS5 MATCH string: every provider
 * (sidecar-fts5, shared-fts5, in-module-fts5, or a future non-SQLite engine)
 * compiles this shape into its own query language.
 */

import { VerseId, ModuleType } from '../Core/Types';
import { BooleanExpression } from '../../types/search';
import { PassageRange } from '../../Api/ApiTypes';
import { KeywordCapability } from './Capabilities';

export type KeywordQuery =
  | { kind: 'terms'; terms: string[]; all: boolean }
  | { kind: 'phrase'; phrase: string }
  | { kind: 'prefix'; stem: string }
  | { kind: 'prefixes'; stems: string[]; all: boolean }
  | { kind: 'near'; terms: string[]; distance: number }
  | { kind: 'boolean'; expr: BooleanExpression };

export interface IndexTarget {
  moduleUuid: string;
  moduleType: ModuleType;
  /** Staleness key: an index is for exactly one revision. */
  contentSha256: string;
}

export interface KeywordSearchOptions {
  /** Subset-search knob. Empty ⇒ every ready target. */
  targets: IndexTarget[];
  limit?: number;
  offset?: number;
  /** Pushed down where a provider can; filtered after where it cannot. */
  scope?: PassageRange[];
  timeoutMs?: number;
}

export interface KeywordHit {
  target: IndexTarget;
  /** Opaque; the content repository resolves it. */
  rowId: number;
  startVerseId?: VerseId;
  endVerseId?: VerseId;
  /** Comparable only WITHIN one providerId. */
  rank: number;
  /** Only when supports.snippetFromIndex. */
  snippet?: string;
}

export interface KeywordSearchResponse {
  hits: KeywordHit[];
  /**
   * Never throw for one bad module. The caller cannot ignore this field
   * without noticing it, which is the entire point.
   */
  skipped: Array<{ target: IndexTarget; reason: KeywordCapability }>;
  truncated: boolean;
}

export interface IndexDocument {
  rowId: number;
  /** Already decompressed and markup-free - the repo's job. */
  text: string;
  startVerseId?: VerseId;
  endVerseId?: VerseId;
}

/** Returned by each content repository (later: M5). */
export interface IIndexSource {
  readonly target: IndexTarget;
  count(): number;
  /** Streamed: a large module never materialises. */
  documents(): Iterable<IndexDocument>;
}

export interface IKeywordIndex {
  readonly providerId: string;
  readonly capability: KeywordCapability;
  search(q: KeywordQuery, o: KeywordSearchOptions): Promise<KeywordSearchResponse>;
  close(): void;
}
