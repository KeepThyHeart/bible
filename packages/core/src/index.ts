/**
 * Main entry point for @bible/core package
 *
 * This package provides the core business logic and data access layer
 * for Bible study applications.
 */

// Re-export everything from Data layer
export * from './Data';

// Schema file reader (expands the `-- @include` directives the schemas use).
export * from './Data/Schema';

// Canonical English book-name tables - the single source of truth for the repo.
// `getBookName` and `BookNameFormat` reach consumers through ReferenceCollapser
// (which re-exports them), so only the remaining symbols are listed here; a
// star export would collide with that re-export.
export {
  BOOK_COUNT,
  LONG_NAMES,
  MEDIUM_NAMES,
  SHORT_NAMES,
  getBookNumber,
  isSingleChapterBook,
} from './Data/Core/BookNames';

// Locale identity metadata and the per-language `Localizer` interface. Also
// re-exported from `./browser` (this package's platform-free entry point) -
// both modules are pure `Intl` + data, so they belong in both barrels.
export {
  LOCALE_REGISTRY,
  resolveLocaleDescriptor,
  directionForTag,
} from './Data/Locales/LocaleRegistry';
export type { LocaleDescriptor, LocaleDirection, DigitSystem } from './Data/Locales/LocaleRegistry';
export {
  EnglishLocalizer,
  createIntlLocalizer,
  getLocalizer,
  registerLocalizer,
} from './Data/Locales/Localizer';
export type { Localizer, DigitFormatOptions } from './Data/Locales/Localizer';
export { parseLocaleMeta } from './Data/Locales/LocaleMetadata';
export type { LocaleMetadata, LocaleStatus } from './Data/Locales/LocaleMetadata';
// Side-effect import: registers every built-in Localizer beyond `en` (see the
// module doc). Importing `@bible/core` or `@bible/core/browser` is then
// enough for `getLocalizer('es')` / `getLocalizer('zh-Hans')` to return the
// full Localizer - no other call site has to know these exist.
export { SpanishLocalizer, ChineseSimplifiedLocalizer } from './Data/Locales/registerBuiltinLocalizers';
// Multilingual reference engine (task 0077): parse, scan, suggest and format
// references in any language with locale data; languages load on demand.
export * from './Reference';

// Re-export Controllers via the barrel, so the root export surface and the
// TypeDoc entry point (`src/Controllers/index.ts`) cannot drift apart. They did:
// the barrel listed only ModuleController and ModuleCatalogController while this
// file listed all seven, so the published API reference documented two of them.
export * from './Controllers';

// Re-export shared search types (only types unique to types/search.ts; SavedSearch types already exported via Data)
export type { SearchResult, Match, MatchType, FTS5Match, BooleanExpression, ProximityQuery, VerseProximityQuery, PhraseQuery, ParsedQuery, FTS5QueryBuilder } from './types/search';

// Re-export Services
export * from './Services/BibleSearchService';
// escapeFts5Term/escapeFts5Query/compileKeywordQuery moved to
// Data/Access/Fts5/Fts5QueryCompiler (task 0026 subtask M2); already
// re-exported via `export * from './Data'` above.
export * from './Services/BibleSections';
export * from './Services/CollectionService';
export * from './Services/ReferenceParser';
export * from './Services/IDownloadService';
export * from './Services/IInstallationService';
export * from './Services/IModuleCatalogService';
export * from './Services/VerseReferenceIndexingService';
// Which discovered module files may be registered (see the TSK double-registration note)
export * from './Services/ModuleRegistrationPolicy';
export * from './Services/VerseLinksService';
export * from './Services/SemanticSearchService';
export * from './Services/CommentaryLinkProcessor';
// Render-time formatting for dictionary definitions (newline handling, escaping)
export * from './Services/DictionaryDefinitionFormatter';
// Word-boundary truncation for summary renderings (Strong's glosses, previews)
export * from './Services/TextTruncation';
export * from './Services/VerseOfTheDayService';
export * from './Services/WordFamilyService';
export * from './Services/VerseFormatter';
export * from './Services/ModuleLoader';
export * from './Services/BibleViewService';
// Types via `export type`: Vite's dev server transpiles one file at a time and
// cannot tell an interface from a value, so a plain re-export of one becomes a
// runtime import that does not exist - which stops the desktop renderer loading.
export type { SearchTopicEntry, ITopicalRepoProvider, SemanticSearchResponse, SemanticSearchParams, SearchOrchestrationConfig } from './Services/SearchOrchestrationService';
export { SearchOrchestrationService } from './Services/SearchOrchestrationService';
export type { SemanticSearchResult as OrchestrationSearchResult } from './Services/SearchOrchestrationService';

export * from './Services/SessionSerializationService';
export * from './Services/ReferenceCollapser';

// Copy template engine (used by desktop CopyOptionsDialog custom template format)
export * from './Services/CopyService';

// Passage formatting: the shared engine behind "Copy Passage" and
// "+ Bible Passage" in every app. Also exported from `./browser`, which is the
// entry point a browser bundle should use.
export * from './Services/PassageFormat';

