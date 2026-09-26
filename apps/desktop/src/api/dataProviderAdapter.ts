/**
 * Desktop adapter over the app-wide data-provider seam (`@bible/core`'s
 * `IDataProviders` and its ten member interfaces - task 0034, finishing
 * 0029's S3a).
 *
 * ## Why this exists
 *
 * `packages/core/src/Providers/interfaces.ts` is the seam a remote/licensed
 * Bible version would eventually implement - deliberately NOT the SQL-shaped
 * module repositories (see that file's own doc comment for the full
 * argument). Desktop's renderer never called through these interfaces
 * before: it talks to `electron/ipc/*Handlers.ts` directly, through the
 * per-domain convenience wrappers in `services/electronAPI.ts` (`bibleAPI`,
 * `commentaryAPI`, ...) or, for the domains that have no such wrapper yet
 * (topical, tag graph, cross-reference, study overview), through
 * `requireElectronAPI()` and `unwrap()` directly - both are IPC `invoke`
 * calls under the hood, already 100% async (0029's survey counted 218 call
 * sites). This file adapts that existing surface into the same
 * `IDataProviders` shape `apps/web/src/providers/ServerDataProvider.ts`
 * builds from `fetch()`, so desktop code (or, in principle, a shared
 * component) can depend on the provider interfaces instead of on IPC channel
 * names directly.
 *
 * ## Scope: a seam, not a shipped feature
 *
 * Nothing wires this into the desktop UI yet - desktop's own components read
 * `bibleAPI`/`commentaryAPI`/etc. directly today, and changing that is a
 * separate, much larger task with its own risk (every store, every
 * component). This file's job is only to prove the interfaces are
 * constructible from desktop's IPC surface, per task 0034's requirement 3.
 * A handful of methods have no desktop equivalent at all (desktop has no
 * "verse of the day" feature, no server-configured module sections, no
 * standalone "look up any Strong's number" endpoint - Strong's data is
 * reached per dictionary module); those throw a clearly labeled error
 * instead of fabricating a response, exactly the same "no license exists
 * yet, do not build the remote provider" posture the task spec takes for
 * requirement 3's own out-of-scope note.
 */

import { requireElectronAPI } from '../ui/services/electronAPI';
import { unwrap } from '../ui/services/ipcResult';
import { bibleAPI, commentaryAPI, dictionaryAPI, searchAPI } from '../ui/services/electronAPI';
import type { Providers } from '@bible/core/browser';

// Local aliases so the rest of this file reads exactly like
// `ServerDataProvider.ts`'s own implementation, which imports these names
// unqualified - `Providers` (`@bible/core/browser`) is namespaced only to
// avoid two DTO-name collisions with pre-existing root exports; see that
// namespace's own doc comment in `browser.ts`.
type IDataProviders = Providers.IDataProviders;
type IBibleDataProvider = Providers.IBibleDataProvider;
type BatchVerseTexts = Providers.BatchVerseTexts;
type VotdData = Providers.VotdData;
type ICommentaryDataProvider = Providers.ICommentaryDataProvider;
type CommentaryAvailability = Providers.CommentaryAvailability;
type ISearchProvider = Providers.ISearchProvider;
type IInterlinearDataProvider = Providers.IInterlinearDataProvider;
type IModuleProvider = Providers.IModuleProvider;
type SemanticIndexInfo = Providers.SemanticIndexInfo;
type IStrongsProvider = Providers.IStrongsProvider;
type ICrossRefDataProvider = Providers.ICrossRefDataProvider;
type ITopicalDataProvider = Providers.ITopicalDataProvider;
type ITagGraphDataProvider = Providers.ITagGraphDataProvider;
type IStudyOverviewProvider = Providers.IStudyOverviewProvider;
type ChapterData = Providers.ChapterData;
type VerseData = Providers.VerseData;
type CommentaryData = Providers.CommentaryData;
type CommentaryHomeData = Providers.CommentaryHomeData;
type CommentaryHomeModule = Providers.CommentaryHomeModule;
type CommentaryAllModulesData = Providers.CommentaryAllModulesData;
type CommentaryModuleInfoData = Providers.CommentaryModuleInfoData;
type ChapterOverviewData = Providers.ChapterOverviewData;
type BookTopicsData = Providers.BookTopicsData;
type InterlinearData = Providers.InterlinearData;
type StrongsEntryData = Providers.StrongsEntryData;
type SearchResultSet = Providers.SearchResultSet;
type StrongsSearchResult = Providers.StrongsSearchResult;
type SearchOptions = Providers.SearchOptions;
type ModuleInfo = Providers.ModuleInfo;
type BookInfo = Providers.BookInfo;
type ModuleSectionsResponse = Providers.ModuleSectionsResponse;
type CrossRefGroupData = Providers.CrossRefGroupData;
type VerseTopicData = Providers.VerseTopicData;
type TopicDetailData = Providers.TopicDetailData;
type TopicChildData = Providers.TopicChildData;
type TopicVerseData = Providers.TopicVerseData;
type TopicSearchResultData = Providers.TopicSearchResultData;
type TagGraphEntityData = Providers.TagGraphEntityData;
type TagGraphEntityDetailData = Providers.TagGraphEntityDetailData;
type TagGraphAssociationData = Providers.TagGraphAssociationData;
type TagGraphFacetData = Providers.TagGraphFacetData;
type TagGraphVerseData = Providers.TagGraphVerseData;
type TagGraphSearchResultData = Providers.TagGraphSearchResultData;
type TagGraphTopicLinkData = Providers.TagGraphTopicLinkData;

