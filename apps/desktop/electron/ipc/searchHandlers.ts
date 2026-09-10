import { IpcMain } from 'electron';
import log from 'electron-log';
import { ipcHandler, IpcKnownError } from './handler-helper';
import { SqliteProvider } from '../providers/SqliteProvider';
import { initializeSearchSchema } from '../schema/searchSchema';
import { BibleRepository, BibleSearchRepository, BibleSearchService, SearchController, SemanticSearchService, WordFamilyService, formatVerseText, highlightSearchTerms, clampSearchQuery } from '@bible/core';
import { getBibleRepository } from './bibleHandlers';
import { getDictionaryRepository } from './dictionaryHandlers';
import { validateString, validatePositiveInt } from '../utils/validation';
import { getSharedMainDb, getSharedModuleMetadataRepo, getSharedBookRepo } from '../services/sharedMainDb';
import { getModuleDatabaseRegistry } from '../services/ModuleDatabaseRegistry';
import { resolveSemanticIndexPath, resolveSemanticModelsPath } from '../utils/appPaths';
import { pickDefaultBible } from './defaultBible';
import {
  resolveSearchScope,
  applySearchHighlighting as applyHighlighting,
  formatSemanticReference,
} from './searchHelpers';

// Database connections (singleton)
let bibleDb: SqliteProvider | null = null;
let searchRepo: BibleSearchRepository | null = null;
let bibleRepo: BibleRepository | null = null;
/** The Bible `bibleRepo` belongs to - the app's default, not necessarily KJV. */
let searchBibleAbbreviation: string | null = null;
let searchService: BibleSearchService | null = null;
let searchController: SearchController | null = null;

// Semantic search
let semanticDb: SqliteProvider | null = null;
let semanticSearchService: SemanticSearchService | null = null;
let semanticEmbedder: any = null;
let semanticEmbedderLoading: Promise<any> | null = null;
/**
 * Path the currently-open index was loaded from. Needed at reset time because
 * the connection is owned by the ModuleDatabaseRegistry, which is keyed by
 * path - closing our local handle alone would leave the registry's cached
 * entry (and on Windows, a lock on a file the installer is about to replace).
 */
let semanticDbPathInUse: string | null = null;

function initializeSearchServices(): void {
  if (!searchRepo) {
    log.info('Initializing search services with shared main.db');

    try {
      const mainDb = getSharedMainDb();

      // Run migrations for search tables
      runSearchMigrations(mainDb);

      searchRepo = new BibleSearchRepository(mainDb);

      log.info('Search repository initialized successfully');
    } catch (error) {
      log.error('Failed to initialize search repository:', error);
    }
  }

  if (!bibleDb) {
    // Whichever Bible the app defaults to, chosen from what is installed. This
    // used to open `bible_kjv.db` by name, so an install without KJV left
    // search switched off entirely - every query failed with "not
    // initialized" - and logged a missing database on every start.
    //
    // Opened by abbreviation through the shared registry, which resolves the
    // installed path (userData before the bundled tree) and hands back the
    // same connection bibleHandlers/studyHandlers use for this module.
    const installedBibles = getSharedModuleMetadataRepo().getByType('bible')
      .map(m => ({ abbreviation: m.abbreviation || m.getAbbreviation() }));
    const abbreviation = pickDefaultBible(installedBibles);

    if (!abbreviation) {
      log.info('No Bible installed; search will initialize once one is');
    } else {
      log.info('Initializing Bible repository for search:', abbreviation);
      try {
        bibleDb = getModuleDatabaseRegistry().openByAbbreviation(abbreviation, 'bible');
        if (bibleDb) {
          bibleRepo = new BibleRepository(bibleDb);
          searchBibleAbbreviation = abbreviation;
          log.info('Bible repository for search initialized successfully');
        } else {
          log.error('Bible database not found for search:', abbreviation);
        }
      } catch (error) {
        log.error('Failed to initialize Bible repository:', error);
      }
    }
  }

  // Initialize search service and controller
  if (searchRepo && bibleRepo && searchBibleAbbreviation && !searchController) {
    const bookRepo = getSharedBookRepo();
    const bibleModules = new Map();
    bibleModules.set(searchBibleAbbreviation, bibleRepo);

    searchService = new BibleSearchService(bibleModules, bookRepo);
    searchController = new SearchController(searchService, searchRepo);

    // Wire the WordFamilyService so Strong's searches with `includeRelatedWords`
    // can expand across the word family (G25 -> G26, G27, ...).
    try {
      const allModules = getSharedModuleMetadataRepo().getAll();
      let greekDict = null;
      let hebrewDict = null;
      for (const m of allModules) {
        if (m.moduleType !== 'dictionary' || !m.abbreviation) continue;
        const abbr = m.abbreviation.toLowerCase();
        if (!greekDict && /strong.*greek|greek.*strong/.test(abbr)) {
          greekDict = getDictionaryRepository(m.abbreviation);
        }
        if (!hebrewDict && /strong.*hebrew|hebrew.*strong/.test(abbr)) {
          hebrewDict = getDictionaryRepository(m.abbreviation);
        }
      }
      if (greekDict || hebrewDict) {
        const wordFamily = new WordFamilyService(greekDict, hebrewDict);
        searchService.setWordFamilyService(wordFamily);
        log.info(`WordFamilyService wired (greek=${greekDict ? 'yes' : 'no'}, hebrew=${hebrewDict ? 'yes' : 'no'})`);
      }
    } catch (err) {
      log.warn('Failed to wire WordFamilyService:', err);
    }

    log.info('Search service and controller initialized successfully');
  }
}

