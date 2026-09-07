/**
 * Services - Business Logic Layer
 *
 * Services provide domain-specific business logic and operations.
 * They are stateless and use repository interfaces for data access.
 */

// Template Engine interface (implementations in @bible/desktop)
export { ITemplateEngine } from './ITemplateEngine';

// Template types and enums
export { TemplateEngineType, TemplateView, createTemplateView } from './TemplateTypes';

// Bible Text Service
export * from './BibleTextService';

// Verse Formatter (shared HTML formatting for display)
export * from './VerseFormatter';

// Verse Navigation Service
export * from './VerseNavigationService';

// Search Service and Query Parser
export * from './ISearchService';
export * from './BibleSearchService';
export * from './SearchQueryParser';

// Reference Parser (includes IReferenceParser interface and English constants)
export * from './ReferenceParser';

// Collection Service
export * from './CollectionService';

// Cross Reference Service
export * from './CrossReferenceService';

// Reference Collapser (TSK-style compact reference formatting)
export * from './ReferenceCollapser';

// Interlinear Service
export * from './InterlinearService';

// Verse of the Day
export * from './VerseOfTheDayService';

// Module Manager Service Interfaces (implementations moved to @bible/desktop)
export * from './IDownloadService';
export * from './IInstallationService';
export * from './IModuleCatalogService';

// Copy Service (template engine for copy-to-clipboard formatting)
export * from './CopyService';

// Bible View Service (chapter formatting, topic dedup, VOTD)
export * from './BibleViewService';

// Search Orchestration Service (semantic search pipeline orchestration)
export * from './SearchOrchestrationService';

// Search Pipeline (interfaces, types, config)
export * from './Search';

// Study Overview - cross-module aggregation services (commentary, topics,
// cross-refs, entities) used by study cache generation and desktop IPC.
export * from './StudyOverview';

// Passage Format - the shared copy/insert format engine (catalog, block-tree
// renderer, clipboard formats). Also re-exported from `../browser.ts`, which is
// how a browser bundle should reach it.
export * from './PassageFormat';