/** Thrown by a method with no desktop equivalent yet - see this file's own doc comment. */
class NotAvailableOnDesktop extends Error {
  constructor(method: string) {
    super(`${method} has no desktop IPC equivalent yet.`);
    this.name = 'NotAvailableOnDesktop';
  }
}

class DesktopBibleDataProvider implements IBibleDataProvider {
  async getChapter(module: string, book: number, chapter: number): Promise<ChapterData> {
    return bibleAPI.getChapter(module, book, chapter) as unknown as ChapterData;
  }

  async getVerse(module: string, verseId: number): Promise<VerseData> {
    return bibleAPI.getVerse(module, verseId) as unknown as VerseData;
  }

  async getVerseTexts(module: string, verseIds: number[]): Promise<BatchVerseTexts> {
    const texts = await bibleAPI.getVerseTexts(module, verseIds);
    // `bible:getVerseTexts` replies `{ [verseId]: text }` (plain string);
    // `BatchVerseTexts.verses` wants `{ verse_id, text, text_html }` per
    // entry. Desktop's handler does not separately format HTML for this
    // batch call, so `text_html` falls back to `text`.
    const verses: BatchVerseTexts['verses'] = {};
    for (const [key, text] of Object.entries(texts as Record<string, string>)) {
      verses[key] = { verse_id: Number(key), text, text_html: text };
    }
    return { verses };
  }

  async getBookTopics(_book: number): Promise<BookTopicsData> {
    // No desktop equivalent of the web app's per-book topic teaser list.
    throw new NotAvailableOnDesktop('IBibleDataProvider.getBookTopics');
  }

  async getVerseOfTheDay(): Promise<VotdData> {
    throw new NotAvailableOnDesktop('IBibleDataProvider.getVerseOfTheDay');
  }
}

class DesktopCommentaryDataProvider implements ICommentaryDataProvider {
  async getCommentary(module: string, _book: number, _chapter: number): Promise<CommentaryData> {
    // Desktop's commentary IPC is verse-keyed (`getEntriesForVerse`), not
    // chapter-keyed like the web route this DTO was shaped for. Batch
    // session restore (`commentary:batchRestoreSession`) is the nearest
    // chapter-shaped call desktop has, and needs a verseId, not a bare
    // chapter - so this maps as closely as the two surfaces allow: return
    // this module's entries for whichever verse the caller most recently
    // asked about is not knowable here, so this throws rather than guess.
    void module;
    throw new NotAvailableOnDesktop('ICommentaryDataProvider.getCommentary (desktop indexes commentary by verse, not chapter)');
  }

  async getAllCommentary(_book: number, _chapter: number, _modules?: string[]): Promise<CommentaryAllModulesData> {
    throw new NotAvailableOnDesktop('ICommentaryDataProvider.getAllCommentary (desktop indexes commentary by verse, not chapter)');
  }

