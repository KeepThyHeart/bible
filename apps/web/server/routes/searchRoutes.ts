import { Router } from 'express';
import type { DatabaseManager } from '../DatabaseManager.js';
import type { ISearchPipeline, ScoringConfig } from '@bible/core';
import { sendError, ErrorCodes } from '../utils/errorResponse.js';
import { VerseIdHelper, StrongsNumberHelper, EnrichmentRepository, SearchOrchestrationService } from '../core.js';
import type { TopicEntry } from '../search/SqliteVectorSearch.js';
import { registerRoute } from './routeRegistry.js';
import type { ServerHookRegistry } from '../plugins/ServerHooks.js';
import { validateSearchQuery, MAX_SEARCH_QUERY_LENGTH } from '../utils/validation.js';
import { createSemaphore, QueueFullError } from '../utils/semaphore.js';

/**
 * Concurrency gate for semantic search.
 *
 * Embedding and cross-encoder reranking are CPU-bound, and onnxruntime already
 * uses every core for a single request — measured, 8 concurrent embeds take the
 * same wall-clock as 8 sequential ones. Letting requests run unbounded would
 * only multiply peak RSS. A short queue absorbs bursts; past that we shed load
 * with a 503 rather than let callers wait out the 15s request timeout.
 */
const SEMANTIC_CONCURRENCY = 2;
const SEMANTIC_MAX_QUEUE = 10;

/**
 * Strong's result caps.
 *
 * The first page stays small so the panel opens fast, but the ceiling has to
 * clear the busiest numbers (H3068 "LORD" runs to ~6.5k occurrences) or "Load
 * All" could never reach the end of the list. Each result is a single indexed
 * verse fetch, so the cost is linear and bounded by the ceiling.
 */
const DEFAULT_STRONGS_PAGE_SIZE = 100;
const MAX_STRONGS_RESULTS = 5000;

export interface SearchRouteOptions {
  topicEntries?: Map<string, TopicEntry>;
  pipeline?: ISearchPipeline;
  scoringConfig?: ScoringConfig;
}