function runSearchMigrations(db: SqliteProvider): void {
  try {
    log.info('Running search table migrations...');
    initializeSearchSchema(db);
    log.info('✓ Search tables initialized');
  } catch (error) {
    log.error('Error running search migrations:', error);
    throw error;
  }
}

/**
 * Apply search term highlighting to formatted HTML
 * Wraps matched terms with <strong><u>term</u></strong> tags
 */
function applySearchHighlighting(html: string, matches: Array<{ term: string }>): string {
  return applyHighlighting(html, matches, highlightSearchTerms);
}

export function registerSearchHandlers(_ipcMain: IpcMain): void {
  // Initialize services
  initializeSearchServices();

  // Handler: Perform search
  ipcHandler<[string, any], any[]>('search:performSearch', async (query, options) => {
    validateString(query, 'search query', 1000);
    // A Bible installed after startup is picked up on the first search that
    // needs it, rather than leaving search off until the app restarts.
    if (!searchController) {
      initializeSearchServices();
    }
    if (!searchController || !searchService) {
      throw new IpcKnownError('unavailable', 'Search controller not initialized');
    }

    log.info('Performing search:', query, options);

    // Handle scope-based module selection. The decision is in `searchHelpers`
    // so it can be unit-tested; the side effects stay here.
    const needsModuleList = options.scope === 'allOpenModules'
      || options.scope === 'allBibles'
      || options.scope === 'allModules';
    const scoped = resolveSearchScope(
      options.scope,
      options.openModules,
      needsModuleList ? getSharedModuleMetadataRepo().getAll() : [],
    );

    // Every module the scope resolved to has to be registered with the search
    // service before it can be searched.
    for (const moduleAbbr of scoped.modulesToRegister) {
      const repo = getBibleRepository(moduleAbbr);
      if (repo && searchService) {
        searchService.addBibleModule(moduleAbbr, repo);
      }
    }

    const modulesToSearch: string[] | undefined = scoped.modules ?? options.modules;
    if (scoped.commentaryModules !== null) {
      options.commentaryModules = scoped.commentaryModules;
    }
    if (scoped.modules) {
      log.info(`Searching Bible modules (${options.scope}): ${scoped.modules.join(', ')}`);
    }
    if (scoped.commentaryModules) {
      log.info(`Searching Commentary modules: ${scoped.commentaryModules.join(', ')}`);
    }

    // Update options with resolved modules
    const searchOptions = {
      ...options,
      modules: modulesToSearch
    };

    const results = await searchController.performSearch(query, searchOptions);
    log.info(`Search completed successfully: ${results.length} results`);

    // Apply verse formatting to search results (for Words of Christ, etc.)
    const formattedResults = results.map(result => {
      try {
        // Check if this is a multi-verse result
        const isMultiVerse = result.verseIds && result.verseIds.length > 1;

        if (isMultiVerse) {
          // Multi-verse result: text and snippet already have highlighting from BibleSearchService
          // Don't overwrite them - just return the result as-is
          log.info(`Multi-verse result: ${result.reference} (${result.verseIds!.length} verses)`);
          return result;
        }

        // Single-verse result: apply formatting (Words of Christ, etc.) and highlighting
        const repo = getBibleRepository(result.module);
        if (repo) {
          // Fetch the full verse to get formatting_data
          const verse = repo.getVerse(result.verseId);
          if (verse) {
            // Apply formatting (Words of Christ, paragraph markers, etc.)
            const { textHtml } = formatVerseText(verse);

            // Apply search term highlighting to the formatted HTML
            const highlightedText = applySearchHighlighting(textHtml, result.matches);

            // Update the result's text with highlighted formatted HTML
            // Preserve the original snippet (already highlighted by BibleSearchService)
            return {
              ...result,
              text: highlightedText,
              snippet: result.snippet
            };
          }
        }
      } catch (formatError) {
        log.error(`Error formatting search result for verse ${result.verseId}:`, formatError);
      }
      // Return original result if formatting fails
      return result;
    });

    // Search commentary modules if any are specified
    let commentaryResults: any[] = [];
    if (options.commentaryModules && options.commentaryModules.length > 0) {
      const { searchCommentaryModules } = await import('./commentaryHandlers');
      commentaryResults = await searchCommentaryModules(query, options.commentaryModules);
      log.info(`Commentary search completed: ${commentaryResults.length} results`);
    }

    // Combine Bible and Commentary results
    return [...formattedResults, ...commentaryResults];
  });

  // Handler: Get saved searches
  ipcHandler<[], any[]>('search:getSavedSearches', () => {
    if (!searchController) {
      throw new IpcKnownError('unavailable', 'Search controller not initialized');
    }

    const searches = searchController.getSavedSearches();
    return searches.map(s => s.toJSON());
  });

  // Handler: Save search
  ipcHandler<[string, string, string, any, any], any>(
    'search:saveSearch',
    (name, query, _searchType, scope, options) => {
      validateString(name, 'search name', 200);
      validateString(query, 'search query', 1000);
      if (!searchController) {
        throw new IpcKnownError('unavailable', 'Search controller not initialized');
      }

      // Temporarily set the query in the controller
      searchController['currentQuery'] = query;

      const savedSearch = searchController.saveCurrentSearch(name, {
        ...options,
        scope: scope.scope,
        modules: scope.modules,
        range: scope.range,
      });

      return savedSearch.toJSON();
    }
  );

  // Handler: Load saved search
  ipcHandler<[number], any>('search:loadSavedSearch', (searchId) => {
    validatePositiveInt(searchId, 'searchId');
    if (!searchController) {
      throw new IpcKnownError('unavailable', 'Search controller not initialized');
    }

    const result = searchController.loadSavedSearch(searchId);
    if (!result) {
      throw new IpcKnownError('not_found', `Saved search ${searchId} not found`);
    }
    return result;
  });

  // Handler: Delete saved search
  ipcHandler<[number], boolean>('search:deleteSavedSearch', (searchId) => {
    validatePositiveInt(searchId, 'searchId');
    if (!searchController) {
      throw new IpcKnownError('unavailable', 'Search controller not initialized');
    }

    return searchController.deleteSavedSearch(searchId);
  });

  // Handler: Get index status
  ipcHandler<[string[]], Record<string, any>>('search:getIndexStatus', async (modules) => {
    if (!searchController) {
      throw new IpcKnownError('unavailable', 'Search controller not initialized');
    }

    const status = await searchController.getIndexStatus(modules);

    // Convert Map to object for serialization
    const result: Record<string, any> = {};
    for (const [key, value] of status) {
      result[key] = value;
    }

    return result;
  });

  // Handler: Build index
  ipcHandler<[string[], ((progress: any) => void)?], void>(
    'search:buildIndex',
    async (modules, _onProgress) => {
    if (!searchController || !searchService) {
      throw new IpcKnownError('unavailable', 'Search controller not initialized');
    }

    // Ensure each module is loaded into the search service before indexing
    for (const moduleAbbr of modules) {
      const repo = getBibleRepository(moduleAbbr);
      if (repo) {
        searchService.addBibleModule(moduleAbbr, repo);
      }
    }

    // Note: Progress callbacks don't work well over IPC
    // Would need to use IPC events to send progress updates
    await searchController.buildIndex(modules);

    // Mark each module as indexed in module_metadata table
    for (const moduleAbbr of modules) {
      const moduleMetadata = getSharedModuleMetadataRepo().getByAbbreviation(moduleAbbr);
      if (moduleMetadata && moduleMetadata.moduleId) {
        getSharedModuleMetadataRepo().markAsIndexed(moduleMetadata.moduleId);
        log.info(`Marked module ${moduleAbbr} (ID: ${moduleMetadata.moduleId}) as indexed`);
      }
    }
  }
  );

  // Handler: Get book-level index status for a specific module
  ipcHandler<[string], Array<{ bookNumber: number; bookName: string; isIndexed: boolean }>>(
    'search:getBookIndexStatus',
    (_moduleAbbr) => {
      const sharedBookRepo = getSharedBookRepo();
      if (!bibleRepo || !sharedBookRepo) {
        throw new IpcKnownError('unavailable', 'Bible or book repository not initialized');
      }

      const bookStatus: Array<{ bookNumber: number; bookName: string; isIndexed: boolean }> = [];

      // Check each of the 66 books
      for (let bookNumber = 1; bookNumber <= 66; bookNumber++) {
        const bookInfo = sharedBookRepo.getByBookNumber(bookNumber);
        const isIndexed = bibleRepo.isBookIndexed(bookNumber);

        bookStatus.push({
          bookNumber,
          bookName: bookInfo?.bookName || `Book ${bookNumber}`,
          isIndexed
        });
      }

      return bookStatus;
    }
  );

  // ===========================================================================
  // Semantic Search Handlers
  // ===========================================================================

  // Handler: Check if semantic search is available
  ipcHandler<[], boolean>('search:semanticAvailable', () => {
    initializeSemanticSearch();
    return semanticSearchService?.isAvailable() ?? false;
  });


  // Handler: Perform semantic search
  ipcHandler<[string, ({ maxResults?: number; levels?: string[] })?], any[]>(
    'search:semanticSearch',
    async (query, options) => {
    validateString(query, 'search query', 1000);
    initializeSemanticSearch();

    if (!semanticSearchService || !semanticSearchService.isAvailable()) {
      throw new IpcKnownError(
        'unavailable',
        'Semantic search index not available. Install the semantic search pack from Module Manager -> Features.'
      );
    }

    // Get query embedding
    const queryEmbedding = await getQueryEmbedding(query);
    if (!queryEmbedding) {
      throw new Error('Failed to generate query embedding');
    }

    // Search
    const results = semanticSearchService.search(queryEmbedding, {
      maxResults: options?.maxResults ?? 20,
      levels: (options?.levels ?? ['verse', 'paragraph']) as Array<'verse' | 'paragraph' | 'chapter'>,
      minSimilarity: 0.3,
    });

    // Resolve references using book repo
    const bookRepo = getSharedBookRepo();
    const bookName = (bookNumber: number): string =>
      bookRepo.getByBookNumber(bookNumber)?.bookName || `Book ${bookNumber}`;

    const resolvedResults = results.map(r => {
      const reference = formatSemanticReference(r.startVerseId, r.endVerseId, bookName);

      // Get full text from the search Bible for verse-level results
      let fullText = r.textPreview;
      if (r.level === 'verse' && bibleRepo) {
        const verse = bibleRepo.getVerse(r.startVerseId);
        if (verse) {
          const { textHtml } = formatVerseText(verse);
          fullText = textHtml;
        }
      }

      return {
        id: r.id,
        level: r.level,
        startVerseId: r.startVerseId,
        endVerseId: r.endVerseId,
        reference,
        text: fullText,
        textPreview: r.textPreview,
        similarity: Math.round(r.similarity * 1000) / 1000,
      };
    });

    return resolvedResults;
  }
  );
}

