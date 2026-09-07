/**
 * Factory that creates a wired SearchPipeline from config.
 *
 * Switches on the `provider` discriminant in each config section
 * to instantiate the correct implementation.
 */

import type { SearchPipelineConfig, ISearchPipeline, IEmbedder, IVectorSearch, IReranker, ScoringConfig } from '@bible/core';

import { ApiEmbedder } from './ApiEmbedder.js';
import { LocalOnnxEmbedder } from './LocalOnnxEmbedder.js';
import { SqliteVectorSearch } from './SqliteVectorSearch.js';
import { NativeCliVectorSearch } from './NativeCliVectorSearch.js';
// UsearchVectorSearch is dynamically imported to avoid failing when 'usearch' npm is not installed
import { ApiReranker } from './ApiReranker.js';
import { LocalOnnxReranker } from './LocalOnnxReranker.js';
import { NoOpReranker } from './NoOpReranker.js';
import { SearchPipeline } from './SearchPipeline.js';

function createEmbedder(config: SearchPipelineConfig['embedder']): IEmbedder {
  switch (config.provider) {
    case 'api':
      return new ApiEmbedder(config);
    case 'local-onnx':
      return new LocalOnnxEmbedder(config);
    case 'browser-onnx':
      throw new Error('Browser ONNX embedder is not yet implemented.');
    default:
      throw new Error(`Unknown embedder provider: ${(config as any).provider}`);
  }
}

async function createVectorSearch(config: SearchPipelineConfig['vectorSearch'], scoring?: ScoringConfig): Promise<IVectorSearch> {
  switch (config.provider) {
    case 'sqlite':
      return new SqliteVectorSearch(config, scoring);
    case 'native-cli':
      return new NativeCliVectorSearch(config);
    case 'usearch': {
      const { UsearchVectorSearch } = await import('./UsearchVectorSearch.js');
      return new UsearchVectorSearch(config);
    }
    case 'browser':
      throw new Error('Browser vector search is not yet implemented.');
    default:
      throw new Error(`Unknown vector search provider: ${(config as any).provider}`);
  }
}

function createReranker(config: SearchPipelineConfig['reranker']): IReranker {
  switch (config.provider) {
    case 'api':
      return new ApiReranker(config);
    case 'local-onnx':
      return new LocalOnnxReranker(config);
    case 'none':
      return new NoOpReranker();
    default:
      throw new Error(`Unknown reranker provider: ${(config as any).provider}`);
  }
}

/**
 * Create a SearchPipeline from a config object.
 * Does NOT call initialize() — the caller should do that.
 */
export async function createSearchPipeline(config: SearchPipelineConfig): Promise<ISearchPipeline> {
  const embedder = createEmbedder(config.embedder);
  const vectorSearch = await createVectorSearch(config.vectorSearch, config.scoring);
  const reranker = createReranker(config.reranker);

  return new SearchPipeline(embedder, vectorSearch, reranker);
}

/**
 * Create a SearchPipeline and return the vector search component separately
 * (needed for accessing topic_entries after initialization).
 */
export async function createSearchPipelineWithComponents(config: SearchPipelineConfig): Promise<{ pipeline: ISearchPipeline; vectorSearch: IVectorSearch }> {
  const embedder = createEmbedder(config.embedder);
  const vectorSearch = await createVectorSearch(config.vectorSearch, config.scoring);
  const reranker = createReranker(config.reranker);

  return {
    pipeline: new SearchPipeline(embedder, vectorSearch, reranker),
    vectorSearch,
  };
}
