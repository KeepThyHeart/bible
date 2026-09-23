/**
 * The data-provider interfaces: the app-wide content-source seam (task 0034,
 * finishing 0029's S3a). Promoted from `apps/web/src/providers/interfaces.ts`
 * into `packages/core`, unchanged in shape.
 *
 * ## Why these, and not the module repositories, are the seam a remote
 * content source plugs into
 *
 * Task 0029's design doc (`archive/bible/0029-async-repositories`) surveyed
 * whether the SQL-shaped module repositories (`IBibleRepository` and its
 * seven siblings, `Data/Repositories/`) should become asynchronous so a
 * future remote/licensed Bible version could implement one. Its finding: a
 * remote API can serve perhaps four of `IBibleRepository`'s thirty methods
 * and `getSql(): ISql` never at all, so widening that interface would not
 * make a remote implementation possible - only one that reports itself
 * unavailable on most of its surface. These ten interfaces are the
 * abstraction that already fits: DTO-shaped, Promise-returning, one HTTP
 * implementation already shipping (`ServerDataProvider`, `apps/web/src`) and
 * one local/offline implementation (`OfflineBibleProvider` and friends,
 * `apps/web/src/offline`). A remote Bible version is one more
 * `IBibleDataProvider` implementation, not a repository - no repository
 * interface changes, per this same task's explicit scope.
 *
 * ## Desktop
 *
 * Desktop does not implement these today - its IPC surface
 * (`electron/ipc/*Handlers.ts`, ~218 `invoke` call sites in the renderer, all
 * already async) plays the same role `ServerDataProvider`'s `fetch()` calls
 * play for web. `apps/desktop/src/api/dataProviderAdapter.ts` adapts it into
 * these same interfaces, so desktop code (and, in principle, a shared
 * component) can depend on `IDataProviders` instead of on IPC channel names
 * directly.
 */

import type {
  ChapterData,
  VerseData,
  CommentaryData,
  CommentaryHomeData,
  CommentaryAllModulesData,
  CommentaryModuleInfoData,
  ChapterOverviewData,
  BookTopicsData,
  InterlinearData,
  StrongsEntryData,
  StrongsSearchResult,
  SearchResultSet,
  SearchOptions,
  ModuleInfo,
  BookInfo,
  ModuleSectionsResponse,
  CrossRefGroupData,
  VerseTopicData,
  TopicDetailData,
  TopicChildData,
  TopicVerseData,
  TopicSearchResultData,
  TagGraphEntityData,
  TagGraphEntityDetailData,
  TagGraphAssociationData,
  TagGraphFacetData,
  TagGraphVerseData,
  TagGraphSearchResultData,
  TagGraphTopicLinkData,
} from './dto';

export interface VotdData {
  book: number;
  chapter: number;
  verse: number;
  text: string;
  text_html: string;
  holiday?: string;
}

export interface BatchVerseTexts {
  verses: Record<string, { verse_id: number; text: string; text_html: string }>;
}

export interface IBibleDataProvider {
  getChapter(module: string, book: number, chapter: number): Promise<ChapterData>;
  getVerse(module: string, verseId: number): Promise<VerseData>;
  getVerseTexts(module: string, verseIds: number[]): Promise<BatchVerseTexts>;
  getBookTopics(book: number): Promise<BookTopicsData>;
  getVerseOfTheDay(): Promise<VotdData>;
  /**
   * Can this module's text be answered without touching the network right now?
   *
   * Only the offline-first provider implements it; the plain server provider
   * leaves it undefined, which callers must read as "no". It exists so that
   * speculative work — warming a cache for a chapter the reader has not asked
   * for — can be skipped entirely when the whole translation is already sitting
   * on disk. Answering it must be synchronous and free: a caller that has to
   * await an answer would be better off just making the request.
   */
  isServedLocally?(module: string): boolean;
}

export interface CommentaryAvailability {
  [moduleAbbr: string]: { hasVerse: boolean; hasChapter: boolean };
}

export interface ICommentaryDataProvider {
  getCommentary(module: string, book: number, chapter: number): Promise<CommentaryData>;
  /** Bulk-fetch commentary content for a chapter. Pass `modules` to limit the
   *  request to a chosen subset — the whole active set can be megabytes. */
  getAllCommentary(book: number, chapter: number, modules?: string[]): Promise<CommentaryAllModulesData>;
  getAvailability(book: number, chapter: number, verse?: number): Promise<CommentaryAvailability>;
  getHomeData(book: number, chapter: number, verse?: number): Promise<CommentaryHomeData>;
  getModuleInfo(module: string): Promise<CommentaryModuleInfoData | null>;
  getChapterOverview(book: number, chapter: number): Promise<ChapterOverviewData>;
}

