/**
 * Local ONNX cross-encoder reranker using @huggingface/transformers.
 *
 * Uses a cross-encoder model (e.g., ms-marco-MiniLM-L-2-v2) to rescore
 * (query, document) pairs. More precise than bi-encoder similarity because
 * the model attends to both texts simultaneously.
 *
 * RAM: ~60 MB for L-2, ~87 MB for L-6 (fp32).
 *
 * Ported from the search tooling's `lib/reranker.js` (not in this repo).
 */

import type { IReranker, SearchCandidate, RerankResult, LocalOnnxRerankerConfig } from '@bible/core';
import { configureTransformersEnv } from './transformersEnv.js';

const DEFAULT_MODEL = 'cross-encoder/ms-marco-MiniLM-L-6-v2';

// Models whose output is a similarity score in [0, 5] rather than a logit
const STS_MODELS = new Set([
  'cross-encoder/stsb-distilroberta-base',
  'cross-encoder/stsb-roberta-base',
  'cross-encoder/stsb-roberta-large',
  'cross-encoder/stsb-TinyBERT-L-4',
]);

export class LocalOnnxReranker implements IReranker {
  private modelName: string;
  private isSTS: boolean;
  private dtype: string;
  private maxLength: number;
  private modelPath: string | undefined;
  private tokenizer: any = null;
  private model: any = null;

  constructor(config: LocalOnnxRerankerConfig) {
    this.modelName = config.modelName ?? DEFAULT_MODEL;
    this.isSTS = STS_MODELS.has(this.modelName);
    // fp32 by default — see LocalOnnxRerankerConfig.dtype for why this differs
    // from the embedder's q8 default.
    this.dtype = config.dtype ?? 'fp32';
    this.maxLength = config.maxLength ?? 128;
    this.modelPath = config.modelPath;
  }

  async initialize(): Promise<void> {
    if (this.model) return;

    console.log(`[LocalOnnxReranker] Loading model ${this.modelName} (dtype=${this.dtype})...`);
    if (this.isSTS) {
      console.log('[LocalOnnxReranker] (STS model — scores semantic similarity, not keyword relevance)');
    }

    await configureTransformersEnv(this.modelPath);
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers');

    this.tokenizer = await AutoTokenizer.from_pretrained(this.modelName);
    this.model = await AutoModelForSequenceClassification.from_pretrained(
      this.modelName,
      { dtype: this.dtype as any }
    );

    // Warm up with a dummy pair
    await this.scoreOne('warmup', 'warmup');
    console.log('[LocalOnnxReranker] Model loaded and warmed up.');
  }

  async rerank(query: string, candidates: SearchCandidate[], topN: number): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];

    // Score all candidates against the query
    const scores = await this.scoreBatch(query, candidates.map(c => c.text));

    const reranked: RerankResult[] = candidates.map((c, i) => ({
      index: c.index,
      rerankerScore: scores[i],
      embeddingScore: c.score,
      level: c.level,
      startVerseId: c.startVerseId,
      endVerseId: c.endVerseId,
      text: c.text,
      title: c.title,
    }));

    reranked.sort((a, b) => b.rerankerScore - a.rerankerScore);
    return reranked.slice(0, topN);
  }

  async dispose(): Promise<void> {
    this.tokenizer = null;
    this.model = null;
  }

  private normalizeOutput(rawValue: number): number {
    if (this.isSTS) {
      return Math.max(0, Math.min(1, rawValue / 5));
    }
    // MS-MARCO: sigmoid(logit)
    return 1 / (1 + Math.exp(-rawValue));
  }

  private async scoreOne(query: string, document: string): Promise<number> {
    const inputs = this.tokenizer(query, {
      text_pair: document,
      padding: true,
      truncation: true,
      max_length: this.maxLength,
    });
    const output = await this.model(inputs);
    return this.normalizeOutput(output.logits.data[0]);
  }

  private async scoreBatch(query: string, documents: string[]): Promise<number[]> {
    // Score one at a time — cross-encoders process each pair independently, and
    // batching measured strictly worse here. A batch pads every pair to the
    // longest in it, so one chapter-level candidate stretches all of them to
    // ~500 tokens: 50 pairs took 6,940 ms batched against 634 ms sequentially.
    // Length-bucketing the batches still lost (202 ms vs 157 ms over 20 pairs),
    // because onnxruntime already threads within a single forward pass and the
    // median candidate is only 17 tokens. Re-benchmark before batching.
    const scores: number[] = [];
    for (const doc of documents) {
      scores.push(await this.scoreOne(query, doc));
    }
    return scores;
  }
}