  async getAvailability(_book: number, _chapter: number, _verse?: number): Promise<CommentaryAvailability> {
    throw new NotAvailableOnDesktop('ICommentaryDataProvider.getAvailability');
  }

  async getHomeData(_book: number, _chapter: number, verse?: number): Promise<CommentaryHomeData> {
    if (verse == null) throw new NotAvailableOnDesktop('ICommentaryDataProvider.getHomeData without a verse');
    // Desktop has no single "home data for this verse across every
    // commentary" call; `commentary:getAvailableCommentaries` plus a
    // per-module `getEntriesForVerse` would compose the same answer but is
    // out of scope for this thin adapter - see the file's own doc comment.
    throw new NotAvailableOnDesktop('ICommentaryDataProvider.getHomeData');
  }

  async getModuleInfo(module: string): Promise<CommentaryModuleInfoData | null> {
    try {
      return await commentaryAPI.getCommentaryInfo(module) as unknown as CommentaryModuleInfoData;
    } catch {
      return null;
    }
  }

  async getChapterOverview(_book: number, _chapter: number): Promise<ChapterOverviewData> {
    throw new NotAvailableOnDesktop('ICommentaryDataProvider.getChapterOverview');
  }
}

class DesktopSearchProvider implements ISearchProvider {
  async keywordSearch(query: string, modules: string[], options?: SearchOptions): Promise<SearchResultSet> {
    const results = await searchAPI.performSearch(query, { ...options, modules, scope: 'modules' });
    const arr = results as unknown as unknown[];
    return { results: arr as SearchResultSet['results'], total: arr.length };
  }

  async semanticSearch(query: string, options?: SearchOptions): Promise<SearchResultSet> {
    const results = await searchAPI.semanticSearch(query, { maxResults: options?.pageSize });
    const arr = results as unknown as unknown[];
    return { results: arr as SearchResultSet['results'], total: arr.length };
  }

  async strongsSearch(_number: string): Promise<StrongsSearchResult> {
    // Desktop's search IPC has no standalone Strong's-number search channel
    // (Strong's browsing goes through `dictionaryAPI` per module instead).
    throw new NotAvailableOnDesktop('ISearchProvider.strongsSearch');
  }

  async warmupSemanticSearch(): Promise<void> {
    // Desktop keeps the embedder loaded lazily on first real query; there is
    // nothing separate to warm.
  }
}

class DesktopInterlinearDataProvider implements IInterlinearDataProvider {
  async getInterlinear(book: number, chapter: number, module?: string): Promise<InterlinearData> {
    if (!module) throw new NotAvailableOnDesktop('IInterlinearDataProvider.getInterlinear without a module (desktop has no server-side default Bible)');
    const words = await bibleAPI.getInterlinearWordsForChapter(module, book, chapter);
    const flat = Object.values(words as Record<number, unknown[]>).flat();
    return {
      words: flat as InterlinearData['words'],
      // Desktop's IPC does not separately hand back a Strong's entry map
      // alongside interlinear words; the renderer resolves Strong's numbers
      // through `dictionaryAPI` as needed.
      strongsEntries: {},
    };
  }
}

class DesktopModuleProvider implements IModuleProvider {
  async getAvailableModules(type?: string): Promise<ModuleInfo[]> {
    const collect = async (moduleType: string, load: () => Promise<unknown[]>): Promise<ModuleInfo[]> => {
      const rows = await load();
      return (rows as Array<Record<string, unknown>>).map(r => ({
        module_id: r.module_id as number,
        abbreviation: r.abbreviation as string,
        name: r.name as string,
        type: moduleType,
        language_code: r.language_code as string,
      }));
    };

    const sources: Record<string, () => Promise<unknown[]>> = {
      bible: () => bibleAPI.getAvailableBibles(),
      commentary: () => commentaryAPI.getAvailableCommentaries(),
      dictionary: () => dictionaryAPI.getAvailableDictionaries(),
      book: async () => (await unwrap(requireElectronAPI().book.getAvailableBooks())) as unknown[],
      topical_index: async () => (await unwrap(requireElectronAPI().topical.getAvailable())) as unknown[],
      cross_reference: async () => (await unwrap(requireElectronAPI().crossReference.getAvailable())) as unknown[],
    };

    if (type) {
      const load = sources[type];
      return load ? collect(type, load) : [];
    }

    const all = await Promise.all(Object.entries(sources).map(([moduleType, load]) => collect(moduleType, load)));
    return all.flat();
  }