export function createSearchRoutes(db: DatabaseManager, routeOptions: SearchRouteOptions = {}, hybridDefault = false, minScoreDefault = 0.15, hooks?: ServerHookRegistry): Router {
  const router = Router();

  // Gates the expensive semantic path only; keyword/Strong's search is SQLite work.
  const semanticGate = createSemaphore({
    concurrency: SEMANTIC_CONCURRENCY,
    maxQueue: SEMANTIC_MAX_QUEUE,
  });

  // Cache book names for reference resolution (loaded once on first use)
  let bookNames: Map<number, string> | null = null;
  function getBookNames(): Map<number, string> {
    if (!bookNames) {
      bookNames = new Map();
      try {
        const books = db.getBookRepo().getAll();
        for (const b of books) bookNames.set(b.bookNumber, b.bookName);
      } catch { /* fallback to empty */ }
    }
    return bookNames;
  }

  // Lazy-initialized search orchestration service
  let orchestrationService: InstanceType<typeof SearchOrchestrationService> | null = null;
  function getOrchestrationService(): InstanceType<typeof SearchOrchestrationService> {
    if (!orchestrationService) {
      let enrichDb;
      try { enrichDb = db.getEnrichmentsDb(); } catch { /* ignore */ }
      const enrichRepo = enrichDb ? new EnrichmentRepository(enrichDb) : null;
      orchestrationService = new SearchOrchestrationService(enrichRepo, {
        scoringConfig: routeOptions.scoringConfig,
        minScore: minScoreDefault,
        hybridDefault,
      });
    }
    return orchestrationService;
  }

  // Warm up semantic search pipeline
  router.post('/semantic/warmup', async (_req, res): Promise<void> => {
    try {
      if (!routeOptions.pipeline) {
        res.json({ status: 'unavailable' });
        return;
      }
      res.json({ status: 'ready' });
    } catch {
      res.json({ status: 'error' });
    }
  });

  router.get('/keyword', async (req, res): Promise<void> => {
    try {
      const query = validateSearchQuery(req.query.q);
      if (!query) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, `Query parameter "q" is required and must be ${MAX_SEARCH_QUERY_LENGTH} characters or fewer`);
        return;
      }

      const modules = req.query.modules ? (req.query.modules as string).split(',') : undefined;
      // Item #4: Cap keyword search pageSize to prevent resource exhaustion
      const pageSize = Math.min(Number(req.query.pageSize ?? 50), 100);

      const searchService = db.getSearchService();
      if (!searchService) { sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Search not available'); return; }

      // Ensure requested modules are loaded
      if (modules) {
        for (const mod of modules) {
          const repo = db.getBibleRepo(mod);
          if (repo) searchService.addBibleModule(mod, repo);
        }
      }

      const results = await searchService.search(query, {
        modules,
        maxResults: pageSize,
      });

      // `r.type` is the core MatchType — 'exact', 'stem' or 'fuzzy'. It used to
      // be flattened to a constant 'bible' here, which left the browser unable
      // to tell an approximate spelling from a real occurrence: the results
      // list could not badge them and the distribution chart could not exclude
      // them. Pass the real type through.
      let mappedResults = results.map((r) => ({
        verseId: r.verseId,
        reference: r.reference,
        text: r.text,
        snippet: r.snippet ?? '',
        score: r.score,
        module: r.module,
        type: r.type,
      }));

      if (hooks?.hasFilters('search:results')) {
        const filtered = await hooks.applyFilters('search:results', { results: mappedResults, query });
        mappedResults = filtered.results as typeof mappedResults;
      }

      // connect-timeout has already sent a 503 if this fired; writing again
      // would throw ERR_HTTP_HEADERS_SENT into the catch below.
      if (req.timedout) return;

      res.json({
        results: mappedResults,
        total: mappedResults.length,
      });

      hooks?.fireActions('search:performed', { query, resultCount: mappedResults.length });
    } catch (error) {
      console.error('Error performing search:', error);
      if (!res.headersSent) sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Search failed');
    }
  });

  router.get('/semantic', async (req, res): Promise<void> => {
    try {
      const query = validateSearchQuery(req.query.q);
      if (!query) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, `Query parameter "q" is required and must be ${MAX_SEARCH_QUERY_LENGTH} characters or fewer`);
        return;
      }

      // Item #4: Cap semantic search maxResults to prevent resource exhaustion
      const maxResults = Math.min(Number(req.query.maxResults ?? 20), 50);
      const hybrid = req.query.hybrid !== undefined
        ? (req.query.hybrid === '1' || req.query.hybrid === 'true')
        : hybridDefault;
      const modules = req.query.modules ? (req.query.modules as string).split(',') : undefined;

      const pipeline = routeOptions.pipeline;
      if (!pipeline) {
        res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Semantic search not available' }, results: [], total: 0 });
        return;
      }

      // Ensure requested modules are loaded for hybrid search
      const searchService = db.getSearchService();
      if (hybrid && searchService && modules) {
        for (const mod of modules) {
          const repo = db.getBibleRepo(mod);
          if (repo) searchService.addBibleModule(mod, repo);
        }
      }

      // Which translation the matched verses are *shown* in. The embeddings are
      // KJV-derived and stay that way, so matching is unaffected — but the text
      // rendered for a hit should be the translation the reader is actually in.
      // A result labelled KJV while the reader is reading WEBBE is simply wrong.
      const requestedModule = modules?.[0];
      const requestedRepo = requestedModule ? db.getBibleRepo(requestedModule) : null;
      const hydrationRepo = requestedRepo ?? db.getBibleRepo('KJV');
      const hydrationModule = requestedRepo && requestedModule
        ? db.resolveAbbreviation(requestedModule)
        : 'KJV';

      let result;
      try {
        result = await semanticGate.run(async () => {
          // Shed work for requests that timed out while queued — connect-timeout
          // has already responded, so there is nobody left to answer.
          if (req.timedout) return null;

          return getOrchestrationService().semanticSearch({
            query,
            maxResults,
            hybrid,
            modules,
            pipeline,
            topicEntries: routeOptions.topicEntries,
            bibleRepo: hydrationRepo ?? undefined,
            bibleModule: hydrationModule,
            bookNames: getBookNames(),
            searchService: hybrid ? searchService ?? undefined : undefined,
            topicalRepoProvider: db,
          });
        });
      } catch (err) {
        if (err instanceof QueueFullError) {
          res.setHeader('Retry-After', '5');
          res.status(503).json({
            error: { code: 'SERVICE_BUSY', message: 'Search is busy, please retry shortly' },
            results: [],
            total: 0,
          });
          return;
        }
        throw err;
      }

      if (result === null || req.timedout) return;

      // Log detailed breakdown
      const t = result.timings;
      console.log(`[SemanticSearch] "${query}" — Pipeline: ${t.pipeline}ms (embed: ${t.embed}ms, vecSearch: ${t.vectorSearch}ms, rerank: ${t.rerank ?? 0}ms) | ScoreFusion: ${t.scoreFusion}ms | Consolidation: ${t.consolidation}ms | TagRerank: ${t.tagRerank ?? 0}ms | TopicExpand: ${t.topicExpand ?? 0}ms | Enrichment: ${t.enrichment}ms | KeywordSearch: ${t.keywordSearch ?? 0}ms | Route total: ${t.routeTotal}ms | Results: ${result.total}`);

      res.json(result);

      hooks?.fireActions('search:performed', { query, resultCount: result.total });
    } catch (error: any) {
      console.error('Error performing semantic search:', error?.message || error, error?.stack);
      if (!res.headersSent) sendError(res, 500, ErrorCodes.INTERNAL_ERROR, `Semantic search failed: ${error?.message}`);
    }
  });

  // ========================================================================
  // Strong's Number Search
  // ========================================================================

  router.get('/strongs', async (req, res): Promise<void> => {
    try {
      const number = req.query.number as string;
      if (!number) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, 'Query parameter "number" is required (e.g., G25, H7225)');
        return;
      }

      const parsed = StrongsNumberHelper.parse(number);
      if (!parsed) {
        sendError(res, 400, ErrorCodes.INVALID_PARAM, `Invalid Strong's number: ${number}`);
        return;
      }

      const includeRelated = req.query.includeRelated === 'true' || req.query.includeRelated === '1';
      const modules = req.query.modules ? (req.query.modules as string).split(',') : undefined;
      const scope = req.query.scope ? Number(req.query.scope) : undefined;
      const scopeBook = scope && scope >= 1 && scope <= 66 ? scope : undefined;

      const wordFamilyService = db.getWordFamilyService();
      const searchService = db.getSearchService();
      if (!searchService) {
        sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Search not available');
        return;
      }

      if (wordFamilyService) {
        searchService.setWordFamilyService(wordFamilyService);
      }

      if (modules) {
        for (const mod of modules) {
          const repo = db.getBibleRepo(mod);
          if (repo) searchService.addBibleModule(mod, repo);
        }
      }

      // Item #4: Cap Strong's search maxResults to prevent resource exhaustion.
      // Garbage or negative input falls back to the first-page default rather
      // than propagating NaN into the query.
      const requestedMax = Number(req.query.maxResults ?? DEFAULT_STRONGS_PAGE_SIZE);
      const maxResults = Number.isFinite(requestedMax) && requestedMax > 0
        ? Math.min(Math.floor(requestedMax), MAX_STRONGS_RESULTS)
        : DEFAULT_STRONGS_PAGE_SIZE;

      const searchOptions: Record<string, unknown> = {
        modules,
        maxResults,
        includeRelatedWords: includeRelated,
      };

      if (scopeBook) {
        searchOptions.range = { startBook: scopeBook, endBook: scopeBook };
      }

      const displayNum = StrongsNumberHelper.toDisplayFormat(number)!;
      const results = await searchService.search(displayNum, searchOptions as any);

      let wordFamily: Array<Record<string, unknown>> = [];
      let entry: Record<string, unknown> | null = null;
      const groupedCounts: Record<string, number> = {};

      if (wordFamilyService) {
        const family = wordFamilyService.getWordFamily(displayNum);
        if (family) {
          entry = {
            strongsNumber: family.primary.strongsNumber,
            word: family.primary.word ?? '',
            transliteration: family.primary.transliteration ?? '',
            gloss: family.primary.gloss,
          };

          wordFamily = family.members
            .filter(m => m.strongsNumber !== displayNum)
            .map(m => ({
              strongsNumber: m.strongsNumber,
              word: m.word ?? '',
              transliteration: m.transliteration ?? '',
              gloss: m.gloss,
              relationship: m.relationship,
            }));

          const kjvRepo = db.getBibleRepo('KJV');
          if (kjvRepo) {
            for (const member of family.members) {
              const variants = StrongsNumberHelper.toInterlinearVariants(member.strongsNumber);
              const verseIds = kjvRepo.searchByStrongsNumber(variants);
              groupedCounts[member.strongsNumber] = verseIds.length;
            }
          }
        }
      }

      // `total` only ever reports the capped page, so the client cannot tell from
      // it whether more occurrences exist. Count them straight from the
      // interlinear index — the same lookup groupedCounts uses, minus the cap.
      const numbersToCount = [displayNum];
      if (includeRelated && wordFamilyService) {
        numbersToCount.push(...wordFamilyService.getRelatedNumbers(displayNum));
      }
      // Summed per module per number without de-duplication, exactly the way
      // BibleSearchService assembles its result list, so that
      // `results.length < totalAvailable` means "the cap truncated something".
      let occurrences = 0;
      for (const abbr of modules && modules.length > 0 ? modules : ['KJV']) {
        const repo = db.getBibleRepo(abbr);
        if (!repo) continue;
        for (const num of numbersToCount) {
          const variants = StrongsNumberHelper.toInterlinearVariants(num);
          if (variants.length === 0) continue;
          const verseIds = repo.searchByStrongsNumber(variants);
          occurrences += scopeBook
            ? verseIds.filter(id => VerseIdHelper.parse(id).bookNumber === scopeBook).length
            : verseIds.length;
        }
      }
      // A search with no explicit modules spans every loaded Bible, which the
      // count above cannot see; never claim fewer occurrences than we returned.
      const totalAvailable = Math.max(occurrences, results.length);

      if (req.timedout) return;

      res.json({
        entry,
        wordFamily,
        // Same as /keyword: the real MatchType, not a constant 'bible'.
        results: results.map(r => ({
          verseId: r.verseId,
          reference: r.reference,
          text: r.text,
          snippet: r.snippet ?? '',
          score: r.score,
          module: r.module,
          type: r.type,
        })),
        total: results.length,
        totalAvailable,
        groupedCounts,
      });
    } catch (error: any) {
      console.error('Error performing Strong\'s search:', error?.message || error);
      if (!res.headersSent) sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Strong\'s search failed');
    }
  });

  return router;
}

registerRoute({
  path: '/api/search',
  createRoutes: (deps) => createSearchRoutes(
    deps.db,
    deps.extra.searchRouteOptions as SearchRouteOptions,
    deps.extra.hybridDefault as boolean ?? false,
    deps.extra.minScoreDefault as number ?? 0.15,
    deps.extra.hooks as ServerHookRegistry,
  ),
});
