/**
 * SearchOrchestrationService - framework-agnostic orchestration of the
 * semantic search pipeline (fuse -> consolidate -> tagRerank -> expandTopics -> enrich).
 *
 * Web routes and desktop IPC handlers become thin adapters that delegate here.
 */

import type { ISearchPipeline, RerankResult, ScoringConfig, TopicMatch, TopicVerseData } from './Search';
import type { IEnrichmentRepository, EnrichmentTagMatch } from '../Data/Repositories/IEnrichmentRepository';
import type { IBibleRepository } from '../Data/Repositories/IBibleRepository';
import type { ISearchService } from './ISearchService';
import { VerseIdHelper } from '../Data/Core/Types';
import { fuse } from './Search/ScoreFusion';
import { consolidate } from './Search/Consolidation';
import { tagRerank } from './Search/TagReranking';
import { expandTopics } from './Search/TopicExpansion';
import { resolveScoringConfig, filterTopicEntries } from './Search/ScoringUtils';
import { extractMeaningfulTerms } from './Search/StopWords';

// -- Topic entry interface (mirrors web's TopicEntry) ----------------

/** Minimal interface for a topic entry used in search orchestration. */
export interface SearchTopicEntry {
  embeddingId: string;
  tagName: string;
  tagType: string;
  verseCount: number;
  avgStrength: number;
  naveTopicId: number | null;
  torreyTopicId: number | null;
}

// -- Topical repo provider -------------------------------------------

/** Provider for looking up topic verses (Nave's, Torrey's). */
export interface ITopicalRepoProvider {
  getTopicalRepo(source: string): { getTopicVerses(topicId: number, limit: number): Array<{ startVerseId: number; endVerseId: number }> } | null;
}

// -- Result types ----------------------------------------------------

export interface SemanticSearchResult {
  verseId: number;
  endVerseId: number;
  reference: string;
  title?: string;
  text: string;
  snippet: string;
  score: number;
  module: string;
  type: string;
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  total: number;
  timings: Record<string, number>;
}

export interface SemanticSearchParams {
  query: string;
  maxResults: number;
  hybrid?: boolean;
  modules?: string[];
  pipeline: ISearchPipeline;
  topicEntries?: Map<string, SearchTopicEntry>;
  /** Bible repo for enriching results with verse text */
  bibleRepo?: IBibleRepository;
  /** Module abbreviation for the bibleRepo (e.g. 'KJV') */
  bibleModule?: string;
  bookNames: Map<number, string>;
  /** For hybrid mode: keyword search service */
  searchService?: ISearchService;
  /** For topic expansion: topical repo provider */
  topicalRepoProvider?: ITopicalRepoProvider;
}

export interface SearchOrchestrationConfig {
  scoringConfig?: ScoringConfig;
  /**
   * How many candidates to retrieve and rerank, as a multiple of the caller's
   * maxResults. Default: 1.
   *
   * Reranking is the dominant cost in the pipeline and scales linearly with
   * this, so the multiplier is a direct latency dial: at the route's default
   * of 20 results, a multiplier of 3 reranked 60 pairs. Raise it to give
   * consolidation more overlapping ranges to merge, at proportional cost.
   */
  rerankCandidateMultiplier?: number;
  minScore?: number;
  hybridDefault?: boolean;
}

// -- Internal pipeline result type -----------------------------------

type PipelineResult = RerankResult & { score: number; fusedScore?: number; consolidatedScore?: number };

// -- Service ---------------------------------------------------------

export class SearchOrchestrationService {
  constructor(
    private enrichmentRepo: IEnrichmentRepository | null,
    private config: SearchOrchestrationConfig = {},
  ) {}