export interface ISearchProvider {
  keywordSearch(query: string, modules: string[], options?: SearchOptions): Promise<SearchResultSet>;
  semanticSearch(query: string, options?: SearchOptions): Promise<SearchResultSet>;
  strongsSearch(number: string, options?: { includeRelated?: boolean; modules?: string[]; scope?: number; maxResults?: number }): Promise<StrongsSearchResult>;
  warmupSemanticSearch(): Promise<void>;
}

export interface IInterlinearDataProvider {
  /** `module` selects the translation; omitting it lets the server pick its default. */
  getInterlinear(book: number, chapter: number, module?: string): Promise<InterlinearData>;
}

export interface SemanticIndexInfo {
  available: boolean;
  sizeBytes?: number;
}

export interface IModuleProvider {
  getAvailableModules(type?: string): Promise<ModuleInfo[]>;
  getBooks(): Promise<BookInfo[]>;
  getSemanticIndexInfo(): Promise<SemanticIndexInfo>;
  getModuleSections(): Promise<ModuleSectionsResponse>;
}

export interface IStrongsProvider {
  getEntry(strongsNumber: string): Promise<StrongsEntryData>;
}

export interface ICrossRefDataProvider {
  getGroupsForVerse(module: string, verseId: number): Promise<CrossRefGroupData[]>;
  getEntryCount(module: string, verseId: number): Promise<{ count: number }>;
}

export interface ITopicalDataProvider {
  getTopicsForVerse(verseId: number): Promise<VerseTopicData[]>;
  getTopic(module: string, topicId: number): Promise<TopicDetailData | null>;
  getChildren(module: string, topicId: number): Promise<TopicChildData[]>;
  getVersesForTopic(module: string, topicId: number, limit?: number, offset?: number): Promise<TopicVerseData[]>;
  searchTopics(query: string): Promise<TopicSearchResultData[]>;
  getModules?(): Promise<{ abbreviation: string; name: string }[]>;
}

export interface ITagGraphDataProvider {
  getEntitiesForVerse(verseId: number): Promise<TagGraphEntityData[]>;
  getEntity(category: string, entityId: string): Promise<TagGraphEntityDetailData | null>;
  getAssociations(category: string, entityId: string): Promise<TagGraphAssociationData[]>;
  getVersesForEntity(category: string, entityId: string): Promise<TagGraphVerseData[]>;
  getFacets(category: string, entityId: string): Promise<TagGraphFacetData[]>;
  searchEntities(query: string, categories?: string[]): Promise<TagGraphSearchResultData[]>;
  getTopicLinksForEntity(category: string, entityId: string): Promise<TagGraphTopicLinkData[]>;
}

/**
 * Serves pre-generated study overview data for a whole chapter at once
 * (commentary/topics/cross-refs/tag-graph entities keyed by verse), so the
 * Study pane needs one round trip per chapter instead of one per section per
 * verse. Unlike the other nine interfaces this one is not purely
 * request/response: `loadChapter` populates an in-memory cache and the
 * `get*ForVerse` accessors read it back synchronously, because they are
 * called once per verse while rendering a chapter already in hand.
 *
 * Moved here from `apps/web/src/providers/StudyOverviewProvider.ts`, which
 * keeps its own HTTP-`fetch`-based implementation (`StudyOverviewProvider`)
 * at that file, alongside `isDigestModule`/`getDigestDisplayName` display
 * logic that is web-UI-specific and does not belong in `packages/core`.
 */
export interface IStudyOverviewProvider {
  /**
   * Ensure study overview data is loaded for a chapter.
   * Returns immediately if already cached.
   */
  loadChapter(book: number, chapter: number): Promise<void>;

  /** Get commentary home data for a specific verse from the cached chapter data. */
  getCommentaryHomeForVerse(book: number, chapter: number, verse: number): CommentaryHomeData;

  /** Get topics for a specific verse from the cached chapter data. */
  getTopicsForVerse(book: number, chapter: number, verseId: number): VerseTopicData[];

  /** Get cross-reference groups for a specific verse from the cached chapter data. */
  getCrossRefsForVerse(book: number, chapter: number, verseId: number): CrossRefGroupData[];

  /** Get tag graph entities for a specific verse from the cached chapter data. */
  getEntitiesForVerse(book: number, chapter: number, verseId: number): TagGraphEntityData[];

  /** Whether the cache has data for this chapter. */
  hasChapter(book: number, chapter: number): boolean;

  /** Whether the cache is available (server returned cached: true). */
  isCacheAvailable(): boolean;
}

export interface IDataProviders {
  bible: IBibleDataProvider;
  commentary: ICommentaryDataProvider;
  search: ISearchProvider;
  interlinear: IInterlinearDataProvider;
  modules: IModuleProvider;
  strongs: IStrongsProvider;
  crossRef: ICrossRefDataProvider;
  topical: ITopicalDataProvider;
  tagGraph: ITagGraphDataProvider;
  studyOverview: IStudyOverviewProvider;
}