  async getBooks(): Promise<BookInfo[]> {
    return bibleAPI.getAllBooks() as unknown as BookInfo[];
  }

  async getSemanticIndexInfo(): Promise<SemanticIndexInfo> {
    // Desktop's `search:semanticAvailable` answers only the boolean half of
    // this DTO; it has no equivalent of the web index's on-disk size.
    const available = await searchAPI.semanticAvailable();
    return { available };
  }

  async getModuleSections(): Promise<ModuleSectionsResponse> {
    // `settings.json`-driven module sections are a web-deployment concept
    // (self-hosted admin configuration); desktop has no equivalent.
    throw new NotAvailableOnDesktop('IModuleProvider.getModuleSections');
  }
}

class DesktopStrongsProvider implements IStrongsProvider {
  async getEntry(_strongsNumber: string): Promise<StrongsEntryData> {
    throw new NotAvailableOnDesktop('IStrongsProvider.getEntry (desktop resolves Strong entries per dictionary module, not by bare number)');
  }
}

class DesktopCrossRefDataProvider implements ICrossRefDataProvider {
  async getGroupsForVerse(module: string, verseId: number): Promise<CrossRefGroupData[]> {
    const api = requireElectronAPI();
    return unwrap(api.crossReference.getGroupsForVerse(module, verseId)) as unknown as Promise<CrossRefGroupData[]>;
  }

  async getEntryCount(module: string, verseId: number): Promise<{ count: number }> {
    const api = requireElectronAPI();
    const count = await unwrap(api.crossReference.getEntryCount(module, verseId));
    return { count };
  }
}

class DesktopTopicalDataProvider implements ITopicalDataProvider {
  async getTopicsForVerse(verseId: number): Promise<VerseTopicData[]> {
    const api = requireElectronAPI();
    return unwrap(api.topical.getTopicsForVerse(verseId)) as unknown as Promise<VerseTopicData[]>;
  }

  async getTopic(module: string, topicId: number): Promise<TopicDetailData | null> {
    const api = requireElectronAPI();
    return unwrap(api.topical.getTopic(module, topicId)) as unknown as Promise<TopicDetailData | null>;
  }

  async getChildren(module: string, topicId: number): Promise<TopicChildData[]> {
    const api = requireElectronAPI();
    return unwrap(api.topical.getChildren(module, topicId)) as unknown as Promise<TopicChildData[]>;
  }

  async getVersesForTopic(module: string, topicId: number, limit?: number, offset?: number): Promise<TopicVerseData[]> {
    const api = requireElectronAPI();
    return unwrap(api.topical.getVersesForTopic(module, topicId, limit, offset)) as unknown as Promise<TopicVerseData[]>;
  }

  async searchTopics(query: string): Promise<TopicSearchResultData[]> {
    const api = requireElectronAPI();
    return unwrap(api.topical.searchTopics(query)) as unknown as Promise<TopicSearchResultData[]>;
  }

  async getModules(): Promise<{ abbreviation: string; name: string }[]> {
    const api = requireElectronAPI();
    const modules = await unwrap(api.topical.getAvailable()) as Array<{ abbreviation: string; moduleName?: string; name?: string }>;
    return modules.map(m => ({ abbreviation: m.abbreviation, name: m.name ?? m.moduleName ?? m.abbreviation }));
  }
}

class DesktopTagGraphDataProvider implements ITagGraphDataProvider {
  async getEntitiesForVerse(verseId: number): Promise<TagGraphEntityData[]> {
    // Desktop's tag-graph IPC has no single "entities at this verse" channel
    // (its entities are addressed by category+id, not queried by verse) -
    // see `tagGraphHandlers.ts`. No adaptation exists without a new
    // main-process query.
    void verseId;
    throw new NotAvailableOnDesktop('ITagGraphDataProvider.getEntitiesForVerse');
  }

