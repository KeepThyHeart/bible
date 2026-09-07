/**
 * Interface for vector similarity search providers.
 *
 * Implementations may use in-memory brute force (SQLite),
 * a native CLI binary, or browser-based search.
 */

import { SearchCandidate, VectorSearchOptions } from './SearchTypes';

export interface IVectorSearch {
  /** Load embeddings or verify binary availability. */
  initialize(): Promise<void>;

  /** Find top-N nearest neighbors for the given query vector. */
  search(queryVector: Float32Array, options: VectorSearchOptions): Promise<SearchCandidate[]>;

  /** Release resources (memory, file handles). */
  dispose(): Promise<void>;
}