  /**
   * Run the full semantic search pipeline: embed -> vector search -> rerank ->
   * score fusion -> consolidate -> tag rerank -> topic expansion -> enrich.
   */
  async semanticSearch(params: SemanticSearchParams): Promise<SemanticSearchResponse> {
    const {
      query,
      maxResults,
      pipeline,
      topicEntries: rawTopicEntries,
      bibleRepo,
      bibleModule = 'KJV',
      bookNames,
      topicalRepoProvider,
    } = params;

    const scoring = resolveScoringConfig(this.config.scoringConfig);
    const routeStart = Date.now();
    const detailedTimings: Record<string, number> = {};

    // Filter topic entries based on topicSources config
    const topicEntries = rawTopicEntries
      ? filterTopicEntries(rawTopicEntries, scoring.topicSources)
      : undefined;
    const includeTopic = topicEntries && topicEntries.size > 0;

    // 1. Pipeline search (embed -> vector search -> rerank)
    const candidateMultiplier = this.config.rerankCandidateMultiplier ?? 1;
    const result = await pipeline.search(query, {
      maxResults: maxResults * candidateMultiplier,
      rerank: true,
      levels: includeTopic ? ['verse', 'paragraph', 'topic'] : ['verse', 'paragraph'],
      minScore: 0.0,
      candidates: maxResults * candidateMultiplier,
    });
    detailedTimings.pipeline = Date.now() - routeStart;

    // 2. Score fusion
    const tFuse = Date.now();
    const fusedResults = fuse(result.results, 'linear', { alpha: 0.4 });
    detailedTimings.scoreFusion = Date.now() - tFuse;

    // 3. Consolidate overlapping results
    const tConsolidate = Date.now();
    const scoredResults: PipelineResult[] = fusedResults.map(r => ({ ...r, score: r.fusedScore }));
    const consolidated = consolidate<PipelineResult>(scoredResults, maxResults);
    detailedTimings.consolidation = Date.now() - tConsolidate;

    // 4. Tag reranking
    let reranked: PipelineResult[] = consolidated;
    if (includeTopic && topicEntries) {
      const tTagRerank = Date.now();
      const tagStrengths = this.fetchTagStrengths(consolidated, topicEntries, fusedResults);
      if (tagStrengths.size > 0) {
        reranked = tagRerank<PipelineResult>(consolidated, tagStrengths);
      }
      detailedTimings.tagRerank = Date.now() - tTagRerank;
    }

    // 5. Topic expansion
    let expandedResults: PipelineResult[] = reranked;
    if (includeTopic && topicEntries && topicalRepoProvider) {
      const tExpand = Date.now();
      const { topicMatches, topicVerses, nonTopicResults } = this.prefetchTopicData(
        reranked, topicEntries, topicalRepoProvider, maxResults,
      );
      if (topicMatches.length > 0) {
        expandedResults = expandTopics<PipelineResult>(
          { topicMatches, topicVerses, nonTopicResults },
          this.config.scoringConfig,
          { maxResults },
        );
      }
      detailedTimings.topicExpand = Date.now() - tExpand;
    }

    // 6. Enrich with verse text and references
    const tEnrich = Date.now();
    const enriched = expandedResults.map(r => {
      let verseText = r.text || '';
      if (bibleRepo) {
        if (r.startVerseId === r.endVerseId) {
          const verse = bibleRepo.getVerse(r.startVerseId);
          if (verse?.text) verseText = verse.text;
        } else {
          const verses = bibleRepo.getVerseRange(r.startVerseId, r.endVerseId);
          if (verses.length > 0) {
            verseText = verses.map((v: { text: string }) => v.text).join(' ');
          }
        }
      }

      const maxLen = 200;
      const snippet = verseText.length > maxLen ? verseText.slice(0, maxLen) + '...' : verseText;

      return {
        verseId: r.startVerseId,
        endVerseId: r.endVerseId,
        reference: VerseIdHelper.formatReference(r.startVerseId, r.endVerseId, bookNames),
        title: (r.startVerseId !== r.endVerseId) ? (r.title || undefined) : undefined,
        text: verseText,
        snippet,
        score: Math.round((r.fusedScore ?? r.consolidatedScore ?? r.rerankerScore) * 1000) / 1000,
        module: bibleModule,
        type: r.level,
      };
    });
    detailedTimings.enrichment = Date.now() - tEnrich;

    // 7. Filter by minimum score
    const minScore = this.config.minScore ?? 0.15;
    const filtered = enriched.filter(r => r.score >= minScore);

    // 8. Optional hybrid merge with keyword results
    let finalResults: SemanticSearchResult[] = filtered;
    if (params.hybrid && params.searchService) {
      const tKeyword = Date.now();
      const keywordResults = await this.runKeywordSearch(
        params.searchService, query, params.modules, bibleRepo, maxResults,
      );
      detailedTimings.keywordSearch = Date.now() - tKeyword;
      finalResults = SearchOrchestrationService.fuseHybridResults(filtered, keywordResults, maxResults);
    }

    detailedTimings.routeTotal = Date.now() - routeStart;

    return {
      results: finalResults,
      total: finalResults.length,
      timings: { ...result.timings, ...detailedTimings },
    };
  }

