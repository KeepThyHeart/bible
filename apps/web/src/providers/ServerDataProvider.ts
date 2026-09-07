import type {
  IBibleDataProvider,
  BatchVerseTexts,
  VotdData,
  ICommentaryDataProvider,
  CommentaryAvailability,
  ISearchProvider,
  IInterlinearDataProvider,
  IModuleProvider,
  SemanticIndexInfo,
  IStrongsProvider,
  ICrossRefDataProvider,
  ITopicalDataProvider,
  ITagGraphDataProvider,
  IDataProviders,
} from './interfaces';
import { StudyOverviewProvider } from './StudyOverviewProvider';
import { settingsStore } from '../stores/settingsStore';
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
  SearchResultSet,
  StrongsSearchResult,
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

import { connectionStore } from '../stores/connectionStore';
import { navigateToLoginOnce, showBootError } from '../utils/bootGuard';

// Module-level flag prevents multiple concurrent 401 responses from each
// triggering a redirect. Once one 401 starts the redirect flow, all others
// in the same page load just hang. This only covers a single page load —
// navigateToLoginOnce() is what bounds attempts *across* navigations.
let authRedirectInProgress = false;

/**
 * The session expired mid-use. Try once to reach the login page; if that
 * allowance is already spent, put the recovery UI up and let the user decide.
 *
 * The previous version called `window.location.replace('/')` on the belief that
 * "the service worker does NOT cache index.html, so this always hits the
 * server". That stopped being true when index.html was added to the precache,
 * and the navigation started being answered from cache — so the app rebooted,
 * hit the same 401, and navigated again, forever.
 */
function handleAuthFailure(): Promise<never> {
  if (!authRedirectInProgress) {
    authRedirectInProgress = true;
    if (!navigateToLoginOnce()) {
      showBootError('Your session has expired. Reload to sign in again.');
    }
  }
  // Never resolves: either the page is navigating away, or the recovery UI is up
  // and there is nothing useful for the caller to do with a rejection.
  return new Promise<never>(() => {});
}

async function fetchJson<T>(url: string): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      // Auth expired — send the user to the server login page (production only; dev uses noAuth)
      if (res.status === 401 || res.status === 403 || (res.status === 200 && body.includes('<form') && body.includes('login'))) {
        return handleAuthFailure();
      }
      throw new Error(`API error ${res.status}: ${body}`);
    }
    return res.json();
  } catch (error) {
    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Load failed') || error.message.includes('network') || error.message.includes('abort'))) {
      connectionStore.setError('Unable to connect to the server. Please check your connection and try again.');
      throw new Error('Network error: Unable to connect to the server. Please check your connection and try again.');
    }
    throw error;
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401 || res.status === 403) {
        return handleAuthFailure();
      }
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return res.json();
  } catch (error) {
    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Load failed') || error.message.includes('network') || error.message.includes('abort'))) {
      connectionStore.setError('Unable to connect to the server. Please check your connection and try again.');
      throw new Error('Network error: Unable to connect to the server. Please check your connection and try again.');
    }
    throw error;
  }
}

class BibleDataProvider implements IBibleDataProvider {
  constructor(private baseUrl: string) {}

  getChapter(module: string, book: number, chapter: number): Promise<ChapterData> {
    return fetchJson(`${this.baseUrl}/api/bible/${module}/${book}/${chapter}`);
  }

  getVerse(module: string, verseId: number): Promise<VerseData> {
    return fetchJson(`${this.baseUrl}/api/bible/${module}/verse/${verseId}`);
  }

  getVerseTexts(module: string, verseIds: number[]): Promise<BatchVerseTexts> {
    return postJson(`${this.baseUrl}/api/bible/${module}/verses`, { verseIds });
  }

  getBookTopics(book: number): Promise<BookTopicsData> {
    return fetchJson(`${this.baseUrl}/api/bible/topics/${book}`);
  }

  getVerseOfTheDay(): Promise<VotdData> {
    return fetchJson(`${this.baseUrl}/api/bible/votd`);
  }
}

class CommentaryDataProvider implements ICommentaryDataProvider {
  constructor(private baseUrl: string) {}

  getCommentary(module: string, book: number, chapter: number): Promise<CommentaryData> {
    return fetchJson(`${this.baseUrl}/api/commentary/${module}/${book}/${chapter}`);
  }

  getAllCommentary(book: number, chapter: number, modules?: string[]): Promise<CommentaryAllModulesData> {
    const params = modules?.length ? `?modules=${encodeURIComponent(modules.join(','))}` : '';
    return fetchJson(`${this.baseUrl}/api/commentary/all/${book}/${chapter}${params}`);
  }

