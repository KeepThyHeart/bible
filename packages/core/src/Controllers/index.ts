/**
 * Controllers - Application State Management Layer
 *
 * Controllers manage application state and coordinate between
 * services and the UI layer. They depend on repository interfaces
 * and services via dependency injection.
 *
 * This barrel is a TypeDoc entry point (`apps/website/docusaurus.config.ts`),
 * so anything missing here is missing from the published API reference. Keep it
 * in step with the files in this directory - `src/index.ts` re-exports this
 * barrel rather than listing the controllers a second time.
 */

// Search and notes
export * from './SearchController';
export * from './NotesController';

// Module Manager Controllers
export * from './ModuleController';
export * from './ModuleCatalogController';

// Bible pane state
export * from './VerseNavigationController';
export * from './BibleTabController';
export * from './CommentaryCoordinationController';
