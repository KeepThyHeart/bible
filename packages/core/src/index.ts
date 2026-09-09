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

// Re-export Controllers via the barrel, so the root export surface and the
// TypeDoc entry point (`src/Controllers/index.ts`) cannot drift apart. They did:
// the barrel listed only ModuleController and ModuleCatalogController while this
// file listed all seven, so the published API reference documented two of them.
export * from './Controllers';

// Re-export shared search types (only types unique to types/search.ts; SavedSearch types already exported via Data)
export type { SearchResult, Match, MatchType, FTS5Match, BooleanExpression, ProximityQuery, VerseProximityQuery, PhraseQuery, ParsedQuery, FTS5QueryBuilder } from './types/search';

// Re-export Services
export * from './Services/BibleSearchService';
export * from './Services/FtsQuery';
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
export { SearchTopicEntry, ITopicalRepoProvider, SemanticSearchResponse, SemanticSearchParams, SearchOrchestrationConfig, SearchOrchestrationService } from './Services/SearchOrchestrationService';
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
