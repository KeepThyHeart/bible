/**
 * Search Pipeline - Interfaces, types, and configuration.
 *
 * Platform-agnostic definitions for the configurable search pipeline.
 * Implementations live in their respective platform packages (web, desktop).
 */

// Interfaces
export type { IEmbedder } from './IEmbedder';
export type { IVectorSearch } from './IVectorSearch';
export type { IReranker } from './IReranker';
export type { ISearchPipeline } from './ISearchPipeline';

// Types
export type {
  SearchCandidate,
  RerankResult,
  VectorSearchOptions,
  PipelineSearchOptions,
  PipelineTimings,
  PipelineSearchResult,
} from './SearchTypes';

// Config
export type {
  ApiEmbedderConfig,
  LocalOnnxEmbedderConfig,
  BrowserOnnxEmbedderConfig,
  EmbedderConfig,
  SqliteVectorSearchConfig,
  NativeCliVectorSearchConfig,
  BrowserVectorSearchConfig,
  UsearchVectorSearchConfig,
  VectorSearchConfig,
  ApiRerankerConfig,
  LocalOnnxRerankerConfig,
  NoOpRerankerConfig,
  RerankerConfig,
  TopicSourcesConfig,
  ScoringConfig,
  SearchPipelineConfig,
} from './SearchPipelineConfig';

// Scoring utilities (shared pure functions)
export {
  DEFAULT_SUB_FACET_DAMPING,
  DEFAULT_TOPIC_DAMPING,
  DEFAULT_TOPIC_BOOST,
  DEFAULT_TOPIC_MIN_SCORE,
  DEFAULT_TOPIC_SOURCES,
  resolveTopicSources,
  resolveScoringConfig,
  filterTopicEntries,
  applyMainFacetPreference,
  applyMainFacetPreferencePlain,
} from './ScoringUtils';
export type { TopicEntryLike } from './ScoringUtils';

// Score fusion
export {
  minMaxNormalize,
  linearBlend,
  reciprocalRankFusion,
  fuse,
} from './ScoreFusion';
export type { FusableResult, FuseOptions } from './ScoreFusion';

// Consolidation
export { consolidate, rangesOverlap } from './Consolidation';
export type { ConsolidatableResult, ConsolidatedFields } from './Consolidation';

// Topic expansion
export { expandTopics, DEFAULT_INTERSECT_BONUS } from './TopicExpansion';
export type {
  TopicMatch,
  TopicVerseData,
  TopicExpansionInput,
  TopicExpansionOptions,
  ExpandableResult,
} from './TopicExpansion';

// Tag reranking
export { tagRerank, DEFAULT_TAG_RERANK_BOOST } from './TagReranking';
export type { TagRerankableResult, TagRerankOptions } from './TagReranking';

// Stop words & query filtering
export { ENGLISH_STOP_WORDS, extractMeaningfulTerms } from './StopWords';

// Query length limits (shared by every embedding path)
export { MAX_SEARCH_QUERY_CHARS, clampSearchQuery } from './SearchQueryLimits';
