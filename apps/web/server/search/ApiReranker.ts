/**
 * API-based reranker (Jina, Cohere, or compatible endpoint).
 *
 * Ported from test-jina-reranker.js jinaRerank function.
 * Negligible RAM — just an HTTP call.
 */

import type { IReranker, SearchCandidate, RerankResult, ApiRerankerConfig } from '@bible/core';

const DEFAULT_MODEL = 'jina-reranker-v2-base-multilingual';

export class ApiReranker implements IReranker {
  private endpoint: string;
  private apiKey: string;
  private model: string;

  constructor(config: ApiRerankerConfig) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async initialize(): Promise<void> {
    // No model loading needed — just verify the key format
    if (!this.apiKey) {
      throw new Error('ApiReranker requires an API key.');
    }
    console.log(`[ApiReranker] Configured with model ${this.model}.`);
  }

  async rerank(query: string, candidates: SearchCandidate[], topN: number): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];

    const documents = candidates.map(c => c.text);

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents,
        top_n: topN,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Reranker API error ${response.status}: ${body}`);
    }

    const data = await response.json() as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    // Jina returns results sorted by relevance_score descending
    return data.results.map(r => {
      const candidate = candidates[r.index];
      return {
        index: candidate.index,
        rerankerScore: r.relevance_score,
        embeddingScore: candidate.score,
        level: candidate.level,
        startVerseId: candidate.startVerseId,
        endVerseId: candidate.endVerseId,
        text: candidate.text,
        title: candidate.title,
      };
    });
  }

  async dispose(): Promise<void> {
    // No resources to release
  }
}
