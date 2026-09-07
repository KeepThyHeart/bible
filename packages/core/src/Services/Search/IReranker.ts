/**
 * Interface for reranking providers.
 *
 * Implementations may use local cross-encoder models,
 * external APIs (Jina, Cohere), or a no-op pass-through.
 */

import { SearchCandidate, RerankResult } from './SearchTypes';

export interface IReranker {
  /** Load model or verify API connectivity. */
  initialize(): Promise<void>;

  /** Rescore candidates against the query and return top-N sorted by relevance. */
  rerank(query: string, candidates: SearchCandidate[], topN: number): Promise<RerankResult[]>;

  /** Release resources. */
  dispose(): Promise<void>;
}
