/**
 * Configuration types for the search pipeline.
 *
 * Uses discriminated unions so the factory can instantiate
 * the correct implementation based on the `provider` field.
 */

// -- Embedder configs ----------------------------------------------------

export interface ApiEmbedderConfig {
  provider: 'api';
  /** OpenAI-compatible embedding endpoint URL */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Model name to pass in the request */
  model: string;
  /** Embedding dimensions (for Matryoshka truncation). Default: 768 */
  dimensions?: number;
  /** Prefix prepended to query text. Default: 'search_query: ' */
  queryPrefix?: string;
}

export interface LocalOnnxEmbedderConfig {
  provider: 'local-onnx';
  /** HuggingFace model name. Default: 'nomic-ai/nomic-embed-text-v1.5' */
  modelName?: string;
  /** Embedding dimensions (for Matryoshka truncation). Default: 768 */
  dimensions?: number;
  /** Prefix prepended to query text. Default: 'search_query: ' */
  queryPrefix?: string;
  /** Path to mean vector JSON file for centering (anisotropy correction). If set, centering is applied after truncation. */
  meanVectorPath?: string;
  /**
   * ONNX model quantization dtype. Default: 'q8'.
   *
   * Measured for nomic-embed-text-v1.5: 'q8' is ~317 MB resident and ~13 ms per
   * embed; 'fp32' is ~1,053 MB and ~28 ms. q8 is the default because the index
   * it is searched against is itself int8-quantized, so fp32 query precision
   * buys very little. Set 'fp32' to trade memory for maximum fidelity.
   *
   * The chosen dtype must exist in the model directory - a self-hosted model
   * with `allowRemoteModels: false` will fail to load if the matching ONNX file
   * was never downloaded.
   */
  dtype?: string;
  /**
   * Directory holding self-hosted model files, laid out as `<org>/<model>/...`.
   * Resolved relative to the process working directory. When set, models are
   * loaded from here and remote downloads are disabled, so a deploy never
   * depends on reaching huggingface.co at startup.
   */
  modelPath?: string;
}

export interface BrowserOnnxEmbedderConfig {
  provider: 'browser-onnx';
  /** Model name */
  modelName?: string;
  /** Embedding dimensions */
  dimensions?: number;
  /** ONNX model quantization dtype. Default: 'fp32' */
  dtype?: string;
}

export type EmbedderConfig = ApiEmbedderConfig | LocalOnnxEmbedderConfig | BrowserOnnxEmbedderConfig;

// -- Vector search configs -----------------------------------------------

export interface SqliteVectorSearchConfig {
  provider: 'sqlite';
  /** Path to the semantic embeddings SQLite database */
  dbPath: string;
}

export interface NativeCliVectorSearchConfig {
  provider: 'native-cli';
  /** Path to the vec-search binary */
  binaryPath: string;
  /** Path to the flat binary embeddings file */
  embeddingsPath: string;
  /** Path to the semantic SQLite database (for metadata lookup) */
  dbPath: string;
}

export interface BrowserVectorSearchConfig {
  provider: 'browser';
  /** URL or path to the flat binary embeddings file (int8 vectors) */
  embeddingsUrl: string;
  /** URL or path to the JSON metadata file (row metadata + mean vector) */
  metadataUrl: string;
}

export interface UsearchVectorSearchConfig {
  provider: 'usearch';
  /** Path to the pre-built .usearch HNSW index file */
  indexPath: string;
  /** Path to the semantic SQLite database (for metadata lookup) */
  dbPath: string;
}

export type VectorSearchConfig = SqliteVectorSearchConfig | NativeCliVectorSearchConfig | BrowserVectorSearchConfig | UsearchVectorSearchConfig;

// -- Reranker configs ----------------------------------------------------

export interface ApiRerankerConfig {
  provider: 'api';
  /** Reranker API endpoint URL */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Model name. Default: 'jina-reranker-v2-base-multilingual' */
  model?: string;
}