  getAvailability(book: number, chapter: number, verse?: number): Promise<CommentaryAvailability> {
    const params = verse ? `?verse=${verse}` : '';
    return fetchJson(`${this.baseUrl}/api/commentary/availability/${book}/${chapter}${params}`);
  }

  getHomeData(book: number, chapter: number, verse?: number): Promise<CommentaryHomeData> {
    const params = verse ? `?verse=${verse}` : '';
    return fetchJson(`${this.baseUrl}/api/commentary/home/${book}/${chapter}${params}`);
  }

  getChapterVerses(module: string, book: number, chapter: number): Promise<CommentaryChapterVersesData> {
    return fetchJson(`${this.baseUrl}/api/commentary/${module}/chapter-verses/${book}/${chapter}`);
  }

  async getModuleInfo(module: string): Promise<CommentaryModuleInfoData | null> {
    try {
      return await fetchJson(`${this.baseUrl}/api/commentary/info/${module}`);
    } catch {
      return null;
    }
  }

  async getChapterOverview(book: number, chapter: number): Promise<ChapterOverviewData> {
    const raw = await fetchJson<{ book: number; chapter: number; modules: [string, string][]; entries: [number, number, number, string, number][] }>(
      `${this.baseUrl}/api/commentary/chapter-overview/${book}/${chapter}`
    );
    return {
      book: raw.book,
      chapter: raw.chapter,
      modules: raw.modules,
      entries: raw.entries.map(
        ([moduleIdx, startVerse, endVerse, level, wordCount]) =>
          ({ moduleIdx, startVerse, endVerse, level, wordCount })
      ),
    };
  }
}

class SearchDataProvider implements ISearchProvider {
  constructor(private baseUrl: string) {}

  keywordSearch(query: string, modules: string[], options?: SearchOptions): Promise<SearchResultSet> {
    const params = new URLSearchParams({ q: query });
    if (modules.length > 0) params.set('modules', modules.join(','));
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    return fetchJson(`${this.baseUrl}/api/search/keyword?${params}`);
  }

  semanticSearch(query: string, options?: SearchOptions): Promise<SearchResultSet> {
    const params = new URLSearchParams({ q: query });
    if (options?.pageSize) params.set('maxResults', String(options.pageSize));
    // The server matches on KJV-derived embeddings either way; this tells it
    // which translation to render the matched verses *in*.
    if (options?.modules?.length) params.set('modules', options.modules.join(','));
    return fetchJson(`${this.baseUrl}/api/search/semantic?${params}`);
  }

  strongsSearch(number: string, options?: { includeRelated?: boolean; modules?: string[]; scope?: number; maxResults?: number }): Promise<StrongsSearchResult> {
    const params = new URLSearchParams({ number });
    if (options?.includeRelated) params.set('includeRelated', 'true');
    if (options?.modules?.length) params.set('modules', options.modules.join(','));
    if (options?.scope) params.set('scope', String(options.scope));
    if (options?.maxResults) params.set('maxResults', String(options.maxResults));
    return fetchJson(`${this.baseUrl}/api/search/strongs?${params}`);
  }

  async warmupSemanticSearch(): Promise<void> {
    await fetch(`${this.baseUrl}/api/search/semantic/warmup`, { method: 'POST' }).catch(() => {});
  }
}

class InterlinearDataProvider implements IInterlinearDataProvider {
  constructor(private baseUrl: string) {}

  getInterlinear(book: number, chapter: number, module?: string): Promise<InterlinearData> {
    // Without the module the server falls back to KJV, so every translation
    // silently showed KJV's interlinear data.
    const query = module ? `?module=${encodeURIComponent(module)}` : '';
    return fetchJson(`${this.baseUrl}/api/interlinear/${book}/${chapter}${query}`);
  }
}

class ModuleDataProvider implements IModuleProvider {
  constructor(private baseUrl: string) {}

  getAvailableModules(type?: string): Promise<ModuleInfo[]> {
    const url = type
      ? `${this.baseUrl}/api/modules?type=${type}`
      : `${this.baseUrl}/api/modules`;
    return fetchJson(url);
  }

  getBooks(): Promise<BookInfo[]> {
    return fetchJson(`${this.baseUrl}/api/books`);
  }

  getSemanticIndexInfo(): Promise<SemanticIndexInfo> {
    return fetchJson(`${this.baseUrl}/api/modules/semantic-index/info`);
  }

  getModuleSections(): Promise<ModuleSectionsResponse> {
    return fetchJson(`${this.baseUrl}/api/module-sections`);
  }
}

class StrongsDataProvider implements IStrongsProvider {
  constructor(private baseUrl: string) {}

