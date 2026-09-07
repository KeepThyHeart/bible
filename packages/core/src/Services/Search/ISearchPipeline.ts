/**
 * Interface for the full search pipeline orchestrator.
 *
 * Combines embedding, vector search, and reranking into
 * a single search operation.
 */

import { PipelineSearchOptions, PipelineSearchResult } from './SearchTypes';

export interface ISearchPipeline {
  /** Initialize all pipeline components. */
  initialize(): Promise<void>;

  /** Run the full search pipeline: embed -> search -> rerank. */
  search(query: string, options?: PipelineSearchOptions): Promise<PipelineSearchResult>;

  /** Release all resources. */
  dispose(): Promise<void>;
}
