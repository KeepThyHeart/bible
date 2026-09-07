/**
 * API-based embedder using an OpenAI-compatible endpoint.
 *
 * Ported from the search tooling's `lib/embedding.js` (not in this repo).
 * Negligible RAM footprint — just an HTTP call.
 */

import type { IEmbedder, ApiEmbedderConfig } from '@bible/core';

export class ApiEmbedder implements IEmbedder {
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private queryPrefix: string;

  constructor(config: ApiEmbedderConfig) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.dimensions = config.dimensions ?? 768;
    this.queryPrefix = config.queryPrefix ?? 'search_query: ';
  }

  async initialize(): Promise<void> {
    // Verify connectivity with a tiny test embedding
    await this.embedQuery('warmup');
    console.log('[ApiEmbedder] Verified API connectivity.');
  }

  async embedQuery(query: string): Promise<Float32Array> {
    const prefixedQuery = this.queryPrefix + query;

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: [prefixedQuery],
        ...(this.dimensions ? { dimensions: this.dimensions } : {}),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding API error ${response.status}: ${text}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    const sorted = data.data.sort((a, b) => a.index - b.index);
    return new Float32Array(sorted[0].embedding);
  }

  async dispose(): Promise<void> {
    // No resources to release
  }
}
