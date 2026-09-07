/**
 * Shared types for the configurable search pipeline.
 *
 * These types are platform-agnostic and used by all implementations
 * (Node.js server, Electron desktop, browser).
 */

/** A candidate result from vector search (before reranking). */
export interface SearchCandidate {
  /** Index or identifier for the candidate (maps to embedding row) */
  index: number;
  /** Cosine similarity or dot-product score from vector search */
  score: number;
  /** Embedding level: verse, paragraph, or chapter */
  level: string;
  /** Start verse ID of the passage */
  startVerseId: number;
  /** End verse ID of the passage */
  endVerseId: number;
  /** The text used for reranking (enriched or plain verse text) */
  text: string;
  /** Passage title from enrichments (paragraph/chapter level) */
  title?: string;
}

/** A result after reranking. */
export interface RerankResult {
  /** Original index from the candidate list */
  index: number;
  /** Score assigned by the reranker (higher = more relevant) */
  rerankerScore: number;
  /** Original embedding/vector search score */
  embeddingScore: number;
  /** Embedding level */
  level: string;
  /** Start verse ID */
  startVerseId: number;
  /** End verse ID */
  endVerseId: number;
  /** Text content */
  text: string;
  /** Passage title from enrichments (paragraph/chapter level) */
  title?: string;
}

/** Options for vector search. */
export interface VectorSearchOptions {
  /** Maximum number of nearest neighbors to return */
  topN: number;
  /** Minimum similarity threshold (0-1). Default: 0.0 */
  minScore?: number;
  /** Filter to specific levels */
  levels?: string[];
}

/** Options for the full pipeline search. */
export interface PipelineSearchOptions {
  /** Maximum number of final results. Default: 20 */
  maxResults?: number;
  /** Whether to apply reranking. Default: true */
  rerank?: boolean;
  /** Filter to specific levels (verse, paragraph, chapter) */
  levels?: string[];
  /** Minimum similarity threshold. Default: 0.3 */
  minScore?: number;
  /** Number of candidates to fetch before reranking. Default: 50 */
  candidates?: number;
}

/** Timing information for pipeline stages. */
export interface PipelineTimings {
  /** Time to embed the query (ms) */
  embed?: number;
  /** Time for vector search (ms) */
  vectorSearch?: number;
  /** Time for reranking (ms) */
  rerank?: number;
  /** Total pipeline time (ms) */
  total: number;
}

/** Final result from the search pipeline. */
export interface PipelineSearchResult {
  /** Ranked results */
  results: RerankResult[];
  /** Total candidates considered */
  candidateCount: number;
  /** Timing breakdown */
  timings: PipelineTimings;
}