  async getEntity(category: string, entityId: string): Promise<TagGraphEntityDetailData | null> {
    const api = requireElectronAPI();
    return unwrap(api.tagGraph.getEntity(entityId, category)) as unknown as Promise<TagGraphEntityDetailData | null>;
  }

  async getAssociations(category: string, entityId: string): Promise<TagGraphAssociationData[]> {
    const api = requireElectronAPI();
    return unwrap(api.tagGraph.getAssociationsForEntity(entityId, category)) as unknown as Promise<TagGraphAssociationData[]>;
  }

  async getVersesForEntity(category: string, entityId: string): Promise<TagGraphVerseData[]> {
    const api = requireElectronAPI();
    return unwrap(api.tagGraph.getVersesForEntity(entityId, category)) as unknown as Promise<TagGraphVerseData[]>;
  }

  async getFacets(category: string, entityId: string): Promise<TagGraphFacetData[]> {
    const api = requireElectronAPI();
    return unwrap(api.tagGraph.getFacetsForEntity(entityId, category)) as unknown as Promise<TagGraphFacetData[]>;
  }

  async searchEntities(query: string, categories?: string[]): Promise<TagGraphSearchResultData[]> {
    const api = requireElectronAPI();
    return unwrap(api.tagGraph.searchEntities(query, categories)) as unknown as Promise<TagGraphSearchResultData[]>;
  }

  async getTopicLinksForEntity(category: string, entityId: string): Promise<TagGraphTopicLinkData[]> {
    const api = requireElectronAPI();
    return unwrap(api.tagGraph.getTopicLinksForEntity(entityId, category)) as unknown as Promise<TagGraphTopicLinkData[]>;
  }
}

/**
 * Sources per-chapter study overview data from desktop's own pre-generated
 * cache (`study:getOverview`, backed by `StudyCacheService`) instead of the
 * web app's `/api/study/overview/:book/:chapter`. The two use the same
 * compact wire format on purpose (`packages/core/src/Services/StudyOverview/types.ts`'s
 * own doc comment: "mirror the wire format used by the pre-generated study
 * cache") - the per-verse extraction logic here mirrors
 * `apps/web/src/providers/StudyOverviewProvider.ts`'s.
 */
interface StudyOverviewCacheEntry {
  commentary: Array<{ m: string; mn: string; s: number; e: number; l: string; w: number }>;
  topics: Record<string, Array<{ id: number; n: string; p?: string; vc: number; src: string; sn: string; d?: string }>>;
  crossrefs: Record<string, Array<{ src: string; g: { id: number; ph?: string; so: number }; e: Array<{ tv: number; tve?: number; n?: string; so: number }> }>>;
  entities: Record<string, Array<{ eid: string; cat: string; n: string; src?: string }>>;
}

class DesktopStudyOverviewProvider implements IStudyOverviewProvider {
  private cache = new Map<string, StudyOverviewCacheEntry>();
  private available: boolean | null = null;

  private key(book: number, chapter: number): string {
    return `${book}-${chapter}`;
  }

  async loadChapter(book: number, chapter: number): Promise<void> {
    const key = this.key(book, chapter);
    if (this.cache.has(key)) return;

    const api = requireElectronAPI();
    const payload = await unwrap(api.study.getOverview(book, chapter));
    this.available = payload.available;
    if (!payload.available) return;

    this.cache.set(key, {
      commentary: payload.commentary as unknown as StudyOverviewCacheEntry['commentary'],
      topics: payload.topics as unknown as StudyOverviewCacheEntry['topics'],
      crossrefs: payload.crossrefs as unknown as StudyOverviewCacheEntry['crossrefs'],
      entities: payload.entities as unknown as StudyOverviewCacheEntry['entities'],
    });
  }