export interface LocalOnnxRerankerConfig {
  provider: 'local-onnx';
  /** HuggingFace model name. Default: 'cross-encoder/ms-marco-MiniLM-L-6-v2' */
  modelName?: string;
  /**
   * ONNX model quantization dtype. Default: 'fp32'.
   *
   * Left at fp32 unlike the embedder: cross-encoder scores feed directly into
   * result ordering, and the MiniLM rerankers are small enough (~90-120 MB at
   * fp32) that quantizing saves little. Benchmark before changing.
   */
  dtype?: string;
  /**
   * Token cap per (query, document) pair. Default: 128.
   *
   * Cross-encoder cost is quadratic in sequence length, and the indexed chunks
   * are short - p50 is 17 tokens and p90 is 96 - while a single chapter-level
   * chunk can reach the model's 512-token limit and drag the whole pass with
   * it. Capping at 128 leaves ~90% of candidates untouched and measured
   * 634 ms -> 434 ms over 50 pairs. Raise it to 256 if chapter-level chunks
   * need to be scored on more than their opening.
   */
  maxLength?: number;
  /** Self-hosted model directory. See LocalOnnxEmbedderConfig.modelPath. */
  modelPath?: string;
}

export interface NoOpRerankerConfig {
  provider: 'none';
}

export type RerankerConfig = ApiRerankerConfig | LocalOnnxRerankerConfig | NoOpRerankerConfig;

// -- Topic sources config ----------------------------------------------

/**
 * Controls which topic sources are included in semantic search expansion.
 * All sources are enabled by default.
 */
export interface TopicSourcesConfig {
  /** Include Nave's topical index entries (tagType 'nave_torrey' with naveTopicId). Default: true */
  naves?: boolean;
  /** Include Torrey's topical index entries (tagType 'nave_torrey' with torreyTopicId). Default: true */
  torreys?: boolean;
  /** Include custom enrichment tags (theme, emotion, event, imagery). Default: true */
  customTags?: boolean;
}

// -- Scoring config -----------------------------------------------------

export interface ScoringConfig {
  /**
   * How to score verses with multiple facets (main descriptions vs terse sub-facets).
   * - "max" (default): Use the highest score across all facets.
   * - "main-prefer": Dampen sub-facet scores so that detailed main facets win
   *   when the sub-facet advantage is marginal. Prevents terse phrases like
   *   "not being afraid of disaster" from outranking "people terrified by thunderstorm".
   */
  facetScoring?: 'max' | 'main-prefer';

  /**
   * Sub-facet score multiplier when facetScoring is "main-prefer".
   * Sub-facet scores are multiplied by this value before comparing to main facet scores.
   * Lower = more aggressive demotion. Default: 0.92
   */
  subFacetDamping?: number;

  /**
   * Topic-expanded verse score multiplier when facetScoring is "main-prefer".
   * Topic entries are terse labels with the same over-matching risk as sub-facets.
   * Default: 0.85
   */
  topicDamping?: number;

  /**
   * Score boost per unit of tag strength for topic-expanded verses.
   * Formula: verseScore = topicScore x topicDamping + topicBoost x tagStrength.
   * Default: 0.15
   */
  topicBoost?: number;

  /**
   * Minimum topic embedding similarity score required before expanding a topic
   * into its verse list. Topics below this threshold are ignored entirely.
   * Good matches (exact concepts) typically score 0.50+; false positives
   * (loosely related concepts like "earthquakes" for "storms") score below 0.50.
   * Default: 0.50
   */
  topicMinScore?: number;

  /**
   * Controls which topic sources are included in semantic search expansion.
   * When omitted, all sources are enabled by default.
   */
  topicSources?: TopicSourcesConfig;
}

// -- Full pipeline config ------------------------------------------------

export interface SearchPipelineConfig {
  embedder: EmbedderConfig;
  vectorSearch: VectorSearchConfig;
  reranker: RerankerConfig;
  /** Scoring adjustments for facet and topic result ranking */
  scoring?: ScoringConfig;
}