// ===========================================================================
// Semantic Search Helpers
// ===========================================================================

function initializeSemanticSearch(): void {
  if (semanticSearchService) return;

  // Resolved rather than hard-coded: semantic search is an optional feature
  // pack, so the index normally lives under the user-writable pack root and
  // only falls back to a bundled copy. Returns null when nothing is installed.
  const semanticDbPath = resolveSemanticIndexPath();

  if (!semanticDbPath) {
    log.info('[SemanticSearch] No semantic index installed');
    return;
  }

  try {
    semanticDb = getModuleDatabaseRegistry().openByPath(semanticDbPath);
    semanticDbPathInUse = semanticDbPath;
    if (!semanticDb) {
      log.info('[SemanticSearch] Index could not be opened at:', semanticDbPath);
      return;
    }
    semanticSearchService = new SemanticSearchService(semanticDb);

    // Pre-load embeddings for fast search
    if (semanticSearchService.isAvailable()) {
      semanticSearchService.loadEmbeddings();
      const stats = semanticSearchService.getStats();
      log.info(`[SemanticSearch] Initialized: ${stats.total} embeddings (${stats.verses} verses, ${stats.paragraphs} paragraphs, ${stats.chapters} chapters)`);
    } else {
      log.info('[SemanticSearch] Index exists but has no data');
    }
  } catch (error) {
    log.error('[SemanticSearch] Failed to initialize:', error);
  }
}

