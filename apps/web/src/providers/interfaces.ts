import type {
  ChapterData,
  VerseData,
  CommentaryData,
  CommentaryHomeData,
  CommentaryAllModulesData,
  CommentaryChapterVersesData,
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
} from '../types';

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
  getChapterVerses(module: string, book: number, chapter: number): Promise<CommentaryChapterVersesData>;
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

import type { IStudyOverviewProvider } from './StudyOverviewProvider';
export type { IStudyOverviewProvider } from './StudyOverviewProvider';

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
