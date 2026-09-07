/**
 * Main entry point for the Bible Desktop App Data Layer
 *
 * This module provides a clean, type-safe data access layer for the multi-database
 * Bible study application architecture.
 *
 * **Database provider note:**
 * This package exports the {@link ISql} abstraction interface that all repositories
 * depend on. It does NOT include a concrete SQLite provider - consumers must supply
 * their own implementation of {@link ISql}.
 *
 * - **Desktop (Electron):** A `better-sqlite3` implementation lives in
 *   `@bible/desktop` (`apps/desktop/electron/providers/SqliteProvider.ts`).
 * - **Web server:** The `@bible/web` package has its own `SqliteProvider` using the
 *   `better-sqlite3-web` alias (`apps/web/server/providers/SqliteProvider.ts`).
 * - **Browser / custom environments:** Implement the {@link ISql} interface
 *   (defined in `./Core/ISql.ts`) using any compatible driver. For browser use,
 *   consider `sql.js` (an Emscripten port of SQLite that runs in WebAssembly).
 *
 * @see {@link ISql} for the interface contract that providers must implement.
 *
 * @example
 * ```typescript
 * // Import the ISql interface and repositories from @bible/core
 * import { ISql, BibleBookRepository, UserNoteRepository } from '@bible/core';
 *
 * // Provide your own ISql implementation (platform-specific)
 * const mainDb: ISql = createYourSqliteProvider('data/main.db');
 * const bookRepo = new BibleBookRepository(mainDb);
 *
 * // Get a book
 * const john = bookRepo.getByName('John');
 * console.log(john?.getDisplayName());
 *
 * // Open user database
 * const userDb: ISql = createYourSqliteProvider('data/users/user_john.db');
 * const noteRepo = new UserNoteRepository(userDb);
 *
 * // Get notes for a verse
 * const notes = noteRepo.getForVerse(43003016); // John 3:16
 * ```
 */

// Core interfaces and types
export * from './Core/ISql';
export * from './Core/IRepository';
export * from './Core/Types';
export * from './Core/CatalogTypes';
export * from './Core/FeaturePackTypes';
export * from './Core/StarterPackTypes';
export * from './Core/ModuleVersion';
export * from './Core/StrongsNumberHelper';
export * from './Core/JsonHelpers';
export * from './Core/RowTypes';
export * from './Core/VerseRangeQuery';
export * from './Core/Errors';
export * from './Core/SafeQuery';
export * from './Core/Colors';

// Text representation: the `bible_verse.formatting`
// span model plus the HTML->spans normalizer.
export * from './Text';

// Providers - no concrete provider is shipped in @bible/core.
// Each platform package supplies its own ISql implementation:
//   - @bible/desktop: apps/desktop/electron/providers/SqliteProvider.ts (better-sqlite3)
//   - @bible/web:     apps/web/server/providers/SqliteProvider.ts (better-sqlite3-web)
// For custom integrations, implement the ISql interface from ./Core/ISql.ts.

// Main database models
export * from './Models/Main/BibleBook';
export * from './Models/Main/BibleVerseRef';
export * from './Models/Main/ChapterInfo';
export * from './Models/Main/ModuleMetadata';
export * from './Models/Main/ModuleCatalog';
export * from './Models/Main/DownloadQueue';
export * from './Models/Main/ModuleUpdate';
export { SavedSearch } from './Models/Main/SavedSearch';
export type { SearchOptions, SearchScope, BibleRange, SearchScopeData, SearchType as SavedSearchType } from './Models/Main/SavedSearch';

// User database models
export * from './Models/User/UserNote';
export * from './Models/User/UserHighlight';
export * from './Models/User/UserTextMarkup';
export * from './Models/User/UserCommentary';
export * from './Models/User/UserCrossReference';
export * from './Models/User/UserDataItem';
export * from './Models/User/Collection';
export * from './Models/User/ReadingPlan';
export * from './Models/User/Session';
export * from './Models/User/ContentVerseLink';