/**
 * Drop every cached semantic-search resource so the next query re-resolves the
 * index and model from disk.
 *
 * Called by the feature-pack installer on both sides of an install and before
 * an uninstall. Two things make this necessary rather than nice-to-have:
 *
 *   1. `initializeSemanticSearch` early-returns forever once the service
 *      exists, so without a reset a freshly installed pack would stay invisible
 *      until the app restarted.
 *   2. The index is an open SQLite handle held by the ModuleDatabaseRegistry.
 *      Windows refuses to rename or delete an open file, so the install swap
 *      and the uninstall both fail with EBUSY unless it is closed first.
 *
 * The embedder is released too: it holds the ONNX session for a model file that
 * is about to be replaced, and it is the single largest resident allocation in
 * the main process.
 */
export function resetSemanticSearch(): void {
  if (semanticSearchService) {
    semanticSearchService.unloadEmbeddings();
    semanticSearchService = null;
  }

  if (semanticDbPathInUse) {
    // Evict from the registry, which owns the connection; a bare
    // `semanticDb.close()` would leave the registry handing the closed
    // provider back to the next caller.
    getModuleDatabaseRegistry().close(semanticDbPathInUse);
    semanticDbPathInUse = null;
  }
  semanticDb = null;

  semanticEmbedder = null;
  semanticEmbedderLoading = null;

  log.info('[SemanticSearch] Cached index and embedder released');
}