  getCommentaryHomeForVerse(book: number, chapter: number, verse: number): CommentaryHomeData {
    const cached = this.cache.get(this.key(book, chapter));
    if (!cached) return { verseModules: [], chapterModules: [] };

    const verseId = book * 1000000 + chapter * 1000 + verse;
    const verseModules = new Map<string, CommentaryHomeModule>();
    const passageModules = new Map<string, CommentaryHomeModule>();
    const chapterModules = new Map<string, CommentaryHomeModule>();

    for (const entry of cached.commentary) {
      const coversVerse = entry.s <= verseId && entry.e >= verseId;
      if (!coversVerse) continue;

      const isVerse = entry.l === 'verse' && entry.s === verseId;
      const isPassage = !isVerse && (entry.l === 'passage' || entry.e !== entry.s);
      const isChapter = entry.l === 'chapter' || entry.l === 'book';
      const mod: CommentaryHomeModule = { moduleAbbr: entry.m, moduleName: entry.mn, wordCount: entry.w };

      if (isVerse) {
        const existing = verseModules.get(entry.m);
        if (existing) existing.wordCount += entry.w; else verseModules.set(entry.m, mod);
      } else if (isPassage) {
        if (!verseModules.has(entry.m)) {
          const existing = passageModules.get(entry.m);
          if (existing) existing.wordCount += entry.w; else passageModules.set(entry.m, mod);
        }
      } else if (isChapter) {
        if (!verseModules.has(entry.m) && !passageModules.has(entry.m)) {
          const existing = chapterModules.get(entry.m);
          if (existing) existing.wordCount += entry.w; else chapterModules.set(entry.m, mod);
        }
      }
    }

    return {
      verseModules: [...verseModules.values()].sort((a, b) => a.moduleName.localeCompare(b.moduleName)),
      passageModules: passageModules.size > 0 ? [...passageModules.values()].sort((a, b) => a.moduleName.localeCompare(b.moduleName)) : undefined,
      chapterModules: [...chapterModules.values()].sort((a, b) => a.moduleName.localeCompare(b.moduleName)),
    };
  }

  getTopicsForVerse(book: number, chapter: number, verseId: number): VerseTopicData[] {
    const cached = this.cache.get(this.key(book, chapter));
    const topics = cached?.topics[String(verseId)];
    if (!topics) return [];
    return topics.map(t => ({
      topic_id: t.id,
      parent_topic_id: null,
      parent_name: t.p,
      ancestors: t.p ? t.p.split(' > ').map(name => ({ topic_id: 0, name, verse_count: 0 })) : [],
      name: t.n,
      description: t.d ?? null,
      source_abbreviation: t.src,
      source_name: t.sn,
      verse_count: t.vc,
    }));
  }

  getCrossRefsForVerse(book: number, chapter: number, verseId: number): CrossRefGroupData[] {
    const cached = this.cache.get(this.key(book, chapter));
    const groups = cached?.crossrefs[String(verseId)];
    if (!groups) return [];
    return groups.map(g => ({
      group: { group_id: g.g.id, verse_id: verseId, phrase: g.g.ph ?? null, sort_order: g.g.so },
      entries: g.e.map((e, i) => ({
        entry_id: i,
        group_id: g.g.id,
        target_verse_id: e.tv,
        target_verse_end_id: e.tve ?? null,
        note: e.n ?? null,
        sort_order: e.so,
      })),
    }));
  }

  getEntitiesForVerse(book: number, chapter: number, verseId: number): TagGraphEntityData[] {
    const cached = this.cache.get(this.key(book, chapter));
    const entities = cached?.entities[String(verseId)];
    if (!entities) return [];
    return entities.map(e => ({ entity_id: e.eid, category: e.cat, name: e.n, source: e.src }));
  }

  hasChapter(book: number, chapter: number): boolean {
    return this.cache.has(this.key(book, chapter));
  }

  isCacheAvailable(): boolean {
    return this.available === true;
  }
}

/** Build the full `IDataProviders` set from desktop's existing IPC surface. */
export function createDesktopDataProviders(): IDataProviders {
  return {
    bible: new DesktopBibleDataProvider(),
    commentary: new DesktopCommentaryDataProvider(),
    search: new DesktopSearchProvider(),
    interlinear: new DesktopInterlinearDataProvider(),
    modules: new DesktopModuleProvider(),
    strongs: new DesktopStrongsProvider(),
    crossRef: new DesktopCrossRefDataProvider(),
    topical: new DesktopTopicalDataProvider(),
    tagGraph: new DesktopTagGraphDataProvider(),
    studyOverview: new DesktopStudyOverviewProvider(),
  };
}