// Shared module models
// The unified verse_link record - used by every module
// database and the user database.
export * from './Models/Common/VerseLinkRecord';

// Bible module models
export * from './Models/Bible/BibleVerse';
export * from './Models/Bible/BibleModuleInfo';

// Commentary module models
export * from './Models/Commentary/CommentaryEntry';
export * from './Models/Commentary/CommentaryModuleInfo';
// Dictionary module models
export * from './Models/Dictionary/DictionaryEntry';
export * from './Models/Dictionary/DictionaryModuleInfo';

// Book module models
export * from './Models/Book/BookModuleInfo';
export * from './Models/Book/BookSection';
export * from './Models/Book/ScriptureReference';

// Devotional module models
export * from './Models/Devotional/DevotionalModuleInfo';

// Topical index module models
export * from './Models/TopicalIndex/Topic';
export * from './Models/TopicalIndex/TopicVerse';
export * from './Models/TopicalIndex/TopicalIndexModuleInfo';

// Cross-reference module models
export * from './Models/CrossReference/CrossReferenceGroup';
export * from './Models/CrossReference/CrossReferenceEntry';
export * from './Models/CrossReference/CrossReferenceModuleInfo';

// Tag graph models
export * from './Models/TagGraph/TagGraphEntity';
export * from './Models/TagGraph/TagAssociation';
export * from './Models/TagGraph/EntityTopicLink';
export * from './Models/TagGraph/EntityFacet';
export * from './Models/TagGraph/EntityVerse';

// Base classes
export * from './Repositories/BaseModuleRepository';

// Repository interfaces (use these for dependency injection)
export * from './Repositories/IBibleBookRepository';
export * from './Repositories/IModuleMetadataRepository';
export * from './Repositories/IModuleCatalogRepository';
export * from './Repositories/IDownloadQueueRepository';
export * from './Repositories/IModuleUpdateRepository';
export * from './Repositories/IUserNoteRepository';
export * from './Repositories/IUserTextMarkupRepository';
export * from './Repositories/IUserCommentaryRepository';
export * from './Repositories/IUserCrossReferenceRepository';
export * from './Repositories/IUserDataRepository';
export * from './Repositories/ICollectionRepository';
export * from './Repositories/ISessionRepository';
export * from './Repositories/IBibleRepository';
export * from './Repositories/ICommentaryRepository';
export * from './Repositories/IDictionaryRepository';
export * from './Repositories/IBookRepository';
export * from './Repositories/ITopicalIndexRepository';
export * from './Repositories/ICrossReferenceRepository';
export * from './Repositories/ITagGraphRepository';
export * from './Repositories/IEnrichmentRepository';
export * from './Repositories/IVerseLinkRepository';

// Repository implementations
export * from './Repositories/BibleBookRepository';
export * from './Repositories/ModuleMetadataRepository';
export * from './Repositories/ModuleCatalogRepository';
export * from './Repositories/DownloadQueueRepository';
export * from './Repositories/ModuleUpdateRepository';
export * from './Repositories/UserNoteRepository';
export * from './Repositories/UserTextMarkupRepository';
export * from './Repositories/UserCommentaryRepository';
export * from './Repositories/UserCrossReferenceRepository';
export * from './Repositories/UserDataRepository';
export * from './Repositories/CollectionRepository';
export * from './Repositories/SessionRepository';
export * from './Repositories/BibleRepository';
export * from './Repositories/CommentaryRepository';
export * from './Repositories/DictionaryRepository';
export * from './Repositories/BookRepository';
export * from './Repositories/TopicalIndexRepository';
export * from './Repositories/CrossReferenceRepository';
export * from './Repositories/TagGraphRepository';
export * from './Repositories/EnrichmentRepository';
export * from './Repositories/BibleSearchRepository';
export * from './Repositories/VerseLinkRepository';

// Text normalization + formatting types
export * from './Text';

// Schema migration runner
export * from './Migration';
