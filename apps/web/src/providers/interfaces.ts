/**
 * These provider interfaces moved into `packages/core` (task 0034, finishing
 * 0029's S3a: promote the data-provider interfaces into `packages/core` as
 * the app-wide content-source seam - see `@bible/core`'s `Providers/interfaces.ts`,
 * whose doc comment explains why these, not the module repositories, are
 * where a remote/licensed content source plugs in). This file stays as a
 * re-export so the many components/stores/hooks and both implementations
 * (`ServerDataProvider.ts`, `../offline/OfflineBibleProvider.ts`) that
 * import from here keep working unchanged; new code should prefer importing
 * directly from `@bible/core/browser`'s `Providers` namespace.
 */
import type { Providers } from '@bible/core/browser';

export type VotdData = Providers.VotdData;
export type BatchVerseTexts = Providers.BatchVerseTexts;
export type IBibleDataProvider = Providers.IBibleDataProvider;
export type CommentaryAvailability = Providers.CommentaryAvailability;
export type ICommentaryDataProvider = Providers.ICommentaryDataProvider;
export type ISearchProvider = Providers.ISearchProvider;
export type IInterlinearDataProvider = Providers.IInterlinearDataProvider;
export type SemanticIndexInfo = Providers.SemanticIndexInfo;
export type IModuleProvider = Providers.IModuleProvider;
export type IStrongsProvider = Providers.IStrongsProvider;
export type ICrossRefDataProvider = Providers.ICrossRefDataProvider;
export type ITopicalDataProvider = Providers.ITopicalDataProvider;
export type ITagGraphDataProvider = Providers.ITagGraphDataProvider;
export type IStudyOverviewProvider = Providers.IStudyOverviewProvider;
export type IDataProviders = Providers.IDataProviders;
