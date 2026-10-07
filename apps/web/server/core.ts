// Re-export @bible/core for ESM compatibility
// @bible/core is CJS, and Node.js ESM can't do named imports from CJS.
// This file uses createRequire to bridge the gap.
// Type-only imports work fine (erased at compile time), so we re-export types separately.
import { createRequire } from 'module';
import type {
  BibleBookRepository as BibleBookRepositoryType,
  ModuleMetadataRepository as ModuleMetadataRepositoryType,
  BibleRepository as BibleRepositoryType,
  CommentaryRepository as CommentaryRepositoryType,
  DictionaryRepository as DictionaryRepositoryType,
  BibleSearchRepository as BibleSearchRepositoryType,
  BibleSearchService as BibleSearchServiceType,
  SearchController as SearchControllerType,
  SemanticSearchService as SemanticSearchServiceType,
  VerseIdHelper as VerseIdHelperType,
  VerseOfTheDayService as VerseOfTheDayServiceType,
  CrossReferenceRepository as CrossReferenceRepositoryType,
  TopicalIndexRepository as TopicalIndexRepositoryType,
  TagGraphRepository as TagGraphRepositoryType,
  EnrichmentRepository as EnrichmentRepositoryType,
  WordFamilyService as WordFamilyServiceType,
  WordStudyService as WordStudyServiceType,
  StrongsNumberHelper as StrongsNumberHelperType,
  applyMainFacetPreference as applyMainFacetPreferenceType,
  resolveScoringConfig as resolveScoringConfigType,
  fuse as fuseType,
  consolidate as consolidateType,
  expandTopics as expandTopicsType,
  tagRerank as tagRerankType,
  formatVerseText as formatVerseTextType,
  stripOsisTags as stripOsisTagsType,
  extractMeaningfulTerms as extractMeaningfulTermsType,
  filterTopicEntries as filterTopicEntriesType,
  resolveTopicSources as resolveTopicSourcesType,
  HookRegistry as HookRegistryType,
  PluginLoader as PluginLoaderType,
  BibleViewService as BibleViewServiceType,
  SearchOrchestrationService as SearchOrchestrationServiceType,
  clampSearchQuery as clampSearchQueryType,
  readNewlineHandling as readNewlineHandlingType,
} from '@bible/core';
import type {
  XrefGraphService as XrefGraphServiceType,
  XrefGraphIndexBuilder as XrefGraphIndexBuilderType,
} from '@bible/core';
import type { encodeChapterArcs as encodeChapterArcsType, mergeCatalogs as mergeCatalogsType } from '@bible/core/browser';
import type {
  createFeatureFlags as createFeatureFlagsType,
  parseFlagOverrides as parseFlagOverridesType,
  FeatureFlagName as FeatureFlagNameType,
  FeatureFlags as FeatureFlagsType,
} from '@bible/core/browser';

import type {
  createFeatureModuleHost as createFeatureModuleHostType,
  parseFeatureModuleOverrides as parseFeatureModuleOverridesType,
  createStandardPoints as createStandardPointsType,
  standardPointList as standardPointListType,
  validateBuiltinManifest as validateBuiltinManifestType,
  FeatureModuleManifest as FeatureModuleManifestType,
  FeatureModuleHost as FeatureModuleHostType,
  StandardPoints as StandardPointsType,
} from '@bible/core/browser';

export type FeatureModuleManifest = FeatureModuleManifestType;
export type FeatureModuleHost = FeatureModuleHostType;
export type StandardPoints = StandardPointsType;
export type FeatureFlagName = FeatureFlagNameType;
export type FeatureFlags = FeatureFlagsType;

const require = createRequire(import.meta.url);
const core = require('@bible/core');
const coreBrowser = require('@bible/core/browser');

