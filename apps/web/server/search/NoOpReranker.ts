/**
 * No-op reranker — passes candidates through unchanged.
 *
 * Useful for testing or when reranking is not needed.
 * The embedding similarity scores are used as-is.
 */

import type { IReranker, SearchCandidate, RerankResult } from '@bible/core';

export class NoOpReranker implements IReranker {
  async initialize(): Promise<void> {
    // Nothing to initialize
  }

  async rerank(_query: string, candidates: SearchCandidate[], topN: number): Promise<RerankResult[]> {
    return candidates.slice(0, topN).map(c => ({
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

  async dispose(): Promise<void> {
    // Nothing to release
  }
}
