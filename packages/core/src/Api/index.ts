/**
 * First-party API contract for the Bible application.
 *
 * These seven files declare, in one place, every operation a *first-party*
 * client needs - every read and write an Electron IPC layer, an Express REST
 * layer, or a CLI would expose - as plain TypeScript interfaces.
 *
 * The contract is written for a transport boundary rather than for in-process
 * calls: every method returns a `Promise`, including ones the underlying
 * repositories answer synchronously, and the batch conveniences
 * (`getInitialData`, `getVerseTexts`) exist to spare a client a round-trip per
 * verse.
 *
 * There is no implementation here, and nothing to trace: these files contain
 * only `export interface`. They compile to nothing and impose no runtime cost.
 * Their job is to be the one written-down answer to "what can a client ask
 * for, and in what shape does the answer come back", so that a client adapter
 * declares `implements IBibleApi` and lets the compiler hold it to that answer.
 *
 * ## Not to be confused with `src/Extensions/`
 *
 * `src/Extensions/` is a *different* contract for a *different* audience
 * (third-party extension authors), and it reuses several of these interface
 * names. `src/index.ts` exports it behind a `Extensions.*` namespace alias
 * precisely to avoid the name collision.
 *
 * ## Importing
 *
 * `src/index.ts` re-exports the six interfaces as types. `ApiTypes.ts` is
 * deliberately *not* star-exported from the root, because its `SearchOptions`
 * and `SearchResult` collide with the different types of the same names in
 * `src/types/search.ts`. Import those by path:
 *
 * ```typescript
 * import type { IBibleApi } from '@bible/core';
 * import type { FormattedVerse, ChapterResult } from '@bible/core/Api/ApiTypes';
 * ```
 *
 * @see {@link ../../docs/features/api-contracts.md}
 */

export * from './ApiTypes';
export * from './IBibleApi';
export * from './ICommentaryApi';
export * from './IDictionaryApi';
export * from './IUserDataApi';
export * from './ISessionApi';
export * from './ISearchApi';