export const BibleBookRepository: typeof BibleBookRepositoryType = core.BibleBookRepository;
export const ModuleMetadataRepository: typeof ModuleMetadataRepositoryType = core.ModuleMetadataRepository;
export const BibleRepository: typeof BibleRepositoryType = core.BibleRepository;
export const CommentaryRepository: typeof CommentaryRepositoryType = core.CommentaryRepository;
export const DictionaryRepository: typeof DictionaryRepositoryType = core.DictionaryRepository;
export const BibleSearchRepository: typeof BibleSearchRepositoryType = core.BibleSearchRepository;
export const BibleSearchService: typeof BibleSearchServiceType = core.BibleSearchService;
export const SearchController: typeof SearchControllerType = core.SearchController;
export const SemanticSearchService: typeof SemanticSearchServiceType = core.SemanticSearchService;
export const VerseIdHelper: typeof VerseIdHelperType = core.VerseIdHelper;
export const VerseOfTheDayService: typeof VerseOfTheDayServiceType = core.VerseOfTheDayService;
export const CrossReferenceRepository: typeof CrossReferenceRepositoryType = core.CrossReferenceRepository;
export const TopicalIndexRepository: typeof TopicalIndexRepositoryType = core.TopicalIndexRepository;
export const TagGraphRepository: typeof TagGraphRepositoryType = core.TagGraphRepository;
export const EnrichmentRepository: typeof EnrichmentRepositoryType = core.EnrichmentRepository;
export const WordFamilyService: typeof WordFamilyServiceType = core.WordFamilyService;
export const WordStudyService: typeof WordStudyServiceType = core.WordStudyService;
export const StrongsNumberHelper: typeof StrongsNumberHelperType = core.StrongsNumberHelper;
export const applyMainFacetPreference: typeof applyMainFacetPreferenceType = core.applyMainFacetPreference;
export const resolveScoringConfig: typeof resolveScoringConfigType = core.resolveScoringConfig;
export const fuse: typeof fuseType = core.fuse;
export const consolidate: typeof consolidateType = core.consolidate;
export const expandTopics: typeof expandTopicsType = core.expandTopics;
export const tagRerank: typeof tagRerankType = core.tagRerank;
export const formatVerseText: typeof formatVerseTextType = core.formatVerseText;
export const stripOsisTags: typeof stripOsisTagsType = core.stripOsisTags;
export const extractMeaningfulTerms: typeof extractMeaningfulTermsType = core.extractMeaningfulTerms;
export const filterTopicEntries: typeof filterTopicEntriesType = core.filterTopicEntries;
export const resolveTopicSources: typeof resolveTopicSourcesType = core.resolveTopicSources;
export const HookRegistry: typeof HookRegistryType = core.HookRegistry;
export const PluginLoader: typeof PluginLoaderType = core.PluginLoader;
export const BibleViewService: typeof BibleViewServiceType = core.BibleViewService;
export const SearchOrchestrationService: typeof SearchOrchestrationServiceType = core.SearchOrchestrationService;
export const clampSearchQuery: typeof clampSearchQueryType = core.clampSearchQuery;
export const MAX_SEARCH_QUERY_CHARS: number = core.MAX_SEARCH_QUERY_CHARS;
export const readNewlineHandling: typeof readNewlineHandlingType = core.readNewlineHandling;

// Cross-reference graph (task 0068). The service and index builder are Node-side; the byte encoder is in the pure browser barrel.
export const XrefGraphService: typeof XrefGraphServiceType = core.XrefGraphService;
export const XrefGraphIndexBuilder: typeof XrefGraphIndexBuilderType = core.XrefGraphIndexBuilder;
export const encodeChapterArcs: typeof encodeChapterArcsType = coreBrowser.encodeChapterArcs;
export const mergeCatalogs: typeof mergeCatalogsType = coreBrowser.mergeCatalogs;

// Feature flags (task 0087) come from the platform-free browser barrel: it is pure logic
// shared with both apps, and requiring it avoids loading the Data layer for config code.
export const createFeatureFlags: typeof createFeatureFlagsType = coreBrowser.createFeatureFlags;
export const parseFlagOverrides: typeof parseFlagOverridesType = coreBrowser.parseFlagOverrides;
export const FEATURE_FLAG_NAMES: readonly FeatureFlagNameType[] = coreBrowser.FEATURE_FLAG_NAMES;

// Feature modules (task 0113): pure logic from the browser barrel, like the flags above.
export const createFeatureModuleHost: typeof createFeatureModuleHostType = coreBrowser.createFeatureModuleHost;
export const parseFeatureModuleOverrides: typeof parseFeatureModuleOverridesType = coreBrowser.parseFeatureModuleOverrides;
export const createStandardPoints: typeof createStandardPointsType = coreBrowser.createStandardPoints;
export const standardPointList: typeof standardPointListType = coreBrowser.standardPointList;
export const validateBuiltinManifest: typeof validateBuiltinManifestType = coreBrowser.validateBuiltinManifest;
