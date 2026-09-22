import { ISearchService } from './ISearchService';
import { SearchQueryParser } from './SearchQueryParser';
import { compileKeywordQuery } from '../Data/Access/Fts5/Fts5QueryCompiler';
import { InModuleFts5Provider } from '../Data/Access/Fts5/InModuleFts5Provider';
import { Fts5Highlighter } from '../Data/Access/Fts5/Fts5Highlighter';
import {
  KeywordIndexRegistry,
  indexTargetKey,
  IndexTarget,
  KeywordQuery,
  KeywordSearchResponse,
  RuntimeEnvironment,
} from '../Data/Access';
import { KeywordCapability } from '../Data/Access/Capabilities';
import { IBibleRepository } from '../Data/Repositories/IBibleRepository';
import { IBibleBookRepository } from '../Data/Repositories/IBibleBookRepository';
import { SearchResult, SearchOptions, ParsedQuery, Match, MatchType, BooleanExpression, BibleRange } from '../types/search';
import { VerseId, VerseIdHelper } from '../Data/Core/Types';
import { StrongsNumberHelper } from '../Data/Core/StrongsNumberHelper';
import { isReadOnlyDatabaseError } from '../Data/Core/Errors';
import { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { WordFamilyService, WordFamilyMember } from './WordFamilyService';
import { ENGLISH_STOP_WORDS } from './Search/StopWords';

/**
 * Bible Search Service
 *
 * Comprehensive search implementation using SQLite FTS5.
 * Supports all search types: multi-word, phrase, proximity, boolean, fuzzy, regex, Strong's.
 *
 * Key features:
 * - Auto-indexing for proximity searches
 * - Result highlighting with match positions
 * - Deduplication across modules
 * - Auto-fuzzy fallback when < 10 results
 *
 * Note: this service does not record what users search for. Query logging was
 * removed for privacy, and with it the last reason the service held an
 * IBibleSearchRepository -- saved searches are the SearchController's business,
 * not this one's.
 */
export class BibleSearchService implements ISearchService {
  private parser: SearchQueryParser;
  private wordFamilyService: WordFamilyService | null = null;

  // -- Keyword-index registry wiring (task 0026, revision 2, subtask M3) ---
  //
  // See `indexTargetFor()` / `registerModuleWithProvider()` below for the
  // full explanation of the IndexTarget <-> moduleAbbr <-> repo bridge this
  // service builds. Short version: `searchMultiWord`, `searchPhrase`,
  // `searchVerseProximity` and `searchBoolean` now go through
  // `keywordIndexRegistry.search()` instead of calling each module's
  // repository directly in a loop; `fts5Provider` is the (currently only)
  // provider registered with it, wrapping today's `bible_verse_fts` tables
  // unchanged. `searchProximity` (the book-level `~Nw` word-proximity path,
  // over the SEPARATE `book_search_index` derived cache) deliberately does
  // NOT go through the registry in this pass - see that method's comment.
  private readonly keywordIndexRegistry: KeywordIndexRegistry;
  private readonly fts5Provider: InModuleFts5Provider;
  /**
   * `IndexTarget` key (`indexTargetKey()`) -> moduleAbbr. The reverse of
   * what `fts5Provider` tracks (target -> repo): a `KeywordHit` carries only
   * a `target`, not an abbreviation, but `SearchResult.module` and the repo
   * lookups the search methods still need (to fetch full verse data) both
   * speak `moduleAbbr`. Kept here, not on the provider, so the provider
   * stays generic - it has no reason to know "moduleAbbr" is a concept.
   */
  private readonly targetKeyToAbbr = new Map<string, string>();
  /**
   * One {@link Fts5Highlighter} per module abbreviation, created lazily and
   * reused for the life of this service (F7, task 0027 revision 2). See
   * `highlighterFor()`.
   */
  private readonly highlighters = new Map<string, Fts5Highlighter>();
  /**
   * Targets skipped by the most recently completed `search()` call (task
   * 0026 subtask M3). `search()`'s public return type is unchanged in this
   * pass - `SearchResult[]`, same as always; surfacing capability to the UI
   * is M9's job - so this is the escape hatch for a caller that wants to
   * know what got skipped rather than it vanishing unremarked. Also logged
   * via `console.warn` as each one is observed; see `reportSkippedTargets()`.
   * Reset at the top of every `search()` call and accumulated across every
   * keyword-index call that one `search()` makes (multi-word/phrase/etc.,
   * the character-variant retry, and the auto-fuzzy supplement).
   */
  private lastSkippedTargets: KeywordSearchResponse['skipped'] = [];

  constructor(
    private bibleModules: Map<string, IBibleRepository>,
    private bibleBookRepo: IBibleBookRepository
  ) {
    this.parser = new SearchQueryParser();

    // `RuntimeEnvironment` is part of the `IKeywordIndexProvider.supports()`
    // signature (M1), but `InModuleFts5Provider.supports()` does not
    // currently look at it - see that class's doc comment: for this pass,
    // "supported" means "registered with this provider instance", full
    // stop. This value is therefore a valid-but-unused placeholder until a
    // later subtask (M11) threads a real environment down from wherever the
    // app composes its data-access layer.
    const env: RuntimeEnvironment = {
      runtime: 'node-server',
      sqlite: { fts5: true, writableModules: false },
      codecs: new Set(),
      indexDir: null,
    };
    this.keywordIndexRegistry = new KeywordIndexRegistry(env);
    this.fts5Provider = new InModuleFts5Provider();
    this.keywordIndexRegistry.register(this.fts5Provider);

    // Modules passed in through the constructor need registering with the
    // provider exactly like a module added later through addBibleModule()
    // does - route both through the same helper instead of duplicating the
    // registration logic.
    for (const [abbreviation, repository] of this.bibleModules) {
      this.registerModuleWithProvider(abbreviation, repository);
    }
  }

  /**
   * Set the WordFamilyService for Strong's word-root searches.
   * Must be called before using searchStrongs with includeRelatedWords.
   */
  setWordFamilyService(service: WordFamilyService): void {
    this.wordFamilyService = service;
  }

  /**
   * Add a Bible module to the search service
   * Used to dynamically add modules when searching across all Bibles
   */
  addBibleModule(abbreviation: string, repository: IBibleRepository): void {
    if (!this.bibleModules.has(abbreviation)) {
      this.bibleModules.set(abbreviation, repository);
      this.registerModuleWithProvider(abbreviation, repository);
    }
  }

  /**
   * Get list of currently registered module abbreviations
   */
  getRegisteredModules(): string[] {
    return Array.from(this.bibleModules.keys());
  }

  // ========================================================================
  // Keyword-index registry bridge (task 0026, revision 2, subtask M3)
  // ========================================================================

  /**
   * Derive this module's `IndexTarget`.
   *
   * `IndexTarget` (M1) is keyed by `{ moduleUuid, contentSha256 }`, but
   * there is no real module registry yet (M7/M11) that can resolve one from
   * a `moduleAbbr` or vice versa - so this service derives it itself,
   * straight from the repository's own `module_info` row:
   *
   * - `moduleUuid` comes from `getModuleInfo()?.moduleUuid`, falling back to
   *   the abbreviation - the same fallback `BaseModuleInfo.getIdentity()`
   *   uses - for a module that carries no v2 identity block at all.
   * - `contentSha256` comes from `getModuleInfo()?.contentSha256`, falling
   *   back to `''` when absent. F3 (not yet landed) is what computes this
   *   reliably; until then this is a KNOWN GAP: two modules that both lack a
   *   hash collide on the same `IndexTarget` key (`uuid:''`). It is
   *   harmless today only because this service ALSO keys everything by
   *   `moduleAbbr` via `bibleModules`/`targetKeyToAbbr`, so a collision here
   *   cannot misroute a query to the wrong repository - the abbr, not the
   *   target, is what ultimately selects which repo answers a hit. A real
   *   module registry (M7/M11) will need a better answer once modules can
   *   be looked up BY target alone.
   *
   * Deterministic and side-effect-free, so it is safe to call again at
   * search time (see `targetsForModules()`) rather than caching a second
   * abbr -> target map alongside `targetKeyToAbbr`.
   */
  private indexTargetFor(abbreviation: string, repository: IBibleRepository): IndexTarget {
    const info = repository.getModuleInfo();
    return {
      moduleUuid: info?.moduleUuid ?? abbreviation,
      moduleType: 'bible',
      contentSha256: info?.contentSha256 ?? '',
    };
  }

  /**
   * Register a module's repository with `fts5Provider` and record the
   * `IndexTarget -> moduleAbbr` reverse mapping. Called from the
   * constructor (for the initial module map) and from `addBibleModule()`
   * (for a module added later) - the single place either path touches the
   * provider, so they can never drift apart.
   */
  private registerModuleWithProvider(abbreviation: string, repository: IBibleRepository): void {
    const target = this.indexTargetFor(abbreviation, repository);
    this.fts5Provider.register(target, repository);
    this.targetKeyToAbbr.set(indexTargetKey(target), abbreviation);
  }

  /** `IndexTarget[]` for every module in a `moduleAbbr -> repo` map (typically `getModulesToSearch()`'s result). */
  private targetsForModules(modules: Map<string, IBibleRepository>): IndexTarget[] {
    const targets: IndexTarget[] = [];
    for (const [abbreviation, repository] of modules) {
      targets.push(this.indexTargetFor(abbreviation, repository));
    }
    return targets;
  }

  /** The inverse of `indexTargetFor()`, via `targetKeyToAbbr`. */
  private abbrForTarget(target: IndexTarget): string | undefined {
    return this.targetKeyToAbbr.get(indexTargetKey(target));
  }

  /**
   * Record targets the keyword-index registry could not search (a module
   * with no usable index for it - see `KeywordIndexRegistry`'s and
   * `InModuleFts5Provider`'s degrade-rather-than-fail behaviour). Never
   * throws and never lets `skipped` affect the returned `SearchResult[]`
   * beyond simply not containing that module's hits - the whole point of
   * this subtask is that one bad module no longer kills the rest of the
   * search. See `lastSkippedTargets`'s doc comment for what a caller can do
   * with this.
   */
  private reportSkippedTargets(skipped: KeywordSearchResponse['skipped']): void {
    if (skipped.length === 0) return;

    this.lastSkippedTargets.push(...skipped);
    for (const s of skipped) {
      const abbr = this.abbrForTarget(s.target) ?? s.target.moduleUuid;
      console.warn(
        `[BibleSearchService] module "${abbr}" skipped during keyword search: ${JSON.stringify(s.reason)}`
      );
    }
  }

  /**
   * Targets skipped by the most recently completed `search()` call. See
   * `lastSkippedTargets`'s doc comment.
   */
  getLastSkippedModules(): ReadonlyArray<{ target: IndexTarget; reason: KeywordCapability }> {
    return this.lastSkippedTargets;
  }

  /**
   * Run a `KeywordQuery` across `modules` via the keyword-index registry -
   * ONE registry call, fanning out across every target internally - and
   * reconstruct `SearchResult[]` from the returned hits using the exact
   * same downstream formatting (`verseToSearchResultWithHighlight`) the
   * direct-repo-call loop used before this refactor. Shared by
   * `searchMultiWord`, `searchPhrase` and `searchBoolean` - the three
   * methods whose "how do I find matching verse rows across N modules" step
   * was, and remains, "one MATCH query per module", just executed by the
   * registry/provider now instead of a direct repo call.
   *
   * `highlightTerms` is passed through to `verseToSearchResultWithHighlight`
   * as the FALLBACK terms for snippet extraction if `query` itself carries
   * no matches for `Fts5Highlighter` to find - it does not affect which
   * verses match.
   *
   * F7 (task 0027, revision 2): matches (and the `<strong><u>` markup built
   * from them) now come from `Fts5Highlighter.spans(text, query)` -  the SAME
   * transient-FTS5-table mechanism whichever provider answered this hit -
   * rather than from parsing a provider's own `highlight()` output. A hit's
   * `KeywordHit.snippet` (only ever populated by `InModuleFts5Provider`
   * today; `SidecarFts5Provider`'s is always `undefined`, since its `kw`
   * table is contentless) is therefore no longer read here - see
   * `verseToSearchResultWithHighlight`'s doc comment for the full reasoning.
   */
  private async searchViaKeywordIndex(
    query: KeywordQuery,
    modules: Map<string, IBibleRepository>,
    options: SearchOptions,
    highlightTerms: string[]
  ): Promise<SearchResult[]> {
    const targets = this.targetsForModules(modules);
    const response = await this.keywordIndexRegistry.search(query, {
      targets,
      limit: options.maxResults || 200,
    });

    this.reportSkippedTargets(response.skipped);

    const allResults: SearchResult[] = [];

    for (const hit of response.hits) {
      const abbr = this.abbrForTarget(hit.target);
      if (!abbr) continue; // defensive: every hit's target came from `targets` above
      const repo = modules.get(abbr);
      if (!repo) continue;

      const verseId = hit.rowId as VerseId;

      // Pre-filter by range before the getVerse()/highlight work below -
      // same optimization `searchMultiWord` always had, now shared by every
      // caller of this helper (harmless for the two that previously relied
      // solely on the central filter in `search()`, since that filter still
      // runs afterward and would remove the same rows).
      if (options.range && !this.isVerseInRange(verseId, options.range)) continue;

      const verse = repo.getVerse(verseId);
      if (!verse) continue;

      allResults.push(
        await this.verseToSearchResultWithHighlight(
          verse,
          abbr,
          repo,
          query,
          highlightTerms,
          'exact'
        )
      );
    }

    return allResults;
  }

  // ========================================================================
  // Main Search Method
  // ========================================================================

  /**
   * Execute a Bible text search across one or more modules.
   *
   * Parses the query to determine search type (multi-word, phrase, proximity,
   * boolean, fuzzy, regex, or Strong's number), routes to the appropriate
   * implementation, then applies deduplication, ranking, and result limiting.
   *
   * Additional behaviors:
   * - Auto-promotes multi-word queries to proximity when options.proximityDistance is set
   * - Retries with Unicode character variants (e.g., "Aenon" -> "Ænon") on zero results
   * - Auto-supplements with fuzzy matches when result count is between 1-9
   * - Tracks the search in history for suggestions
   *
   * @param query - The search query string. Supports quoted phrases, "~N" proximity,
   *                Strong's numbers (e.g., "G25"), regex with "/pattern/", and boolean operators.
   * @param options - Search configuration: modules to search, book range, result limit,
   *                  proximity distance, fuzzy settings, etc.
   * @returns Array of {@link SearchResult} objects sorted by relevance (exact before fuzzy,
   *          then phrase-match boost, then Bible order)
   * @throws Error if the query has invalid syntax
   */
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Reset the skipped-targets record for this top-level call; see
    // `lastSkippedTargets`'s doc comment. Accumulated (not overwritten) by
    // `reportSkippedTargets()` across every keyword-index call this one
    // `search()` invocation makes below.
    this.lastSkippedTargets = [];

    // Validate query
    const validationError = this.parser.validate(query);
    if (validationError) {
      throw new Error(validationError);
    }

    // Parse query to determine search type
    const parsed = this.parseQuery(query);

    // The query parser can't detect proximity intent from plain text alone;
    // the advanced search dialog sets proximityDistance explicitly, so we
    // promote multi-word -> proximity here to honor that UI setting.
    if (parsed.searchType === 'multi-word' && options.proximityDistance && options.proximityDistance > 0) {
      parsed.searchType = 'proximity';
      parsed.proximity = {
        terms: parsed.terms || [],
        distance: options.proximityDistance,
      };
    }

    // Route to appropriate search method based on type
    let results: SearchResult[] = [];

    switch (parsed.searchType) {
      case 'multi-word':
        results = await this.searchMultiWord(parsed.terms || [], options);
        break;

      case 'phrase':
        results = await this.searchPhrase(parsed.phrase || '', options);
        break;

      case 'proximity':
        results = await this.searchProximity(
          parsed.proximity?.terms || [],
          parsed.proximity?.distance || 10,
          options
        );
        break;

      case 'verse-proximity':
        results = await this.searchVerseProximity(
          parsed.verseProximity?.terms || [],
          parsed.verseProximity?.distance || 5,
          options
        );
        break;

      case 'boolean':
        if (parsed.boolean) {
          results = await this.searchBoolean(parsed.boolean, options);
        }
        break;

      case 'fuzzy':
        results = await this.searchFuzzy(
          parsed.fuzzy?.term || '',
          parsed.fuzzy?.distance || 2,
          options
        );
        break;

      case 'regex':
        results = await this.searchRegex(parsed.regex || '', options);
        break;

      case 'strongs':
        results = await this.searchStrongs(parsed.strongs || '', options);
        break;

      default:
        throw new Error(`Unknown search type: ${parsed.searchType}`);
    }

    // KJV and older translations use Unicode ligatures (Æ, œ, ſ) that users
    // won't type on a modern keyboard. Retry with mapped variants so "Aenon"
    // finds "Ænon" without requiring the user to know the original encoding.
    if (results.length === 0) {
      const variantQuery = this.generateCharacterVariantQuery(query);
      if (variantQuery && variantQuery !== query) {
        const variantParsed = this.parseQuery(variantQuery);
        // Re-run the same search type with variant query
        switch (variantParsed.searchType) {
          case 'multi-word':
            results = await this.searchMultiWord(variantParsed.terms || [], options);
            break;
          case 'phrase':
            results = await this.searchPhrase(variantParsed.phrase || '', options);
            break;
          default:
            // For other search types, try the variant terms directly
            if (variantParsed.terms) {
              results = await this.searchMultiWord(variantParsed.terms, options);
            }
            break;
        }
      }
    }

    // Auto-fuzzy: when exact search returns few results, supplement with fuzzy
    // matches (e.g., stemmed forms, typos) so the user doesn't get a near-empty page.
    // Only triggers when there ARE some results - zero results suggest a bad query
    // rather than a spelling variant, so we skip fuzzy to avoid noise.
    if (options.autoFuzzy !== false && results.length < 10 && results.length > 0) {
      const fuzzyResults = await this.addFuzzyMatches(query, results, options);
      results = [...results, ...fuzzyResults];
    }

    // Scope results to the requested book/chapter range.
    //
    // Applied centrally rather than inside each search-type implementation
    // because only multi-word and Strong's ever did it: a phrase, regex, fuzzy,
    // boolean or proximity search silently ignored the range the user chose, so
    // "Advanced Search -> specific range" appeared to do nothing for most query
    // shapes. Running it here also covers the character-variant retry and the
    // auto-fuzzy supplement above, which produce results after those paths.
    if (options.range) {
      results = results.filter(r => this.isVerseInRange(r.verseId, options.range!));
    }

    // Deduplicate and rank results
    results = this.deduplicateResults(results);
    results = this.rankResults(results, options, query);

    // Apply result limit
    const limit = options.maxResults || 200;
    results = results.slice(0, limit);

    // Note: search history tracking removed for user privacy

    return results;
  }

  /**
   * Whether a verse falls inside a search range.
   *
   * Chapter/verse bounds refine only the first and last book - "Genesis 3 to
   * Exodus 5" means from Gen 3:1 through Exo 5:end, not chapters 3-5 of every
   * book in between. Comparing calculated verse IDs gets that for free, since
   * IDs sort in canonical order; doing it field by field would not.
   *
   * The open-ended defaults (chapter 999 / verse 999) mirror the ceiling the
   * Strong's path has always used: no book has that many chapters or verses, so
   * they act as "to the end of the book".
   */
  private isVerseInRange(verseId: VerseId, range: BibleRange): boolean {
    const { startVerseId, endVerseId } = this.rangeToVerseIdBounds(range);
    return verseId >= startVerseId && verseId <= endVerseId;
  }

  /**
   * Collapse a {@link BibleRange} to inclusive verse-ID bounds.
   *
   * Shared by the in-memory filter above and the Strong's path, which pushes the
   * same bounds down into SQL rather than filtering in JS.
   */
  private rangeToVerseIdBounds(range: BibleRange): { startVerseId: number; endVerseId: number } {
    return {
      startVerseId: VerseIdHelper.calculate(
        range.startBook ?? 1,
        range.startChapter ?? 1,
        range.startVerse ?? 1
      ),
      endVerseId: VerseIdHelper.calculate(
        range.endBook ?? 66,
        range.endChapter ?? 999,
        range.endVerse ?? 999
      ),
    };
  }

  /**
   * Parse a search query string into its structured components without executing a search.
   * Useful for UI display of search type or pre-validation.
   *
   * @param query - The raw search query string
   * @returns Parsed query with detected search type, terms, and type-specific fields
   */
  parseQuery(query: string): ParsedQuery {
    return this.parser.parse(query);
  }

  // ========================================================================
  // Search Type Implementations
  // ========================================================================

  /**
   * Multi-word search: All terms must match (AND logic)
   * Uses verse-level FTS5 from each Bible module
   */
  private async searchMultiWord(terms: string[], options: SearchOptions): Promise<SearchResult[]> {
    const modules = this.getModulesToSearch(options);

    // "all: true" keeps the explicit AND-join multi-word search has always
    // used, since FTS5 defaults to OR when terms are merely space-separated.
    // Compiled by the provider (task 0026 subtask M3), not here - this
    // service now builds the provider-neutral KeywordQuery (M1) and hands
    // it to the keyword-index registry, which fans it out across every
    // module's repository (subtask M2's compileKeywordQuery() call moved
    // into InModuleFts5Provider, the one place that now executes it).
    const query: KeywordQuery = { kind: 'terms', terms, all: true };

    return this.searchViaKeywordIndex(query, modules, options, terms);
  }

  /**
   * Phrase search: Exact word sequence
   * Uses verse-level FTS5 with quoted phrase
   */
  private async searchPhrase(phrase: string, options: SearchOptions): Promise<SearchResult[]> {
    const modules = this.getModulesToSearch(options);

    // Phrase query - escaped/quoted by the provider (task 0026 subtask M3;
    // was compiled here directly through M2's compileKeywordQuery before
    // this refactor) so a phrase containing a literal `"` still produces
    // valid MATCH syntax.
    const query: KeywordQuery = { kind: 'phrase', phrase };

    return this.searchViaKeywordIndex(query, modules, options, [phrase]);
  }

  /**
   * Verse proximity search: Terms within N verses of each other
   * Uses verse-level FTS5 index and verse distance calculation
   */
  /**
   * KAN-22: Now supports fuzzy matching when options.fuzzyDistance is set
   */
  private async searchVerseProximity(
    terms: string[],
    verseDistance: number,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const modules = this.getModulesToSearch(options);
    const allResults: SearchResult[] = [];
    const fuzzyDistance = options.fuzzyDistance || 0;
    const targets = this.targetsForModules(modules);

    // KAN-22: Build fuzzy patterns for search if fuzzyDistance is set. Built
    // as provider-neutral KeywordQuery objects (task 0026 subtask M3) rather
    // than pre-compiled MATCH strings - Fts5QueryCompiler's escaping (so a
    // term with an apostrophe or hyphen doesn't break the query) now runs
    // inside the provider, once per query, when it actually executes.
    const termQueries: KeywordQuery[] = fuzzyDistance > 0
      ? terms.map((t): KeywordQuery => ({ kind: 'prefix', stem: t }))
      : terms.map((t): KeywordQuery => ({ kind: 'terms', terms: [t], all: true }));

    // 1. Search each term independently to build per-module verse sets.
    //
    // One registry call PER TERM, fanning out across every target module
    // internally, replaces what used to be a module-outer/term-inner loop
    // calling each repo directly - and, same as `searchMultiWord` etc., a
    // module whose FTS5 table is missing or broken now degrades to
    // `skipped` (see `reportSkippedTargets`) instead of throwing and taking
    // down verse-proximity search for every OTHER module too (the direct
    // `repo.searchVerses()` call this replaced had no try/catch at all).
    //
    // Every module gets an entry for every term, even one with zero hits,
    // matching the invariant the untouched code below (steps 2-4) depends
    // on: `termVerseMap.get(terms[i])!` is a non-null assertion, so a term
    // with no matches must still map to an EMPTY Set, never a missing key.
    const perModuleTermVerseMap = new Map<string, Map<string, Set<VerseId>>>();
    for (const moduleAbbr of modules.keys()) {
      const termVerseMap = new Map<string, Set<VerseId>>();
      for (const term of terms) {
        termVerseMap.set(term, new Set<VerseId>());
      }
      perModuleTermVerseMap.set(moduleAbbr, termVerseMap);
    }

    for (let i = 0; i < terms.length; i++) {
      const response = await this.keywordIndexRegistry.search(termQueries[i], {
        targets,
        limit: 10000,
      });
      this.reportSkippedTargets(response.skipped);

      for (const hit of response.hits) {
        const abbr = this.abbrForTarget(hit.target);
        if (!abbr) continue; // defensive: every hit's target came from `targets` above
        perModuleTermVerseMap.get(abbr)?.get(terms[i])?.add(hit.rowId as VerseId);
      }
    }

    for (const [moduleAbbr, repo] of modules) {
      const termVerseMap = perModuleTermVerseMap.get(moduleAbbr)!;

      // 2. Check if all terms were found
      //
      // Pre-existing dead code, unchanged: this `continue` only skips to the
      // next term-verseSet PAIR within this inner for-loop, not the module -
      // it never actually did what its own comment says. Not this
      // subtask's to fix (pure refactor; see the M-guardrail), but flagged
      // here since a future subtask touching this method should know.
      for (const [_term, verseSet] of termVerseMap) {
        if (verseSet.size === 0) {
          // At least one term not found, skip this module
          continue;
        }
      }

      // 3. Find matching constellations (verses where all terms appear within verseDistance)
      const matchingVerses = new Set<VerseId>();
      const firstTermVerses = termVerseMap.get(terms[0])!;

      for (const baseVerseId of firstTermVerses) {
        // Check if all other terms appear within verseDistance of this verse
        let allTermsWithinRange = true;

        for (let i = 1; i < terms.length; i++) {
          const otherTermVerses = termVerseMap.get(terms[i])!;

          // Check if any occurrence of this term is within verseDistance verses
          const hasNearbyMatch = Array.from(otherTermVerses).some(otherVerseId => {
            return this.isWithinVerseDistance(baseVerseId, otherVerseId, verseDistance);
          });

          if (!hasNearbyMatch) {
            allTermsWithinRange = false;
            break;
          }
        }

        if (allTermsWithinRange) {
          // Collect ALL verses in this constellation (all terms within range)
          matchingVerses.add(baseVerseId);

          for (const term of terms) {
            for (const vid of termVerseMap.get(term)!) {
              if (this.isWithinVerseDistance(baseVerseId, vid, verseDistance)) {
                matchingVerses.add(vid);
              }
            }
          }
        }
      }

      // 4. Group consecutive verses and format results
      if (matchingVerses.size > 0) {
        const sortedVerses = Array.from(matchingVerses).sort((a, b) => a - b);
        const groups = this.groupConsecutiveVerses(sortedVerses);

        for (const group of groups) {
          if (group.length === 1) {
            // Single verse result
            const verse = repo.getVerse(group[0]);
            if (verse) {
              // KAN-22: Find actual matched words for highlighting (supports fuzzy)
              const verseText = verse.textPlain || verse.text;
              const highlightTerms = fuzzyDistance > 0
                ? this.findFuzzyMatchedWords(verseText, terms, fuzzyDistance)
                : terms;
              const finalHighlightTerms = highlightTerms.length > 0 ? highlightTerms : terms;
              const matchType: MatchType = fuzzyDistance > 0 ? 'fuzzy' : 'exact';

              allResults.push(await this.verseToSearchResult(verse, moduleAbbr, finalHighlightTerms, matchType));
            }
          } else {
            // Multi-verse result - show full range
            const verses = group.map(vid => repo.getVerse(vid)).filter(v => v !== undefined) as BibleVerse[];
            if (verses.length === 0) continue;

            const firstVerse = verses[0];
            const lastVerse = verses[verses.length - 1];
            const combinedText = verses.map(v => v.textPlain || v.text).join(' ');

            // KAN-22: Find actual matched words for highlighting (supports fuzzy)
            const highlightTerms = fuzzyDistance > 0
              ? this.findFuzzyMatchedWords(combinedText, terms, fuzzyDistance)
              : terms;
            const finalHighlightTerms = highlightTerms.length > 0 ? highlightTerms : terms;

            // Create snippet with context
            const snippet = this.createSnippet(combinedText, finalHighlightTerms, 200);

            allResults.push({
              verseId: firstVerse.verseId,
              verseIds: group,
              module: moduleAbbr,
              reference: this.formatVerseRange(firstVerse.verseId, lastVerse.verseId),
              text: await this.highlightMatches(combinedText, finalHighlightTerms),
              snippet: await this.highlightMatches(snippet, finalHighlightTerms),
              matches: this.extractMatches(combinedText, finalHighlightTerms),
              score: 1.0,
              type: fuzzyDistance > 0 ? 'fuzzy' : 'exact',
            });
          }
        }
      }
    }

    return allResults;
  }

  /**
   * Proximity search: Terms within N words of each other
   * Uses book-level FTS5 index at module level, auto-indexes if needed
   * KAN-22: Now supports fuzzy matching when options.fuzzyDistance is set
   */
  private async searchProximity(
    terms: string[],
    distance: number,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const modules = this.getModulesToSearch(options);
    const allResults: SearchResult[] = [];
    const fuzzyDistance = options.fuzzyDistance || 0;

    for (const [moduleAbbr, repo] of modules) {
      // Ensure search tables exist in this module
      repo.ensureSearchTablesExist();

      // Get all books to search
      const books = await this.getBooksInScope(options);

      for (const bookNumber of books) {
        // Ensure book is indexed
        const isIndexed = repo.isBookIndexed(bookNumber);

        if (!isIndexed) {
          // Auto-index the book (now done at module level).
          //
          // R-12: the index lives inside the module database, and a module is
          // an immutable artifact - so on a read-only module this cannot be
          // built. Skip proximity search for that module rather than failing the
          // whole query; the user still gets results from every other search
          // mode and every writable module.
          //
          // `ensureSearchTablesExist()` is necessary but NOT sufficient: it
          // returns true whenever the tables are already present, and a shipped
          // module can carry empty index tables while still being read-only. The
          // guard therefore passes and the writes inside `buildBookIndex` throw.
          // That is not hypothetical - it is the normal state of a bundled module
          // on macOS (inside a `.app`) or Linux (inside a mounted AppImage),
          // where the whole resources directory is read-only.
          if (!repo.ensureSearchTablesExist()) continue;
          try {
            repo.buildBookIndex(bookNumber);
          } catch (e) {
            // Degrade exactly as the missing-tables branch above does. Anything
            // that is not a read-only refusal is a real fault and still throws.
            if (isReadOnlyDatabaseError(e)) continue;
            throw e;
          }
        }

        // Build FTS5 NEAR query (with fuzzy prefix patterns if enabled),
        // through the single compiler (task 0026 subtask M2) so a hyphenated
        // or apostrophe'd term no longer breaks NEAR() syntax. KeywordQuery's
        // 'near' kind escapes plain terms; the fuzzy/prefix-wildcard variant
        // isn't part of that shape, so each term is compiled as its own
        // 'prefix' query and NEAR(...) is assembled from the results.
        const fts5Query = fuzzyDistance > 0
          ? `NEAR(${terms.map(t => compileKeywordQuery({ kind: 'prefix', stem: t })).join(' ')}, ${distance})`
          : compileKeywordQuery({ kind: 'near', terms, distance });

        // Perform proximity search (now at module level)
        const matches = repo.searchBookFTS5(bookNumber, fts5Query);

        // If we got matches, find the specific verses.
        //
        // R-M2: `searchBookFTS5` only ever runs offsets() for a non-NEAR
        // query, and this method only ever sends it NEAR(...) (see
        // `fts5Query` above) - so `matches[*].offsets` is always '' and the
        // offsets()-based branch that used to live here was unreachable dead
        // code. Removed along with its counterpart in
        // `BibleRepository.searchBookFTS5`; see that method's comment.
        if (matches.length > 0) {
          // Use searchProximityInBook to find matching verses
          // Pass original terms (without wildcards) for the proximity check
          const matchingVerseIds = repo.searchProximityInBook(bookNumber, terms, distance);

          if (matchingVerseIds.length === 0) continue;

          // Get all verses involved in the match
          const verses = matchingVerseIds.map(id => repo.getVerse(id)).filter(v => v !== undefined) as BibleVerse[];

          if (verses.length === 0) continue;

          if (verses.length === 1) {
            // Single verse result
            const verse = verses[0];
            const verseText = verse.textPlain || verse.text;

            // KAN-22: Find actual matched words for highlighting (supports fuzzy)
            const highlightTerms = fuzzyDistance > 0
              ? this.findFuzzyMatchedWords(verseText, terms, fuzzyDistance)
              : terms;
            // Fall back to original terms if no fuzzy matches found
            const finalHighlightTerms = highlightTerms.length > 0 ? highlightTerms : terms;

            allResults.push({
              verseId: verse.verseId,
              module: moduleAbbr,
              reference: this.formatReference(verse.verseId),
              text: await this.highlightMatches(verseText, finalHighlightTerms),
              matches: this.extractMatches(verseText, finalHighlightTerms),
              score: 1.0,
              type: fuzzyDistance > 0 ? 'fuzzy' : 'exact',
            });
          } else {
            // Multi-verse result - show full range from first to last verse
            // Sort verses to ensure proper order
            const sortedVerses = verses.sort((a, b) => a.verseId - b.verseId);
            const firstVerse = sortedVerses[0];
            const lastVerse = sortedVerses[sortedVerses.length - 1];
            const combinedText = sortedVerses.map(v => v.textPlain || v.text).join(' ');

            // KAN-22: Find actual matched words for highlighting (supports fuzzy)
            const highlightTerms = fuzzyDistance > 0
              ? this.findFuzzyMatchedWords(combinedText, terms, fuzzyDistance)
              : terms;
            // Fall back to original terms if no fuzzy matches found
            const finalHighlightTerms = highlightTerms.length > 0 ? highlightTerms : terms;

            // Create snippet showing matched terms with context and ellipses
            const snippet = this.createSnippet(combinedText, finalHighlightTerms, 200);

            allResults.push({
              verseId: firstVerse.verseId,
              verseIds: matchingVerseIds,
              module: moduleAbbr,
              reference: this.formatVerseRange(firstVerse.verseId, lastVerse.verseId),
              text: await this.highlightMatches(combinedText, finalHighlightTerms),
              snippet: await this.highlightMatches(snippet, finalHighlightTerms),
              matches: this.extractMatches(combinedText, finalHighlightTerms),
              score: 1.0,
              type: fuzzyDistance > 0 ? 'fuzzy' : 'exact',
            });
          }
        }
      }
    }

    return allResults;
  }

  /**
   * Boolean search: AND, OR, NOT operators
   * Simplified implementation - full boolean would use expression tree evaluation
   */
  private async searchBoolean(
    expression: BooleanExpression,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    const query: KeywordQuery = { kind: 'boolean', expr: expression };

    // Only an unsatisfiable expression compiles to '' - today that means a
    // bare negation such as `(NOT evil)`. FTS5's NOT is binary: it excludes
    // from a left-hand match set, and there is no "every verse" operand to
    // subtract from, so the alternative would be a full-corpus scan on a query
    // that asks for almost the whole Bible. Returning nothing is the honest
    // answer; returning the *matches* for `evil` here would be the exact
    // opposite of what was asked.
    //
    // This is the one remaining direct call to compileKeywordQuery() in this
    // service (task 0026 subtask M3 moved every other call into
    // InModuleFts5Provider, the one place that now executes a compiled
    // query against SQLite) - it is a pure business-logic short-circuit, not
    // a duplicate execution: it never touches the registry/provider or SQL
    // at all, and the provider still does its own internal compile of the
    // same `query` object below when (and only when) it actually runs it.
    if (compileKeywordQuery(query) === '') return [];

    const modules = this.getModulesToSearch(options);
    const terms = this.collectPositiveTerms(expression);

    return this.searchViaKeywordIndex(query, modules, options, terms);
  }

  /**
   * The terms a matching verse actually contains, for highlighting.
   *
   * Everything under a NOT is excluded: those words are guaranteed absent from
   * every result, so highlighting them would be highlighting nothing.
   */
  private collectPositiveTerms(expression: BooleanExpression | string): string[] {
    if (typeof expression === 'string') {
      return this.parser.parse(expression).terms || [];
    }

    const { operator, left, right } = expression;

    if (operator === 'NOT') {
      // Binary `a NOT b` keeps the left side; unary NOT contributes nothing.
      return right === undefined ? [] : this.collectPositiveTerms(left);
    }

    const terms = this.collectPositiveTerms(left);
    if (right !== undefined && !this.isBareNegation(right)) {
      terms.push(...this.collectPositiveTerms(right));
    }

    return [...new Set(terms)];
  }

  /**
   * Is this operand a negation with nothing of its own to exclude from?
   *
   * Used only by `collectPositiveTerms` above (a bare-negation right operand
   * contributes no positive terms to highlight). The FTS5-syntax version of
   * this same check now lives with the rest of the boolean-to-MATCH compiler
   * in `Fts5QueryCompiler`; this copy is about highlighting, not syntax.
   */
  private isBareNegation(operand: BooleanExpression | string): boolean {
    return (
      typeof operand !== 'string' &&
      operand.operator === 'NOT' &&
      operand.right === undefined
    );
  }

  /**
   * Fuzzy search: Find similar words (Levenshtein distance)
   * Uses FTS5 with wildcard patterns
   * Applies intelligent distance based on word length
   */
  private async searchFuzzy(
    term: string,
    distance: number,
    options: SearchOptions
  ): Promise<SearchResult[]> {
    // Cap edit distance relative to word length to avoid nonsensical matches.
    // "God" (3 chars) with distance 2 would match nearly anything; length/4
    // keeps short-word fuzzy tight while allowing more slack for longer words.
    const maxDistance = Math.max(1, Math.floor(term.length / 4));
    const actualDistance = Math.min(distance, maxDistance);

    // Simplified fuzzy: use wildcard patterns
    // Full implementation would use Levenshtein distance algorithm
    const pattern = this.buildFuzzyPattern(term, actualDistance);
    return this.searchMultiWord([pattern], options);
  }

  /**
   * Regex search: Pattern-based matching.
   * FTS5 doesn't support arbitrary regex, so we must load all verses and filter
   * in JavaScript. This is O(n) over the entire Bible - intentionally slow but
   * necessary for advanced patterns like look-aheads or character classes.
   */
  private async searchRegex(pattern: string, options: SearchOptions): Promise<SearchResult[]> {
    const modules = this.getModulesToSearch(options);
    const allResults: SearchResult[] = [];
    const regex = new RegExp(pattern, options.caseSensitive ? '' : 'i');

    for (const [moduleAbbr, repo] of modules) {
      // Get all verses in scope (expensive!)
      const books = await this.getBooksInScope(options);

      for (const bookNumber of books) {
        const verses = repo.getBook(bookNumber);

        for (const verse of verses) {
          const text = verse.textPlain || verse.text;
          if (regex.test(text)) {
            allResults.push(await this.verseToSearchResult(verse, moduleAbbr, [pattern], 'exact'));
          }
        }
      }
    }

    return allResults;
  }

  /**
   * Strong's number search: Find all verses with specific Greek/Hebrew word.
   * Searches the interlinear_word table for matching Strong's numbers.
   * Optionally includes word family members (related roots/derivations).
   */
  private async searchStrongs(strongsNumber: string, options: SearchOptions): Promise<SearchResult[]> {
    const parsed = StrongsNumberHelper.parse(strongsNumber);
    if (!parsed) {
      console.warn(`[BibleSearchService] Invalid Strong's number: ${strongsNumber}`);
      return [];
    }

    // Build list of Strong's numbers to search
    const numbersToSearch: string[] = [StrongsNumberHelper.toDisplayFormat(strongsNumber)!];

    // If includeRelatedWords, add word family members
    if (options.includeRelatedWords && this.wordFamilyService) {
      const related = this.wordFamilyService.getRelatedNumbers(strongsNumber);
      numbersToSearch.push(...related);
    }

    // Build verse ID range for scope filtering - pushed down into SQL below
    // rather than filtered in memory, since the interlinear table is large.
    const range = options.range ? this.rangeToVerseIdBounds(options.range) : undefined;

    const modules = this.getModulesToSearch(options);
    const allResults: SearchResult[] = [];
    const primaryDisplay = StrongsNumberHelper.toDisplayFormat(strongsNumber)!;

    for (const [moduleAbbr, repo] of modules) {
      // Search for each Strong's number
      for (const num of numbersToSearch) {
        const variants = StrongsNumberHelper.toInterlinearVariants(num);
        if (variants.length === 0) continue;

        const verseIds = repo.searchByStrongsNumber(variants, range);
        if (verseIds.length === 0) continue;

        // Get glosses for highlighting
        const glosses = repo.getGlossesForStrongs(variants);

        // Demote word-family relatives so the exact Strong's number
        // the user searched for sorts above derivations and cognates.
        const isPrimary = num === primaryDisplay;
        const score = isPrimary ? 1.0 : 0.8;

        // Fetch verse text and build results
        const limit = options.maxResults || 200;
        const idsToProcess = verseIds.slice(0, limit);

        for (const verseId of idsToProcess) {
          const verse = repo.getVerse(verseId);
          if (!verse) continue;

          const text = verse.textPlain || verse.text;
          const highlightedText = glosses.length > 0
            ? await this.highlightMatches(text, glosses)
            : text;

          const matches: Match[] = glosses.length > 0
            ? this.extractMatches(text, glosses)
            : [];

          let snippet: string | undefined;
          if (text.length > 100 && matches.length > 0) {
            const rawSnippet = this.createSnippet(text, glosses, 120);
            snippet = await this.highlightMatches(rawSnippet, glosses);
          }

          allResults.push({
            verseId,
            module: moduleAbbr,
            reference: this.formatReference(verseId),
            text: highlightedText || text,
            snippet,
            matches,
            score,
            type: 'exact',
          });
        }
      }
    }

    return allResults;
  }

  /**
   * Get the word family for a Strong's number (for UI display).
   * Returns null if WordFamilyService is not configured.
   */
  getWordFamily(strongsNumber: string): { primary: WordFamilyMember; members: WordFamilyMember[] } | null {
    if (!this.wordFamilyService) return null;
    return this.wordFamilyService.getWordFamily(strongsNumber);
  }

  /**
   * Get cached Strong's entry info (word, transliteration, gloss).
   * Returns null if WordFamilyService is not configured.
   */
  getStrongsEntryInfo(strongsNumber: string): { word?: string; transliteration?: string; gloss: string } | null {
    if (!this.wordFamilyService) return null;
    return this.wordFamilyService.getEntryInfo(strongsNumber);
  }

  // ========================================================================
  // Helper Methods
  // ========================================================================

  /**
   * Convert BibleVerse to SearchResult with highlighting
   * Creates a snippet that prioritizes showing the matched text
   */
  private async verseToSearchResult(
    verse: BibleVerse,
    moduleAbbr: string,
    searchTerms: string[],
    matchType: MatchType
  ): Promise<SearchResult> {
    const text = verse.textPlain || verse.text;
    const highlightedText = await this.highlightMatches(text, searchTerms);
    const matches = this.extractMatches(text, searchTerms);

    // Create a snippet that prioritizes the matched text (for live search display)
    // Only needed for longer verses where matches might not be visible at the start
    let snippet: string | undefined;
    if (text.length > 100 && matches.length > 0) {
      // Use the actual matched terms (not search terms) to ensure fuzzy/stem matches are highlighted
      const matchedTerms = matches.map(m => m.term);
      const rawSnippet = this.createSnippet(text, matchedTerms.length > 0 ? matchedTerms : searchTerms, 120);
      snippet = await this.highlightMatches(rawSnippet, matchedTerms.length > 0 ? matchedTerms : searchTerms);
    }

    return {
      verseId: verse.verseId,
      module: moduleAbbr,
      reference: this.formatReference(verse.verseId),
      // Last line of defence for the same failure the repository guards: a
      // result carrying a reference but no text renders as an empty row, which
      // reads as "this translation has nothing here" rather than as the
      // highlighting problem it is.
      text: highlightedText || text,
      snippet,
      matches,
      score: 1.0,
      type: matchType,
    };
  }

  /**
   * Convert BibleVerse to SearchResult, highlighting through {@link Fts5Highlighter}
   * (task 0027, revision 2, subtask F7) - which correctly highlights stemmed
   * variants (e.g., searching "walk" highlights "walking", "walked") because
   * it runs the SAME compiled `query` through the SAME tokenizer FTS5 itself
   * used to find the hit, rather than a hand-rolled regex. Also creates a
   * snippet that prioritizes showing the matched text.
   *
   * ## One highlighter, used regardless of which provider answered (F7's
   * design intent, design doc §4.5)
   *
   * `InModuleFts5Provider` still runs its own `highlight()` against
   * `bible_verse_fts` internally (unchanged by this subtask - see that
   * class), so a hit it produces arrives with `KeywordHit.snippet` already
   * carrying `<strong><u>`-marked text. This method does NOT consume that:
   * un-highlighting it back to plain text just to feed it through
   * `Fts5Highlighter` would be wasted work for no behavioural difference (the
   * two mechanisms use the identical tokenizer and the identical compiled
   * query, so they agree on every match), and computing matches straight
   * from `verse.textPlain`/`verse.text` - which this method already reads,
   * for the snippet - is both simpler and the one path a future
   * `SidecarFts5Provider`-sourced hit (whose `snippet` is always `undefined`,
   * since its index is contentless) can share unchanged. That sharing is the
   * whole point of F7: one highlighting mechanism, not one per provider.
   *
   * KAN-22: For fuzzy/stem matches, we use the actual matched words (not the
   * original search terms) to ensure the snippet shows the matched variants.
   */
  private async verseToSearchResultWithHighlight(
    verse: BibleVerse,
    moduleAbbr: string,
    repo: IBibleRepository,
    query: KeywordQuery,
    searchTerms: string[],
    matchType: MatchType
  ): Promise<SearchResult> {
    const text = verse.textPlain || verse.text;

    // F7: offset spans from the transient-FTS5-table highlighter, keyed by
    // module so every hit from the same module reuses one highlighter (and
    // therefore one `temp.hl` table) instead of paying `CREATE VIRTUAL
    // TABLE` again per verse - see `highlighterFor()`.
    const matches = this.highlighterFor(moduleAbbr, repo).spans(text, query);
    const highlightedText = this.applyHighlightMarkup(text, matches);

    // Create a snippet that prioritizes the matched text (for live search display)
    // Only needed for longer verses where matches might not be visible at the start
    let snippet: string | undefined;
    if (text.length > 100 && matches.length > 0) {
      // KAN-22: Use the actual matched terms (from Fts5Highlighter) to
      // ensure fuzzy/stem matches are properly highlighted in the snippet
      const matchedTerms = matches.map(m => m.term);
      const termsForSnippet = matchedTerms.length > 0 ? matchedTerms : searchTerms;
      const rawSnippet = this.createSnippet(text, termsForSnippet, 120);
      snippet = await this.highlightMatches(rawSnippet, termsForSnippet);
    }

    return {
      verseId: verse.verseId,
      module: moduleAbbr,
      reference: this.formatReference(verse.verseId),
      // Last line of defence for the same failure the repository guards: a
      // result carrying a reference but no text renders as an empty row, which
      // reads as "this translation has nothing here" rather than as the
      // highlighting problem it is.
      text: highlightedText || text,
      snippet,
      matches,
      score: 1.0,
      type: matchType,
    };
  }

  /**
   * This module's {@link Fts5Highlighter}, created on first use and reused
   * for the life of this service (F7). One per module rather than one
   * shared instance: a highlighter's `temp.hl` table lives on the `ISql`
   * connection it was built on (`repo.getSql()`), and different modules are
   * different connections.
   */
  private highlighterFor(moduleAbbr: string, repo: IBibleRepository): Fts5Highlighter {
    let highlighter = this.highlighters.get(moduleAbbr);
    if (!highlighter) {
      highlighter = new Fts5Highlighter(repo.getSql());
      this.highlighters.set(moduleAbbr, highlighter);
    }
    return highlighter;
  }

  /**
   * Wrap each of `matches` in `<strong><u>...</u></strong>`, the markup
   * convention every consumer of `SearchResult.text` already expects (see
   * `BibleSearchService.test.ts`'s "Result Highlighting"/"FTS5 Stemmed
   * Highlighting" suites). `matches` must be in ascending, non-overlapping
   * order - exactly what `Fts5Highlighter.spans()` returns, since
   * `highlight()` never nests or overlaps its own markers.
   *
   * An empty `matches` returns `text` unchanged, which is also the "no
   * matches" case `text: highlightedText || text` below guards - kept
   * anyway as the same last line of defence the repository-level highlight
   * path always had.
   */
  private applyHighlightMarkup(text: string, matches: Match[]): string {
    if (matches.length === 0) return text;

    let result = '';
    let cursor = 0;
    for (const match of matches) {
      result += text.slice(cursor, match.startPos);
      result += `<strong><u>${text.slice(match.startPos, match.endPos)}</u></strong>`;
      cursor = match.endPos;
    }
    result += text.slice(cursor);

    return result;
  }

  /**
   * Highlight matched terms in text
   * Wraps matches in <strong><u>...</u></strong> tags
   */
  private async highlightMatches(text: string, terms: string[]): Promise<string> {
    let highlighted = text;

    for (const term of terms) {
      // Skip common stop words - they match nearly every verse and add noise
      if (ENGLISH_STOP_WORDS.has(term.toLowerCase())) continue;
      const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');
      highlighted = highlighted.replace(regex, '<strong><u>$1</u></strong>');
    }

    return highlighted;
  }

  /**
   * Extract match positions from text
   */
  private extractMatches(text: string, terms: string[]): Match[] {
    const matches: Match[] = [];

    for (const term of terms) {
      if (ENGLISH_STOP_WORDS.has(term.toLowerCase())) continue;
      const regex = new RegExp(this.escapeRegex(term), 'gi');
      let match;

      while ((match = regex.exec(text)) !== null) {
        matches.push({
          term,
          startPos: match.index,
          endPos: match.index + term.length,
        });
      }
    }

    return matches;
  }

  /**
   * Format verse ID as human-readable reference
   */
  private formatReference(verseId: VerseId): string {
    const { bookNumber, chapter, verse } = VerseIdHelper.parse(verseId);
    const bookInfo = this.bibleBookRepo.getByBookNumber(bookNumber);
    const bookName = bookInfo?.bookName || `Book ${bookNumber}`;

    return `${bookName} ${chapter}:${verse}`;
  }

  /**
   * Format verse range as human-readable reference (e.g., "Proverbs 6:6-7")
   */
  private formatVerseRange(startVerseId: VerseId, endVerseId: VerseId): string {
    const start = VerseIdHelper.parse(startVerseId);
    const end = VerseIdHelper.parse(endVerseId);
    const bookInfo = this.bibleBookRepo.getByBookNumber(start.bookNumber);
    const bookName = bookInfo?.bookName || `Book ${start.bookNumber}`;

    // Same verse
    if (startVerseId === endVerseId) {
      return `${bookName} ${start.chapter}:${start.verse}`;
    }

    // Same chapter
    if (start.bookNumber === end.bookNumber && start.chapter === end.chapter) {
      return `${bookName} ${start.chapter}:${start.verse}-${end.verse}`;
    }

    // Different chapters
    return `${bookName} ${start.chapter}:${start.verse}-${end.chapter}:${end.verse}`;
  }

  /**
   * Group consecutive verse IDs into arrays
   * Example: [6006, 6007, 6009, 6010] -> [[6006, 6007], [6009, 6010]]
   */
  private groupConsecutiveVerses(verseIds: VerseId[]): VerseId[][] {
    if (verseIds.length === 0) return [];

    const sorted = [...verseIds].sort((a, b) => a - b);
    const groups: VerseId[][] = [];
    let currentGroup: VerseId[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const current = sorted[i];

      // Check if consecutive (verse IDs differ by 1)
      if (current === prev + 1) {
        currentGroup.push(current);
      } else {
        // Start new group
        groups.push(currentGroup);
        currentGroup = [current];
      }
    }

    // Add final group
    groups.push(currentGroup);

    return groups;
  }

  /**
   * Find the start of the word at or before the given position
   * Moves backward to avoid cutting off the beginning of a word
   */
  private findWordStart(text: string, position: number): number {
    // If we're at the beginning, return 0
    if (position <= 0) return 0;

    // Clamp position to valid range
    position = Math.min(position, text.length - 1);

    // If we're in the middle of a word, move backward to find the start
    if (position < text.length && /[a-zA-Z0-9']/.test(text[position])) {
      while (position > 0 && /[a-zA-Z0-9']/.test(text[position - 1])) {
        position--;
      }
      return position;
    }

    // If we're in whitespace/punctuation, move backward to find the previous word's end,
    // then forward to find the next word's start
    // First try moving forward to find the next word
    let forward = position;
    while (forward < text.length && /[\s.,;:!?'"()-]/.test(text[forward])) {
      forward++;
    }

    // If we found a word ahead, use that position
    if (forward < text.length) {
      return forward;
    }

    // Otherwise, move backward to find the start of the previous word
    let backward = position;
    while (backward > 0 && /[\s.,;:!?'"()-]/.test(text[backward - 1])) {
      backward--;
    }
    while (backward > 0 && /[a-zA-Z0-9']/.test(text[backward - 1])) {
      backward--;
    }

    return backward;
  }

  /**
   * Find the end of the word at or after the given position
   * Extends to include the complete word to avoid breaking words at the end
   */
  private findWordEnd(text: string, position: number): number {
    // If we're at or past the end, return the length
    if (position >= text.length) return text.length;

    // If we're in the middle of a word, move forward to the end of it
    if (/[a-zA-Z0-9']/.test(text[position])) {
      while (position < text.length && /[a-zA-Z0-9']/.test(text[position])) {
        position++;
      }
      return position;
    }

    // If we're in whitespace/punctuation, we're already at a word boundary
    // But check if there's a word just before us that we should include
    if (position > 0 && /[a-zA-Z0-9']/.test(text[position - 1])) {
      // We're right after a word, position is fine
      return position;
    }

    // Move backward to find if there's a word to include
    let searchPos = position;
    while (searchPos > 0 && /[\s.,;:!?'"()-]/.test(text[searchPos - 1])) {
      searchPos--;
    }

    // If we found a word, return position after it
    if (searchPos > 0 && /[a-zA-Z0-9']/.test(text[searchPos - 1])) {
      return searchPos;
    }

    return position;
  }

  /**
   * Create snippet with ellipses showing matched terms in context
   * Example: "...Go to the ant, thou sluggard...there is no guide, overseer, or ruler..."
   */
  private createSnippet(text: string, terms: string[], maxLength: number): string {
    // Find positions of all matched terms (deduplicated by position to avoid counting overlapping matches)
    const matchPositions: Array<{ pos: number; term: string }> = [];

    for (const term of terms) {
      if (ENGLISH_STOP_WORDS.has(term.toLowerCase())) continue;
      const regex = new RegExp(this.escapeRegex(term), 'gi');
      let match;

      while ((match = regex.exec(text)) !== null) {
        matchPositions.push({ pos: match.index, term });
      }
    }

    // If no matches, return beginning of text
    if (matchPositions.length === 0) {
      return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
    }

    // Sort by position
    matchPositions.sort((a, b) => a.pos - b.pos);

    // Find the range that includes all matches
    const firstMatch = matchPositions[0].pos;
    const lastMatch = matchPositions[matchPositions.length - 1].pos;
    const lastMatchTerm = matchPositions[matchPositions.length - 1].term;
    const matchRange = lastMatch - firstMatch + lastMatchTerm.length;

    // If all matches fit within maxLength, center them
    if (matchRange < maxLength) {
      const contextBefore = Math.floor((maxLength - matchRange) / 2);
      let start = Math.max(0, firstMatch - contextBefore);
      let end = Math.min(text.length, start + maxLength);

      // Adjust to word boundaries to avoid breaking words
      const adjustedStart = this.findWordStart(text, start);
      const adjustedEnd = this.findWordEnd(text, end);

      let snippet = text.substring(adjustedStart, adjustedEnd);

      // Add ellipses only if text is truncated and we're not at word boundaries
      if (adjustedStart > 0) snippet = '...' + snippet;
      if (adjustedEnd < text.length) snippet = snippet + '...';

      return snippet;
    }

    // Matches are too far apart - show context around key matches
    // Limit to at most 3 snippet regions to ensure adequate context per region
    const maxRegions = 3;
    const minContextSize = 40; // Minimum chars per region for readability

    // Select representative match positions (first, middle, last) if too many
    let selectedPositions = matchPositions;
    if (matchPositions.length > maxRegions) {
      selectedPositions = [
        matchPositions[0],
        matchPositions[Math.floor(matchPositions.length / 2)],
        matchPositions[matchPositions.length - 1],
      ];
    }

    // Calculate context size per region
    const contextSize = Math.max(minContextSize, Math.floor(maxLength / selectedPositions.length));

    const snippets: string[] = [];
    const snippetStarts: number[] = [];
    const snippetEnds: number[] = [];
    let lastEndPos = -1;

    for (const { pos, term } of selectedPositions) {
      // Calculate context window centered on the match
      const halfContext = Math.floor((contextSize - term.length) / 2);
      let start = Math.max(0, pos - halfContext);
      let end = Math.min(text.length, pos + term.length + halfContext);

      // Adjust to word boundaries
      const adjustedStart = this.findWordStart(text, start);
      const adjustedEnd = this.findWordEnd(text, end);

      // Skip if this region overlaps with the previous one
      if (adjustedStart <= lastEndPos) {
        // Merge with previous region by extending its end
        if (snippetEnds.length > 0) {
          snippetEnds[snippetEnds.length - 1] = Math.max(snippetEnds[snippetEnds.length - 1], adjustedEnd);
          snippets[snippets.length - 1] = text.substring(snippetStarts[snippetStarts.length - 1], snippetEnds[snippetEnds.length - 1]).trim();
          lastEndPos = snippetEnds[snippetEnds.length - 1];
        }
        continue;
      }

      const snippetText = text.substring(adjustedStart, adjustedEnd).trim();

      // Only add non-empty snippets
      if (snippetText.length > 0) {
        snippets.push(snippetText);
        snippetStarts.push(adjustedStart);
        snippetEnds.push(adjustedEnd);
        lastEndPos = adjustedEnd;
      }
    }

    // If no valid snippets were created, fall back to showing the beginning
    if (snippets.length === 0) {
      const fallbackEnd = Math.min(text.length, maxLength);
      return text.substring(0, fallbackEnd) + (text.length > fallbackEnd ? '...' : '');
    }

    // Join snippets with ellipses
    let result = snippets.join('...');

    // Add leading ellipsis only if first snippet doesn't start at beginning
    if (snippetStarts[0] > 0) {
      result = '...' + result;
    }

    // Add trailing ellipsis only if last snippet doesn't end at text end
    if (snippetEnds[snippetEnds.length - 1] < text.length) {
      result = result + '...';
    }

    return result;
  }

  /**
   * Get modules to search based on options
   */
  private getModulesToSearch(options: SearchOptions): Map<string, IBibleRepository> {
    if (options.modules && options.modules.length > 0) {
      const filtered = new Map<string, IBibleRepository>();
      for (const abbr of options.modules) {
        const repo = this.bibleModules.get(abbr);
        if (repo) {
          filtered.set(abbr, repo);
        }
      }
      return filtered;
    }

    // Default: search all modules
    return this.bibleModules;
  }

  /**
   * Get book numbers in scope based on search options
   */
  private async getBooksInScope(options: SearchOptions): Promise<number[]> {
    if (options.range) {
      // Use specified range
      const { startBook, endBook } = options.range;
      if (startBook && endBook) {
        const books: number[] = [];
        for (let i = startBook; i <= endBook; i++) {
          books.push(i);
        }
        return books;
      }
    }

    // Default: all 66 books
    return Array.from({ length: 66 }, (_, i) => i + 1);
  }

  /**
   * Index a book for proximity search (now handled at module level)
   */
  private async indexBook(
    _moduleAbbr: string,
    bookNumber: number,
    repo: IBibleRepository
  ): Promise<void> {
    // Ensure search tables exist
    repo.ensureSearchTablesExist();

    // Build index at module level
    repo.buildBookIndex(bookNumber);
  }

  /**
   * Deduplicate results (same verse in multiple modules)
   */
  private deduplicateResults(results: SearchResult[]): SearchResult[] {
    const seen = new Set<VerseId>();
    const unique: SearchResult[] = [];

    for (const result of results) {
      if (!seen.has(result.verseId)) {
        seen.add(result.verseId);
        unique.push(result);
      }
    }

    return unique;
  }

  /**
   * Rank and sort results
   */
  private rankResults(results: SearchResult[], _options: SearchOptions, query?: string): SearchResult[] {
    // For multi-word queries, boost results containing the exact phrase
    const queryLower = query?.toLowerCase().trim();
    const isMultiWord = queryLower && queryLower.includes(' ') && !queryLower.startsWith('"');

    // Pre-compute exact phrase matches (strip HTML tags from highlighted text)
    const phraseMatchCache = new Map<SearchResult, boolean>();
    if (isMultiWord) {
      for (const r of results) {
        const plainText = (r.text ?? '').replace(/<[^>]*>/g, '').toLowerCase();
        phraseMatchCache.set(r, plainText.includes(queryLower));
      }
    }

    // Three-tier sort: exact > fuzzy, then phrase-match boost, then Bible order.
    // Bible order (by verseId) feels natural to users who think in canonical sequence.
    return results.sort((a, b) => {
      // Exact matches come first
      if (a.type === 'exact' && b.type !== 'exact') return -1;
      if (a.type !== 'exact' && b.type === 'exact') return 1;

      // For multi-word queries, boost results containing the exact phrase
      if (isMultiWord) {
        const aHasPhrase = phraseMatchCache.get(a) ?? false;
        const bHasPhrase = phraseMatchCache.get(b) ?? false;
        if (aHasPhrase && !bHasPhrase) return -1;
        if (!aHasPhrase && bHasPhrase) return 1;
      }

      // Within same type, sort by verse ID (Bible order)
      return a.verseId - b.verseId;
    });
  }

  /**
   * Add fuzzy matches if original results < 10
   */
  private async addFuzzyMatches(
    query: string,
    existingResults: SearchResult[],
    options: SearchOptions
  ): Promise<SearchResult[]> {
    // Extract terms from query
    const parsed = this.parseQuery(query);
    const terms = parsed.terms || [];

    if (terms.length === 0) return [];

    // Search with fuzzy variants
    const fuzzyResults: SearchResult[] = [];

    for (const term of terms) {
      // Calculate intelligent fuzzy distance: word length / 4, minimum 1
      // This prevents overly fuzzy matches for short words
      const maxDistance = Math.max(1, Math.floor(term.length / 4));

      // Use wildcard for fuzzy matching (simplified approach)
      // For short words (length <= 4), only use prefix matching with wildcards at the end
      // For longer words, we can be more permissive
      const fuzzyPattern = this.buildFuzzyPattern(term, maxDistance);

      const results = await this.searchMultiWord([fuzzyPattern], {
        ...options,
        maxResults: 20,
      });

      // Mark as fuzzy matches
      for (const result of results) {
        result.type = 'fuzzy';
        fuzzyResults.push(result);
      }
    }

    // Filter out results that already exist
    const existingIds = new Set(existingResults.map(r => r.verseId));
    return fuzzyResults.filter(r => !existingIds.has(r.verseId));
  }

  /**
   * Build fuzzy pattern with wildcards
   * Uses intelligent distance calculation based on word length
   */
  private buildFuzzyPattern(term: string, distance: number): string {
    // For very short words (distance 1), only use exact prefix match with wildcard
    // This prevents "God" from matching "good", "gold", etc. too broadly
    if (distance <= 1) {
      return `${term}*`;
    }

    // For longer words, we still use wildcard suffix
    // A full implementation would use Levenshtein distance or edit distance algorithms
    return `${term}*`;
  }

  /**
   * KAN-22: Find words in text that match fuzzy patterns
   * Used to determine actual matched words for highlighting in fuzzy/proximity searches
   */
  private findFuzzyMatchedWords(text: string, searchTerms: string[], fuzzyDistance: number): string[] {
    const matchedWords: Set<string> = new Set();

    // Extract words from text (letters and apostrophes only)
    const words = text.match(/[a-zA-Z']+/g) || [];

    for (const term of searchTerms) {
      const termLower = term.toLowerCase();

      for (const word of words) {
        const wordLower = word.toLowerCase();

        // Check for exact match
        if (wordLower === termLower) {
          matchedWords.add(word);
          continue;
        }

        // Check for prefix match (fuzzy wildcard style)
        if (wordLower.startsWith(termLower)) {
          matchedWords.add(word);
          continue;
        }

        // Check for fuzzy match using simple Levenshtein distance
        if (fuzzyDistance > 0 && this.levenshteinDistance(termLower, wordLower) <= fuzzyDistance) {
          matchedWords.add(word);
        }
      }
    }

    return Array.from(matchedWords);
  }

  /**
   * Calculate Levenshtein distance between two strings
   * Used for fuzzy matching
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    // Initialize first column
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    // Initialize first row
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ========================================================================
  // Character Variant Support
  // ========================================================================

  /**
   * Character variant mappings for old/archaic text (KJV, etc.)
   * Maps modern ASCII sequences to their Unicode equivalents and vice versa.
   * Used for fallback search when exact matches return no results.
   */
  private static readonly CHARACTER_VARIANTS: [string, string][] = [
    // Ligatures
    ['ae', 'æ'],
    ['Ae', 'Æ'],
    ['AE', 'Æ'],
    ['oe', 'œ'],
    ['Oe', 'Œ'],
    ['OE', 'Œ'],
    // Long s (archaic)
    ['s', 'ſ'],
    // Eth and thorn (Old English, rare in KJV but possible)
    ['th', 'ð'],
    ['Th', 'Ð'],
  ];

  /**
   * Generate a variant query by replacing ASCII sequences with Unicode equivalents
   * and vice versa. Returns null if no variants are possible.
   *
   * For example:
   * - "Aenon" -> "Ænon" (ae->æ)
   * - "Ænon" -> "Aenon" (æ->ae)
   * - "oeconomy" -> "œconomy" (oe->œ)
   */
  private generateCharacterVariantQuery(query: string): string | null {
    let variantQuery = query;
    let hasVariant = false;
    const usedUnicodeChars = new Set<string>();

    for (const [ascii, unicode] of BibleSearchService.CHARACTER_VARIANTS) {
      // Skip the generic 's' -> 'ſ' mapping unless the query explicitly contains ſ
      if (ascii === 's' && !query.includes('ſ')) {
        continue;
      }
      if (ascii === 's' && query.includes('ſ')) {
        variantQuery = variantQuery.replace(/ſ/g, 's');
        hasVariant = true;
        continue;
      }

      // Skip if this unicode char was already introduced by a previous mapping
      // (prevents e.g. 'AE'->'Æ' from reversing a prior 'Ae'->'Æ' replacement)
      if (usedUnicodeChars.has(unicode)) {
        continue;
      }

      if (variantQuery.includes(ascii)) {
        variantQuery = variantQuery.replace(new RegExp(this.escapeRegExp(ascii), 'g'), unicode);
        hasVariant = true;
        usedUnicodeChars.add(unicode);
      } else if (variantQuery.includes(unicode)) {
        variantQuery = variantQuery.replace(new RegExp(this.escapeRegExp(unicode), 'g'), ascii);
        hasVariant = true;
      }
    }

    return hasVariant ? variantQuery : null;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ========================================================================
  // Verse Distance Calculation (for Verse Proximity Search)
  // ========================================================================

  /**
   * Calculate the number of verses between two verse IDs
   * Returns the absolute distance in verses, or Infinity if in different books
   *
   * Examples:
   * - John 3:16 to John 3:18 = 2 verses
   * - John 3:36 to John 4:3 = distance across chapter boundary
   *
   * @param verseId1 First verse ID
   * @param verseId2 Second verse ID
   * @returns Number of verses between them (0 if same verse, Infinity if different books)
   */
  private countVersesBetween(verseId1: VerseId, verseId2: VerseId): number {
    const v1 = VerseIdHelper.parse(verseId1);
    const v2 = VerseIdHelper.parse(verseId2);

    // Different books = not in proximity
    if (v1.bookNumber !== v2.bookNumber) {
      return Infinity;
    }

    // Same chapter = simple verse difference
    if (v1.chapter === v2.chapter) {
      return Math.abs(v1.verse - v2.verse);
    }

    // Different chapters - need to count verses across chapters
    // Ensure v1 is before v2 for easier calculation
    const [first, second] = v1.chapter < v2.chapter ? [v1, v2] : [v2, v1];

    // Get chapter info for this book
    const chapterInfoList = this.bibleBookRepo.getChapterInfoByBookNumber(first.bookNumber);
    if (chapterInfoList.length === 0) {
      // Fallback: can't calculate precisely, use large number
      return Infinity;
    }

    // Build a map of chapter -> verse count
    const chapterMap = new Map<number, number>();
    for (const info of chapterInfoList) {
      chapterMap.set(info.chapter, info.verseCount);
    }

    let distance = 0;

    // Count verses from first.verse to end of first.chapter
    const firstChapterVerseCount = chapterMap.get(first.chapter) ?? 0;
    distance += firstChapterVerseCount - first.verse;

    // Count all verses in middle chapters
    for (let ch = first.chapter + 1; ch < second.chapter; ch++) {
      distance += chapterMap.get(ch) ?? 0;
    }

    // Count verses from start of second.chapter to second.verse
    distance += second.verse;

    return distance;
  }

  /**
   * Check if two verse IDs are within a specified verse distance
   *
   * @param verseId1 First verse ID
   * @param verseId2 Second verse ID
   * @param maxDistance Maximum verse distance allowed
   * @returns true if verses are within distance, false otherwise
   */
  private isWithinVerseDistance(verseId1: VerseId, verseId2: VerseId, maxDistance: number): boolean {
    return this.countVersesBetween(verseId1, verseId2) <= maxDistance;
  }

  // ========================================================================
  // ISearchService Interface Methods
  // ========================================================================

  /**
   * Get search suggestions for auto-complete based on search history and spelling.
   *
   * @param partialQuery - The partial query typed so far
   * @param limit - Maximum number of suggestions to return (default 10)
   * @returns Array of suggested query strings
   */
  async getSuggestions(partialQuery: string, _limit: number = 10): Promise<string[]> {
    return this.parser.getSuggestions(partialQuery);
  }

  /**
   * Get the proximity search index status for one or more modules.
   * Reports how many of the 66 books are indexed for each module.
   *
   * @param modules - Array of module abbreviations to check
   * @returns Map of module abbreviation to index status
   */
  async getIndexStatus(modules: string[]): Promise<Map<string, {
    indexed: boolean;
    lastIndexed?: string;
    booksIndexed?: number;
    totalBooks?: number;
  }>> {
    const statusMap = new Map();

    for (const moduleAbbr of modules) {
      const repo = this.bibleModules.get(moduleAbbr);
      if (!repo) continue;

      const totalBooks = 66;
      let booksIndexed = 0;
      let lastIndexed: string | undefined;

      // Check each book's index status at module level
      for (let bookNumber = 1; bookNumber <= totalBooks; bookNumber++) {
        if (repo.isBookIndexed(bookNumber)) {
          booksIndexed++;
        }
      }

      statusMap.set(moduleAbbr, {
        indexed: booksIndexed === totalBooks,
        lastIndexed,
        booksIndexed,
        totalBooks,
      });
    }

    return statusMap;
  }

  /**
   * Build the proximity search index for a module.
   * Indexes book-level concatenated text and verse position mappings into FTS5.
   *
   * @param module - Module abbreviation (e.g., "KJV")
   * @param books - Optional array of book numbers to index (default: all 66 books)
   * @param onProgress - Optional callback invoked after each book is indexed
   * @throws Error if the module is not registered
   */
  async buildIndex(
    module: string,
    books?: number[],
    onProgress?: (progress: { current: number; total: number; bookName: string }) => void
  ): Promise<void> {
    const repo = this.bibleModules.get(module);
    if (!repo) {
      throw new Error(`Module not found: ${module}`);
    }

    const booksToIndex = books || Array.from({ length: 66 }, (_, i) => i + 1);

    for (let i = 0; i < booksToIndex.length; i++) {
      const bookNumber = booksToIndex[i];
      const bookInfo = this.bibleBookRepo.getByBookNumber(bookNumber);

      // Report progress
      if (onProgress) {
        onProgress({
          current: i + 1,
          total: booksToIndex.length,
          bookName: bookInfo?.bookName || `Book ${bookNumber}`,
        });
      }

      // Index the book
      await this.indexBook(module, bookNumber, repo);
    }
  }
}