  getEntry(strongsNumber: string): Promise<StrongsEntryData> {
    return fetchJson(`${this.baseUrl}/api/strongs/${strongsNumber}`);
  }
}

class CrossRefDataProvider implements ICrossRefDataProvider {
  constructor(private baseUrl: string) {}

  getGroupsForVerse(module: string, verseId: number): Promise<CrossRefGroupData[]> {
    return fetchJson(`${this.baseUrl}/api/xref/${module}/${verseId}/groups`);
  }

  getEntryCount(module: string, verseId: number): Promise<{ count: number }> {
    return fetchJson(`${this.baseUrl}/api/xref/${module}/${verseId}/count`);
  }
}

class TopicalDataProvider implements ITopicalDataProvider {
  constructor(private baseUrl: string, private getExcluded?: () => string[]) {}

  private excludeParam(): string {
    const excluded = this.getExcluded?.() ?? [];
    return excluded.length > 0 ? `exclude=${encodeURIComponent(excluded.join(','))}` : '';
  }

  getTopicsForVerse(verseId: number): Promise<VerseTopicData[]> {
    const ep = this.excludeParam();
    return fetchJson(`${this.baseUrl}/api/topical/verse/${verseId}${ep ? `?${ep}` : ''}`);
  }

  getTopic(module: string, topicId: number): Promise<TopicDetailData | null> {
    return fetchJson(`${this.baseUrl}/api/topical/${module}/topic/${topicId}`);
  }

  getChildren(module: string, topicId: number): Promise<TopicChildData[]> {
    return fetchJson(`${this.baseUrl}/api/topical/${module}/topic/${topicId}/children`);
  }

  getVersesForTopic(module: string, topicId: number, limit?: number, offset?: number): Promise<TopicVerseData[]> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const qs = params.toString();
    return fetchJson(`${this.baseUrl}/api/topical/${module}/topic/${topicId}/verses${qs ? `?${qs}` : ''}`);
  }

  searchTopics(query: string): Promise<TopicSearchResultData[]> {
    const ep = this.excludeParam();
    return fetchJson(`${this.baseUrl}/api/topical/search?q=${encodeURIComponent(query)}${ep ? `&${ep}` : ''}`);
  }

  getModules(): Promise<{ abbreviation: string; name: string }[]> {
    return fetchJson(`${this.baseUrl}/api/topical/modules`);
  }
}

class TagGraphDataProvider implements ITagGraphDataProvider {
  constructor(private baseUrl: string) {}

  getEntitiesForVerse(verseId: number): Promise<TagGraphEntityData[]> {
    return fetchJson(`${this.baseUrl}/api/taggraph/verse/${verseId}`);
  }

  getEntity(category: string, entityId: string): Promise<TagGraphEntityDetailData | null> {
    return fetchJson(`${this.baseUrl}/api/taggraph/entity/${category}/${entityId}`);
  }

  getAssociations(category: string, entityId: string): Promise<TagGraphAssociationData[]> {
    return fetchJson(`${this.baseUrl}/api/taggraph/entity/${category}/${entityId}/associations`);
  }

  getVersesForEntity(category: string, entityId: string): Promise<TagGraphVerseData[]> {
    return fetchJson(`${this.baseUrl}/api/taggraph/entity/${category}/${entityId}/verses`);
  }

  getFacets(category: string, entityId: string): Promise<TagGraphFacetData[]> {
    return fetchJson(`${this.baseUrl}/api/taggraph/entity/${category}/${entityId}/facets`);
  }

  searchEntities(query: string, categories?: string[]): Promise<TagGraphSearchResultData[]> {
    const params = new URLSearchParams({ q: query });
    if (categories?.length) params.set('categories', categories.join(','));
    return fetchJson(`${this.baseUrl}/api/taggraph/search?${params}`);
  }

  getTopicLinksForEntity(category: string, entityId: string): Promise<TagGraphTopicLinkData[]> {
    return fetchJson(`${this.baseUrl}/api/taggraph/entity/${category}/${entityId}/topic-links`);
  }
}

export function createServerProviders(baseUrl: string): IDataProviders {
  return {
    bible: new BibleDataProvider(baseUrl),
    commentary: new CommentaryDataProvider(baseUrl),
    search: new SearchDataProvider(baseUrl),
    interlinear: new InterlinearDataProvider(baseUrl),
    modules: new ModuleDataProvider(baseUrl),
    strongs: new StrongsDataProvider(baseUrl),
    crossRef: new CrossRefDataProvider(baseUrl),
    topical: new TopicalDataProvider(baseUrl, () => settingsStore.excludedTopicalModules),
    tagGraph: new TagGraphDataProvider(baseUrl),
    studyOverview: new StudyOverviewProvider(baseUrl),
  };
}