  /**
   * Fetch tag strengths for tag reranking from the enrichment DB.
   * Finds the best-matching topic and looks up per-verse strengths.
   */
  fetchTagStrengths(
    results: PipelineResult[],
    topicEntries: Map<string, SearchTopicEntry>,
    allFused: Array<RerankResult & { fusedScore: number }>,
  ): Map<number, number> {
    const strengthMap = new Map<number, number>();
    if (!this.enrichmentRepo) return strengthMap;

    // Find best-matching topic from the full fused list
    let bestTopic: SearchTopicEntry | undefined;
    let bestScore = -Infinity;
    for (const r of allFused) {
      if (r.level === 'topic' && r.startVerseId === 0 && r.endVerseId === 0) {
        for (const [, entry] of topicEntries) {
          if (r.text === entry.tagName || r.title === entry.tagName) {
            if (r.fusedScore > bestScore) {
              bestTopic = entry;
              bestScore = r.fusedScore;
            }
            break;
          }
        }
        if (bestTopic) break;
      }
    }

    if (!bestTopic || bestScore < 0.50) return strengthMap;

    const verseIds = results
      .filter(r => r.level !== 'topic')
      .map(r => r.startVerseId);
    if (verseIds.length === 0) return strengthMap;

    const tagName = bestTopic.tagName;
    const unitIds = verseIds.map(v => `v_${v}`);
    const tagTypes = ['theme', 'emotion', 'event', 'imagery'];

    try {
      let tagMatches: EnrichmentTagMatch[] = this.enrichmentRepo.getTagStrengthsForVerses(tagName, tagTypes, unitIds);

      // Fallback: try root word if exact name returned no results
      if (tagMatches.length === 0 && tagName.includes(' ')) {
        const rootWord = tagName.split(/\s+/)[0];
        tagMatches = this.enrichmentRepo.getTagStrengthsForVerses(rootWord, tagTypes, unitIds);
      }

      for (const r of tagMatches) {
        const m = r.unitId.match(/v_(\d+)/);
        if (m) strengthMap.set(parseInt(m[1], 10), r.strength);
      }
    } catch { /* ignore */ }

    return strengthMap;
  }

  /**
   * Pre-fetch topic data for topic expansion.
   * Extracts topic matches from results, fetches verse lists from DB.
   */
  prefetchTopicData<T extends RerankResult & { fusedScore?: number }>(
    results: T[],
    topicEntries: Map<string, SearchTopicEntry>,
    topicalRepoProvider: ITopicalRepoProvider,
    maxResults: number,
  ): { topicMatches: TopicMatch[]; topicVerses: Map<string, TopicVerseData[]>; nonTopicResults: T[] } {
    const topicMatches: TopicMatch[] = [];
    const nonTopicResults: T[] = [];
    const topicVerses = new Map<string, TopicVerseData[]>();
    const PER_TOPIC_LIMIT = Math.min(maxResults, 20);

    for (const r of results) {
      if (r.level === 'topic' && r.startVerseId === 0 && r.endVerseId === 0) {
        let found: SearchTopicEntry | undefined;
        for (const [, entry] of topicEntries) {
          if (r.text === entry.tagName || r.title === entry.tagName) {
            found = entry;
            break;
          }
        }
        if (found) {
          const matchId = found.embeddingId;
          topicMatches.push({
            id: matchId,
            score: (r as any).fusedScore ?? r.rerankerScore ?? r.embeddingScore,
            tagName: found.tagName,
            tagType: found.tagType,
          });
          const verses = this.fetchTopicVerses(found, topicalRepoProvider, PER_TOPIC_LIMIT);
          topicVerses.set(matchId, verses);
        } else {
          nonTopicResults.push(r);
        }
      } else {
        nonTopicResults.push(r);
      }
    }

    return { topicMatches, topicVerses, nonTopicResults };
  }

