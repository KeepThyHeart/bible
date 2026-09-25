/**
 * These DTO shapes moved into `packages/core` (task 0034, finishing 0029's
 * S3a: promote the data-provider interfaces into `packages/core` as the
 * app-wide content-source seam - see `@bible/core`'s `Providers/dto.ts` and
 * `Providers/interfaces.ts`). This file stays as a re-export so the many
 * components/stores/hooks across this app that import types from here keep
 * working unchanged; new code should prefer importing directly from
 * `@bible/core/browser`'s `Providers` namespace.
 */
import type { Providers } from '@bible/core/browser';

export type BookTopic = Providers.BookTopic;
export type BookTopicsData = Providers.BookTopicsData;
export type ChapterData = Providers.ChapterData;
export type VerseFootnote = Providers.VerseFootnote;
export type VerseData = Providers.VerseData;
export type CommentaryData = Providers.CommentaryData;
export type CommentaryEntryData = Providers.CommentaryEntryData;
export type InterlinearData = Providers.InterlinearData;
export type InterlinearWordData = Providers.InterlinearWordData;
export type StrongsEntryData = Providers.StrongsEntryData;
export type CommentaryHomeModule = Providers.CommentaryHomeModule;
export type CommentaryHomeData = Providers.CommentaryHomeData;
export type CommentaryAllModulesData = Providers.CommentaryAllModulesData;
export type ChapterOverviewEntry = Providers.ChapterOverviewEntry;
export type ChapterOverviewData = Providers.ChapterOverviewData;
export type CommentaryChapterVersesData = Providers.CommentaryChapterVersesData;
export type CommentaryModuleInfoData = Providers.CommentaryModuleInfoData;
export type SearchResultType = Providers.SearchResultType;
export type SearchResultData = Providers.SearchResultData;
export type SearchResultSet = Providers.SearchResultSet;
export type WordFamilyMemberData = Providers.WordFamilyMemberData;
export type StrongsSearchResult = Providers.StrongsSearchResult;
export type ModuleInfo = Providers.ModuleInfo;
export type ModuleSection = Providers.ModuleSection;
export type ModuleTypeInfo = Providers.ModuleTypeInfo;
export type ModuleSectionsResponse = Providers.ModuleSectionsResponse;
export type BookInfo = Providers.BookInfo;
export type SearchOptions = Providers.SearchOptions;
export type CrossRefGroupData = Providers.CrossRefGroupData;
export type CrossRefEntryData = Providers.CrossRefEntryData;
export type VerseTopicData = Providers.VerseTopicData;
export type TopicDetailData = Providers.TopicDetailData;
export type TopicChildData = Providers.TopicChildData;
export type TopicVerseData = Providers.TopicVerseData;
export type TopicSearchResultData = Providers.TopicSearchResultData;
export type TagGraphEntityData = Providers.TagGraphEntityData;
export type TagGraphEntityDetailData = Providers.TagGraphEntityDetailData;
export type TagGraphAssociationData = Providers.TagGraphAssociationData;
export type TagGraphVerseData = Providers.TagGraphVerseData;
export type TagGraphSearchResultData = Providers.TagGraphSearchResultData;
export type TagGraphFacetMember = Providers.TagGraphFacetMember;
export type TagGraphFacetData = Providers.TagGraphFacetData;
export type TagGraphTopicLinkData = Providers.TagGraphTopicLinkData;
