/**
 * Search Pipeline Orchestrator.
 *
 * Wires together an IEmbedder, IVectorSearch, and IReranker
 * into a single search operation: embed -> search -> rerank.
 *
 * Ported from search-pipeline.js orchestration pattern.
 */

import type {
  ISearchPipeline,
  IEmbedder,
  IVectorSearch,
  IReranker,
  PipelineSearchOptions,
  PipelineSearchResult,
} from '@bible/core';

export class SearchPipeline implements ISearchPipeline {
  constructor(
    private embedder: IEmbedder,
    private vectorSearch: IVectorSearch,
    private reranker: IReranker,
  ) {}

  async initialize(): Promise<void> {
    await Promise.all([
      this.embedder.initialize(),
      this.vectorSearch.initialize(),
      this.reranker.initialize(),
    ]);
    console.log('[SearchPipeline] All components initialized.');
  }

  async search(query: string, options: PipelineSearchOptions = {}): Promise<PipelineSearchResult> {
    const {
      maxResults = 20,
      rerank = true,
      levels,
      minScore = 0.3,
      candidates = 50,
    } = options;

    const totalStart = Date.now();
    const timings: PipelineSearchResult['timings'] = { total: 0 };

    // Step 1: Embed the query
    const t0 = Date.now();
    const queryVector = await this.embedder.embedQuery(query);
    timings.embed = Date.now() - t0;

    // Step 2: Vector search
    const t1 = Date.now();
    const candidateCount = rerank ? candidates : maxResults;
    const searchResults = await this.vectorSearch.search(queryVector, {
      topN: candidateCount,
      minScore,
      levels,
    });
    timings.vectorSearch = Date.now() - t1;

    // Step 3: Rerank (or pass through)
    let results;
    if (rerank && searchResults.length > 0) {
      const t2 = Date.now();
      results = await this.reranker.rerank(query, searchResults, maxResults);
      timings.rerank = Date.now() - t2;
    } else {
      // No reranking — convert candidates to rerank result format
      results = searchResults.slice(0, maxResults).map(c => ({
        index: c.index,
        rerankerScore: c.score,
        embeddingScore: c.score,
        level: c.level,
        startVerseId: c.startVerseId,
        endVerseId: c.endVerseId,
        text: c.text,
        title: c.title,
      }));
    }

    timings.total = Date.now() - totalStart;

    return {
      results,
      candidateCount: searchResults.length,
      timings,
    };
  }

  async dispose(): Promise<void> {
    await Promise.all([
      this.embedder.dispose(),
      this.vectorSearch.dispose(),
      this.reranker.dispose(),
    ]);
  }
}