  /**
   * Fetch verse list for a single topic entry from the appropriate DB.
   */
  private fetchTopicVerses(
    entry: SearchTopicEntry,
    topicalRepoProvider: ITopicalRepoProvider,
    limit: number,
  ): TopicVerseData[] {
    const verseRows: TopicVerseData[] = [];

    if (entry.tagType === 'nave_torrey' && (entry.naveTopicId || entry.torreyTopicId)) {
      const topicId = entry.naveTopicId || entry.torreyTopicId;
      const source = entry.naveTopicId ? 'nave' : 'torrey';
      const topicalRepo = topicalRepoProvider.getTopicalRepo(source);
      if (topicalRepo && topicId) {
        try {
          const topicVerses = topicalRepo.getTopicVerses(topicId, limit);
          const rootConcept = entry.tagName.split(/\s+of\s+|\s+in\s+|\s+and\s+/i)[0].toLowerCase();
          const strengthMap = new Map<number, number>();
          if (this.enrichmentRepo && rootConcept.length > 1) {
            try {
              const tagMatches = this.enrichmentRepo.getVersesByTag(rootConcept, 'theme', 10000);
              for (const sr of tagMatches) {
                const m = sr.unitId.match(/v_(\d+)/);
                if (m) strengthMap.set(parseInt(m[1], 10), sr.strength);
              }
            } catch { /* ignore */ }
          }
          for (const tv of topicVerses) {
            for (let vid = tv.startVerseId; vid <= tv.endVerseId; vid++) {
              verseRows.push({ verseId: vid, strength: strengthMap.get(vid) ?? 0.3 });
            }
          }
        } catch { /* ignore */ }
      }
    } else if (this.enrichmentRepo) {
      try {
        const tagMatches = this.enrichmentRepo.getVersesByTag(entry.tagName, entry.tagType, limit);
        for (const r of tagMatches) {
          const m = r.unitId.match(/v_(\d+)/);
          if (m) verseRows.push({ verseId: parseInt(m[1], 10), strength: r.strength });
        }
      } catch { /* ignore */ }
    }

    return verseRows;
  }

  /**
   * Run keyword search for hybrid mode.
   */
  private async runKeywordSearch(
    searchService: ISearchService,
    query: string,
    modules: string[] | undefined,
    _bibleRepo: IBibleRepository | undefined,
    maxResults: number,
  ): Promise<SemanticSearchResult[]> {
    try {
      const terms = extractMeaningfulTerms(query);
      if (!terms) return [];
      const strictQuery = terms.map(w => `"${w}"`).join(' AND ');

      const mods = modules && modules.length > 0 ? modules : ['KJV'];
      const results = await searchService.search(strictQuery, { modules: mods, maxResults } as any);

      return results.map(r => ({
        verseId: r.verseId,
        endVerseId: r.verseId,
        reference: r.reference,
        text: r.text,
        snippet: r.snippet ?? '',
        score: r.score,
        module: r.module,
        type: 'bible',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Semantic-primary hybrid fusion: boost semantic results that also match keywords,
   * then append keyword-only results as supplemental.
   */
  static fuseHybridResults(
    semanticResults: SemanticSearchResult[],
    keywordResults: SemanticSearchResult[],
    maxResults: number,
  ): SemanticSearchResult[] {
    const keywordVerseIds = new Set(keywordResults.map(r => r.verseId));

    const KEYWORD_BOOST = 0.05;
    const boosted = semanticResults.map(r => ({
      ...r,
      score: keywordVerseIds.has(r.verseId)
        ? Math.min(1, r.score + KEYWORD_BOOST)
        : r.score,
    }));

    boosted.sort((a, b) => b.score - a.score);

    const seenVerseIds = new Set(boosted.map(r => r.verseId));

    const supplemental = keywordResults
      .filter(r => !seenVerseIds.has(r.verseId))
      .slice(0, Math.max(0, maxResults - boosted.length));

    return [...boosted, ...supplemental].slice(0, maxResults);
  }
}