async function getQueryEmbedding(query: string): Promise<Float32Array | null> {
  try {
    // Lazy-load the embedder
    if (!semanticEmbedder) {
      if (!semanticEmbedderLoading) {
        semanticEmbedderLoading = (async () => {
          log.info('[SemanticSearch] Loading embedding model...');
          const { pipeline, env } = await import('@huggingface/transformers');
          // Never fetch the embedding model from the network: no
          // build - packaged, dev, or e2e - is allowed to reach out to
          // huggingface. The model arrives with the semantic feature pack (or,
          // in a build that bundles one, under resources/data/models); point
          // transformers at whichever copy is installed and fail closed if
          // there is none rather than silently falling back to a remote fetch.
          const modelsPath = resolveSemanticModelsPath();
          if (!modelsPath) {
            throw new IpcKnownError(
              'unavailable',
              'The semantic search embedding model is not installed. Install the Semantic Search pack from the Module Manager.'
            );
          }
          env.allowRemoteModels = false;
          env.localModelPath = modelsPath;
          semanticEmbedder = await pipeline('feature-extraction', 'Xenova/nomic-embed-text-v1', {
            dtype: 'fp32' as any,
          });
          log.info('[SemanticSearch] Embedding model loaded.');
          return semanticEmbedder;
        })();
      }
      try {
        semanticEmbedder = await semanticEmbedderLoading;
      } finally {
        // Cleared on failure as well as success. Caching the rejected promise
        // would make every later query await the same rejection, so a user who
        // installed the pack after hitting this error would have to restart the
        // app before search would work.
        semanticEmbedderLoading = null;
      }
    }

    // nomic-embed-text uses 'search_query: ' prefix for queries.
    // Clamped because attention is O(n^2) and the tokenizer's own bound is 8192
    // tokens - an unclamped long query costs seconds of CPU and gigabytes of
    // transient RSS. See MAX_SEARCH_QUERY_CHARS in @bible/core.
    const output = await semanticEmbedder('search_query: ' + clampSearchQuery(query), { pooling: 'mean', normalize: true });

    // Extract the embedding from the Tensor
    const dims = output.dims;
    if (dims.length === 2) {
      const hiddenSize = dims[1];
      return new Float32Array(output.data.slice(0, hiddenSize));
    } else if (dims.length === 3) {
      // Mean pool manually
      const seqLen = dims[1];
      const hiddenSize = dims[2];
      const embedding = new Float32Array(hiddenSize);
      for (let s = 0; s < seqLen; s++) {
        for (let h = 0; h < hiddenSize; h++) {
          embedding[h] += output.data[s * hiddenSize + h];
        }
      }
      for (let h = 0; h < hiddenSize; h++) {
        embedding[h] /= seqLen;
      }
      // L2 normalize
      let norm = 0;
      for (let h = 0; h < hiddenSize; h++) {
        norm += embedding[h] * embedding[h];
      }
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let h = 0; h < hiddenSize; h++) {
          embedding[h] /= norm;
        }
      }
      return embedding;
    }

    log.error('[SemanticSearch] Unexpected output dims:', dims);
    return null;
  } catch (error) {
    // A classified error carries a message written for the user ("install the
    // Semantic Search pack"), so it is re-thrown rather than flattened into the
    // caller's generic "failed to generate query embedding".
    if (error instanceof IpcKnownError) {
      throw error;
    }
    log.error('[SemanticSearch] Error generating query embedding:', error);
    return null;
  }
}

// Clean up on app quit
export function closeSearchDb(): void {
  if (bibleDb) {
    bibleDb.close();
    bibleDb = null;
  }

  if (semanticDb) {
    semanticSearchService?.unloadEmbeddings();
    semanticDb.close();
    semanticDb = null;
    semanticDbPathInUse = null;
    semanticSearchService = null;
  }

  searchRepo = null;
  bibleRepo = null;
  searchBibleAbbreviation = null;
  searchService = null;
  searchController = null;
  semanticEmbedder = null;
  semanticEmbedderLoading = null;
}