// Search Pipeline (configurable semantic search)
export * from './Services/Search';

// StudyOverview - cross-module aggregation services
export * from './Services/StudyOverview';

// Cross-reference graph service and index builder (task 0068); the pure half is in ./Services/XrefGraph.
export { XrefGraphService, USER_SOURCE, UNKNOWN_RANK } from './Services/XrefGraph/XrefGraphService';
export * from './Services/XrefGraph/types';
export { XrefGraphIndexBuilder } from './Services/XrefGraph/XrefGraphIndexBuilder';

// Plugin system (hook registry, loader, types)
export * from './Plugin';

// Extensions namespace (the third-party extension API contract).
// Exported under a namespace alias to avoid colliding with @bible/core/Api/*.
// Consumers: `import { Extensions } from '@bible/core'` then
// `Extensions.BibleExtensionAPI`, `Extensions.BibleVerseDto`, etc.
export * as Extensions from './Extensions';
// Convenience: the version constant is also re-exported at the root so
// host/worker code can read it without the namespace prefix.
export { EXTENSION_API_VERSION } from './Extensions/ExtensionApiTypes';

// API contract interfaces (import types from '@bible/core/Api/ApiTypes' to avoid collisions)
export type { IBibleApi } from './Api/IBibleApi';
export type { ICommentaryApi } from './Api/ICommentaryApi';
export type { IDictionaryApi } from './Api/IDictionaryApi';
export type { IUserDataApi } from './Api/IUserDataApi';
export type { ISessionApi } from './Api/ISessionApi';
export type { ISearchApi } from './Api/ISearchApi';

// USFM export surface. Exposed under a namespace because its
// formatting types intentionally mirror those in Data/Text and would otherwise
// collide with the `export * from './Data'` star above.
// Usage: `import { Usfm } from '@bible/core'` then `Usfm.toUSFM(rows)`.
export * as Usfm from './Export';
// The entry points are also available unqualified, since their names are unique.
export { toUSFM, toUSFMBook, UsfmExportError } from './Export/toUSFM';
export { parseUSFM, UsfmParseError } from './Export/parseUSFM';

// Data-provider seam (task 0034, finishing 0029's S3a): DTO types plus the
// ten Promise-returning provider interfaces (`IBibleDataProvider` and nine
// siblings) - the app-wide content-source seam a remote/licensed Bible
// version implements, instead of a module repository. Also re-exported from
// `./browser`, since it is pure data/interfaces with no platform dependency.
// Namespaced (like `Extensions`/`Usfm` above): two DTO names collide with
// pre-existing root exports - see `browser.ts`'s copy of this comment.
export * as Providers from './Providers';

// Crypto primitives (task 0078): also re-exported from `./browser`.
export * as Crypto from './Crypto';

// Backup format v1 (task 0078): also re-exported from `./browser`.
export * as Backup from './Backup';

// Shared text tools (task 0089): also re-exported from `./browser`.
export {
  canonicalLanguage, tokenizeVerseWords, foldWord, foldLemma, trimEdgePunctuation,
  normalizeArchaic, ARCHAIC_EN,
  porterStem, getStemmer, hasStemmer, registerStemmer,
  getStopWords, registerStopWords, isStopWord,
  findSequences, findPhraseMatches, compileTermMatcher, countForms, parseTermQuery,
} from './Text';
export type { TextWord, Stemmer, TermMatcher, TermMatcherOptions, TermMatch } from './Text';

// Keyword marks (task 0065): also re-exported from `./browser`.
export * from './KeywordMarks';
export { UserDataKeywordSetStore, KEYWORD_OWNER, KEYWORD_COLLECTION } from './KeywordMarks/UserDataKeywordSetStore';
export { UserDataQuizProgressStore, QUIZ_OWNER, QUIZ_STATS_COLLECTION, QUIZ_SESSIONS_COLLECTION } from './Quiz/progress';
export { mergeCatalogs } from './Quiz/scope';

// Web user-data store (task 0084): also re-exported from `./browser`.
export * as UserData from './UserData';

// Audio Bible contracts, manifest validators and site-config parser (task 0059).
// Namespaced because `VerseRef` collides with the root export of
// `Services/VerseOfTheDayService`. Also re-exported flat from `./browser`.
export * as AudioBible from './audio';

// Speech recognition contracts and fakes, and the recitation library (task 0071).
// Namespaced; also re-exported from `./browser`. `@bible/core/recite` is the
// QuickJS-safe subpath the Scripture Memory extension bundles.
export * as Speech from './speech';
export * as Recite from './recite';

// Reading plans (task 0073). Namespaced like in `./browser`.
export * as ReadingPlans from './ReadingPlans';

// Notifications and reminders engine (task 0083). Namespaced here (the Node
// entry already exports generic names such as `JsonValue`); flat in `./browser`.
export * as Reminders from './Reminders';

// Similar passages (task 0070): browser-safe barrel plus the Node-only vector source.
export * from './Services/Similar';
export { createSemanticVectorSource } from './Services/Similar/semanticVectorSource';
