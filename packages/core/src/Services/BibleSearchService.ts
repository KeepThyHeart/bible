import { ISearchService } from './ISearchService';
import { SearchQueryParser } from './SearchQueryParser';
import { escapeFts5Term } from './FtsQuery';
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

  constructor(
    private bibleModules: Map<string, IBibleRepository>,
    private bibleBookRepo: IBibleBookRepository
  ) {
    this.parser = new SearchQueryParser();
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
    }
  }

  /**
   * Get list of currently registered module abbreviations
   */
  getRegisteredModules(): string[] {
    return Array.from(this.bibleModules.keys());
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
    const allResults: SearchResult[] = [];

    for (const [moduleAbbr, repo] of modules) {
      // Escape FTS5 special characters in each term
      const escapedTerms = terms.map(term => this.escapeFTS5(term));

      // FTS5 defaults to OR when terms are space-separated; explicit AND ensures
      // all terms must appear in the verse (matching user expectation for multi-word search).
      const fts5Query = escapedTerms.join(' AND ');

      // Search using verse-level FTS5 with highlighting
      const results = repo.searchVersesWithHighlighting(fts5Query, { limit: options.maxResults || 200 });

      // Pre-filter by range here as well as centrally in search(): each surviving
      // row costs an awaited highlight conversion below, so discarding
      // out-of-range rows first is worth it on a whole-Bible FTS hit.
      const filteredResults = options.range
        ? results.filter(result => this.isVerseInRange(result.verse.verseId, options.range!))
        : results;

      // Convert to SearchResult objects using FTS5 highlighting
      for (const result of filteredResults) {
        allResults.push(
          await this.verseToSearchResultWithHighlight(
            result.verse,
            result.highlightedPlainText,
            moduleAbbr,
            terms,
            'exact'
          )
        );
      }
    }

    return allResults;
  }

  /**
   * Phrase search: Exact word sequence
   * Uses verse-level FTS5 with quoted phrase
   */
  private async searchPhrase(phrase: string, options: SearchOptions): Promise<SearchResult[]> {
    const modules = this.getModulesToSearch(options);
    const allResults: SearchResult[] = [];

    for (const [moduleAbbr, repo] of modules) {
      // FTS5 phrase query with quotes
      const fts5Query = `"${phrase}"`;
      const results = repo.searchVersesWithHighlighting(fts5Query, { limit: options.maxResults || 200 });

      for (const result of results) {
        allResults.push(
          await this.verseToSearchResultWithHighlight(
            result.verse,
            result.highlightedPlainText,
            moduleAbbr,
            [phrase],
            'exact'
          )
        );
      }
    }

    return allResults;
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

    // KAN-22: Build fuzzy patterns for search if fuzzyDistance is set
    const searchPatterns = fuzzyDistance > 0
      ? terms.map(t => this.buildFuzzyPattern(t, fuzzyDistance))
      : terms;

    for (const [moduleAbbr, repo] of modules) {
      // 1. Search each term independently to build verse sets
      // Use fuzzy patterns when searching
      const termVerseMap = new Map<string, Set<VerseId>>();

      for (let i = 0; i < terms.length; i++) {
        const searchPattern = searchPatterns[i];
        const verses = repo.searchVerses(searchPattern, { limit: 10000 });
        termVerseMap.set(terms[i], new Set(verses.map(v => v.verseId)));
      }

      // 2. Check if all terms were found
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

    // KAN-22: Build fuzzy patterns for NEAR query if fuzzyDistance is set
    const searchTerms = fuzzyDistance > 0
      ? terms.map(t => this.buildFuzzyPattern(t, fuzzyDistance))
      : terms;

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

        // Build FTS5 NEAR query (with fuzzy patterns if enabled)
        const fts5Query = `NEAR(${searchTerms.join(' ')}, ${distance})`;

        // Perform proximity search (now at module level)
        const matches = repo.searchBookFTS5(bookNumber, fts5Query);

        // If we got matches, find the specific verses
        if (matches.length > 0) {
          // For NEAR queries, offsets() doesn't work, so use alternate method
          if (matches[0].offsets === '') {
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
          } else {
            // Use offsets to find matching verses (original method)
            for (const match of matches) {
              const offsets = match.offsets.split(' ').map(n => parseInt(n, 10));
              const matchPositions = new Set<number>();

              for (let i = 0; i < offsets.length; i += 4) {
                matchPositions.add(offsets[i + 2]);
              }

              // For each match position, find which verse it belongs to
              for (const position of matchPositions) {
                const verseId = repo.getVerseIdAtPosition(bookNumber, position);

                if (verseId) {
                  const versePosition = repo.getVersePosition(bookNumber, verseId);
                  let verseText = '';

                  if (versePosition) {
                    verseText = match.text.substring(versePosition.startIndex, versePosition.endIndex);
                  }

                  // KAN-22: Find actual matched words for highlighting (supports fuzzy)
                  const highlightTerms = fuzzyDistance > 0
                    ? this.findFuzzyMatchedWords(verseText, terms, fuzzyDistance)
                    : terms;
                  const finalHighlightTerms = highlightTerms.length > 0 ? highlightTerms : terms;

                  allResults.push({
                    verseId,
                    module: moduleAbbr,
                    reference: this.formatReference(verseId),
                    text: await this.highlightMatches(verseText, finalHighlightTerms),
                    matches: this.extractMatches(verseText, finalHighlightTerms),
                    score: 1.0,
                    type: fuzzyDistance > 0 ? 'fuzzy' : 'exact',
                  });
                }
              }
            }
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
    const fts5Query = this.compileBooleanToFts5(expression);

    // Only an unsatisfiable expression compiles to null - today that means a
    // bare negation such as `(NOT evil)`. FTS5's NOT is binary: it excludes
    // from a left-hand match set, and there is no "every verse" operand to
    // subtract from, so the alternative would be a full-corpus scan on a query
    // that asks for almost the whole Bible. Returning nothing is the honest
    // answer; returning the *matches* for `evil` here would be the exact
    // opposite of what was asked.
    if (fts5Query === null) return [];

    const modules = this.getModulesToSearch(options);
    const terms = this.collectPositiveTerms(expression);
    const allResults: SearchResult[] = [];

    for (const [moduleAbbr, repo] of modules) {
      const results = repo.searchVersesWithHighlighting(fts5Query, {
        limit: options.maxResults || 200,
      });

      const filteredResults = options.range
        ? results.filter(result => this.isVerseInRange(result.verse.verseId, options.range!))
        : results;

      for (const result of filteredResults) {
        allResults.push(
          await this.verseToSearchResultWithHighlight(
            result.verse,
            result.highlightedPlainText,
            moduleAbbr,
            terms,
            'exact'
          )
        );
      }
    }

    return allResults;
  }

  /**
   * Compile a parsed boolean tree into a single FTS5 MATCH expression.
   *
   * FTS5 implements AND, OR, NOT and parentheses natively, so the whole tree
   * can be handed to SQLite as one query rather than evaluated here with set
   * operations over several round trips. Every leaf goes through the same
   * escaper the other search paths use, so a term that collides with FTS5
   * syntax (`not`, an apostrophe, a hyphen) is quoted rather than reinterpreted
   * as an operator.
   *
   * Returns null when the expression cannot be expressed - see `searchBoolean`.
   */
  private compileBooleanToFts5(expression: BooleanExpression | string): string | null {
    if (typeof expression === 'string') {
      const terms = this.parser.parse(expression).terms || [];
      if (terms.length === 0) return null;
      return terms.map(term => this.escapeFTS5(term)).join(' AND ');
    }

    const { operator, left, right } = expression;

    // A unary NOT as an operand IS expressible when it has something to
    // subtract from: `faith AND NOT works` is FTS5's `faith NOT works`.
    if (operator === 'AND' && right !== undefined && this.isBareNegation(right)) {
      return this.combine(left, (right as BooleanExpression).left, 'NOT');
    }

    if (right === undefined) {
      // Unary NOT at this position has no left-hand set to exclude from.
      if (operator === 'NOT') return null;
      return this.compileBooleanToFts5(left);
    }

    // `a OR NOT b` has no FTS5 equivalent for the same reason as a bare
    // negation: the right operand is a complement, not a match set.
    if (this.isBareNegation(right)) return null;

    return this.combine(left, right, operator);
  }

  /** Is this operand a negation with nothing of its own to exclude from? */
  private isBareNegation(operand: BooleanExpression | string): boolean {
    return (
      typeof operand !== 'string' &&
      operand.operator === 'NOT' &&
      operand.right === undefined
    );
  }

  private combine(
    left: BooleanExpression | string,
    right: BooleanExpression | string,
    operator: 'AND' | 'OR' | 'NOT'
  ): string | null {
    const compiledLeft = this.compileBooleanToFts5(left);
    const compiledRight = this.compileBooleanToFts5(right);

    // An empty operand collapses rather than poisoning the whole query: for
    // AND and NOT the surviving side still constrains the result, and for OR
    // it is the only alternative left.
    if (compiledLeft === null) return operator === 'NOT' ? null : compiledRight;
    if (compiledRight === null) return compiledLeft;

    return `(${compiledLeft} ${operator} ${compiledRight})`;
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
   * Convert BibleVerse to SearchResult using FTS5 pre-highlighted text
   * This version uses the highlighting from FTS5, which correctly highlights
   * stemmed variants (e.g., searching "walk" highlights "walking", "walked")
   * Also creates a snippet that prioritizes showing the matched text
   *
   * KAN-22: For fuzzy/stem matches, we use the actual matched words from FTS5
   * (not the original search terms) to ensure the snippet shows the matched variants
   */
  private async verseToSearchResultWithHighlight(
    verse: BibleVerse,
    highlightedText: string,
    moduleAbbr: string,
    searchTerms: string[],
    matchType: MatchType
  ): Promise<SearchResult> {
    // Extract matches from the highlighted text by finding <strong><u>...</u></strong> tags
    // This captures the actual words FTS5 matched (including stemmed variants)
    const matches = this.extractMatchesFromHighlightedText(highlightedText);

    // Get plain text for snippet creation
    const text = verse.textPlain || verse.text;

    // Create a snippet that prioritizes the matched text (for live search display)
    // Only needed for longer verses where matches might not be visible at the start
    let snippet: string | undefined;
    if (text.length > 100 && matches.length > 0) {
      // KAN-22: Use the actual matched terms (extracted from FTS5 highlighting)
      // to ensure fuzzy/stem matches are properly highlighted in the snippet
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
   * Extract match positions from FTS5-highlighted text
   * Finds all <strong><u>...</u></strong> tags and extracts the matched terms and positions
   */
  private extractMatchesFromHighlightedText(highlightedText: string): Match[] {
    const matches: Match[] = [];
    let plainTextPos = 0;

    // We need to track position in the plain text (without tags)
    // as we iterate through the highlighted text
    const parts = highlightedText.split(/(<strong><u>|<\/u><\/strong>)/);
    let inMatch = false;

    for (const part of parts) {
      if (part === '<strong><u>') {
        inMatch = true;
      } else if (part === '</u></strong>') {
        inMatch = false;
      } else if (part.length > 0) {
        if (inMatch) {
          // This is a matched term
          matches.push({
            term: part,
            startPos: plainTextPos,
            endPos: plainTextPos + part.length,
          });
        }
        plainTextPos += part.length;
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

  /**
   * Escape special FTS5 characters. Shared with the dictionary search, which
   * hits the same syntax errors on apostrophes, hyphens and reserved words.
   */
  private escapeFTS5(term: string): string {
    return escapeFts5Term(term);
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
