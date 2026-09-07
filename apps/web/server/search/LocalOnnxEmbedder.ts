/**
 * Local ONNX embedder using @huggingface/transformers.
 *
 * Ported from searchRoutes.ts inline code + embedding-local.js.
 * Uses ~1-1.5GB RAM for the model.
 *
 * Supports mean-centering (anisotropy correction) when meanVectorPath is configured.
 * See docs/bin1/semantic-tester.ignore.md for testing details.
 */

import { readFileSync } from 'fs';
import type { IEmbedder, LocalOnnxEmbedderConfig } from '@bible/core';
import { clampSearchQuery } from '../core.js';
import { configureTransformersEnv } from './transformersEnv.js';

export class LocalOnnxEmbedder implements IEmbedder {
  private modelName: string;
  private dimensions: number;
  private queryPrefix: string;
  private meanVectorPath: string | undefined;
  private dtype: string;
  private modelPath: string | undefined;
  private extractor: any = null;
  private meanVector: number[] | null = null;

  constructor(config: LocalOnnxEmbedderConfig) {
    this.modelName = config.modelName ?? 'nomic-ai/nomic-embed-text-v1.5';
    this.dimensions = config.dimensions ?? 768;
    this.queryPrefix = config.queryPrefix ?? 'search_query: ';
    this.meanVectorPath = config.meanVectorPath;
    // q8 by default: ~317 MB resident and ~13ms/embed, against ~1,053 MB and
    // ~28ms for fp32. The index being searched is int8-quantized anyway.
    this.dtype = config.dtype ?? 'q8';
    this.modelPath = config.modelPath;
  }

  async initialize(): Promise<void> {
    if (this.extractor) return;

    // Load mean vector for centering if configured
    if (this.meanVectorPath) {
      try {
        const data = JSON.parse(readFileSync(this.meanVectorPath, 'utf8'));
        const dimKey = String(this.dimensions);
        if (data.means && data.means[dimKey]) {
          this.meanVector = data.means[dimKey].vector;
          console.log(`[LocalOnnxEmbedder] Loaded ${this.dimensions}d mean vector (norm=${data.means[dimKey].norm}) for centering.`);
        } else {
          console.warn(`[LocalOnnxEmbedder] Mean vector file has no ${this.dimensions}d entry. Centering disabled.`);
        }
      } catch (err: any) {
        console.warn(`[LocalOnnxEmbedder] Failed to load mean vector: ${err.message}. Centering disabled.`);
      }
    }

    console.log(`[LocalOnnxEmbedder] Loading model ${this.modelName} (dtype=${this.dtype})...`);

    // Imported dynamically so the ~hundreds of MB of ONNX runtime only load when
    // semantic search is actually switched on (search.mode: "server"). The failure
    // is translated because a bare MODULE_NOT_FOUND here reads as a code bug; in
    // practice it means the deploy skipped an optional-feature dependency.
    await configureTransformersEnv(this.modelPath);

    let pipeline: typeof import('@huggingface/transformers').pipeline;
    try {
      ({ pipeline } = await import('@huggingface/transformers'));
    } catch (err: any) {
      throw new Error(
        '[LocalOnnxEmbedder] @huggingface/transformers is not installed, so semantic ' +
        'search cannot start. Install it in apps/web, or set search.mode to a ' +
        `non-semantic value in site-config.json. Original error: ${err?.message ?? err}`
      );
    }

    this.extractor = await pipeline('feature-extraction', this.modelName, {
      dtype: this.dtype as any,
    });
    // Warm up
    await this.embedQuery('warmup');
    console.log('[LocalOnnxEmbedder] Model loaded and warmed up.');
  }

  async embedQuery(query: string): Promise<Float32Array> {
    if (!this.extractor) {
      throw new Error('LocalOnnxEmbedder not initialized. Call initialize() first.');
    }

    const prefixed = this.queryPrefix + clampSearchQuery(query);
    const output = await this.extractor([prefixed], { pooling: 'mean', normalize: true });
    const embedding: number[] = output.tolist()[0];

    // Truncate to requested dimensions (Matryoshka)
    const truncated = embedding.slice(0, this.dimensions);

    // Re-normalize after truncation
    normalize(truncated);

    // Apply mean-centering if configured
    if (this.meanVector) {
      for (let i = 0; i < truncated.length; i++) {
        truncated[i] -= this.meanVector[i];
      }
      normalize(truncated);
    }

    return new Float32Array(truncated);
  }

  async dispose(): Promise<void> {
    this.extractor = null;
  }
}

function normalize(vec: number[]): void {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }
}
