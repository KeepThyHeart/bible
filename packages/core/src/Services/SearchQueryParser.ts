import { ParsedQuery, BooleanExpression } from '../types/search';

/**
 * Search Query Parser
 *
 * Parses search queries with complex syntax including:
 * - Phrase search: "exact phrase"
 * - Word proximity search: word1 word2 ~50w or word1 word2 ~50
 * - Verse proximity search: word1 word2 ~5v
 * - Boolean operators: AND, OR, NOT with parentheses
 * - Fuzzy search: ~word
 * - Regex search: /pattern/ (advanced only)
 * - Strong's numbers: G26, H430
 *
 * Example complex query:
 * "greatest of these" hope love ~50w NOT (peace AND despair)
 *
 * This finds verses containing:
 * - The exact phrase "greatest of these"
 * - "hope" and "love" within 50 words of each other
 * - NOT containing both "peace" AND "despair"
 */
export class SearchQueryParser {
  /**
   * Main parsing method
   * Analyzes query and determines search type and components
   */
  parse(query: string): ParsedQuery {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      throw new Error('Search query cannot be empty');
    }

    // Check for Strong's number: "G25", "H7225", or "strongs:G25"
    const strongsMatch = trimmedQuery.match(/^(?:strongs:)?([GH]\d+)$/i);
    if (strongsMatch) {
      return {
        originalQuery: trimmedQuery,
        searchType: 'strongs',
        strongs: strongsMatch[1].toUpperCase(),
      };
    }

    // Check for regex pattern (enclosed in forward slashes)
    const regexMatch = trimmedQuery.match(/^\/(.+)\/$/);
    if (regexMatch) {
      return {
        originalQuery: trimmedQuery,
        searchType: 'regex',
        regex: regexMatch[1],
      };
    }

    // Check for verse proximity search (~Nv)
    const verseProximityMatch = trimmedQuery.match(/(.+?)\s+~(\d+)v$/i);
    if (verseProximityMatch) {
      const terms = this.extractTerms(verseProximityMatch[1]);
      const distance = parseInt(verseProximityMatch[2], 10);

      return {
        originalQuery: trimmedQuery,
        searchType: 'verse-proximity',
        verseProximity: {
          terms,
          distance,
        },
      };
    }

    // Check for word proximity search (~N or ~Nw)
    const proximityMatch = trimmedQuery.match(/(.+?)\s+~(\d+)w?$/i);
    if (proximityMatch) {
      const terms = this.extractTerms(proximityMatch[1]);
      const distance = parseInt(proximityMatch[2], 10);

      return {
        originalQuery: trimmedQuery,
        searchType: 'proximity',
        proximity: {
          terms,
          distance,
        },
      };
    }

    // Check for fuzzy search (starts with ~)
    const fuzzyMatch = trimmedQuery.match(/^~(\w+)$/);
    if (fuzzyMatch) {
      return {
        originalQuery: trimmedQuery,
        searchType: 'fuzzy',
        fuzzy: {
          term: fuzzyMatch[1],
          distance: 2, // Default Levenshtein distance
        },
      };
    }

    // Check for boolean operators (AND, OR, NOT)
    if (this.hasBooleanOperators(trimmedQuery)) {
      return {
        originalQuery: trimmedQuery,
        searchType: 'boolean',
        boolean: this.parseBooleanExpression(trimmedQuery),
      };
    }

    // Check if entire query is a single phrase (enclosed in quotes)
    const singlePhraseMatch = trimmedQuery.match(/^"(.+)"$/);
    if (singlePhraseMatch) {
      return {
        originalQuery: trimmedQuery,
        searchType: 'phrase',
        phrase: singlePhraseMatch[1],
      };
    }

    // Check if query contains phrases (has quotes but not only a single phrase)
    if (trimmedQuery.includes('"')) {
      // Complex query with mixed phrases and terms
      // Treat as boolean for now (will extract phrases in search service)
      return {
        originalQuery: trimmedQuery,
        searchType: 'boolean',
        boolean: this.parseBooleanExpression(trimmedQuery),
      };
    }

    // Default: multi-word search (all words must match, AND logic)
    return {
      originalQuery: trimmedQuery,
      searchType: 'multi-word',
      terms: this.extractTerms(trimmedQuery),
    };
  }

  /**
   * Extract individual terms from a query string
   * Splits on whitespace, preserving quoted phrases
   */
  private extractTerms(query: string): string[] {
    const terms: string[] = [];
    const regex = /"([^"]+)"|(\S+)/g;
    let match;

    while ((match = regex.exec(query)) !== null) {
      terms.push(match[1] || match[2]);
    }

    return terms.filter(t => t.length > 0);
  }

  /**
   * Check if query contains boolean operators
   * Boolean operators (AND, OR, NOT) are only recognized inside parentheses
   * This avoids ambiguity with common words like "not" in searches
   *
   * Examples:
   * - "believed not" -> multi-word search (no parentheses)
   * - "(faith AND works)" -> boolean search
   * - "(NOT evil)" -> boolean search with negation
   */
  private hasBooleanOperators(query: string): boolean {
    // Boolean operators only work inside parentheses
    return /[()]/.test(query);
  }

  /**
   * Parse a boolean expression into a tree.
   *
   * This is a recursive-descent parser over the grammar
   *
   *   or      := and ( 'OR' and )*
   *   and     := unary ( ( 'AND' | 'NOT' ) unary )*
   *   unary   := 'NOT' unary | primary
   *   primary := '(' or ')' | term+
   *
   * with the conventional precedence: `NOT` binds tightest, then `AND`, then
   * `OR`. A run of bare words with no operator between them is one leaf - the
   * implicit-AND behaviour of an ordinary multi-word search.
   *
   * The previous implementation matched the operators with three regexes and
   * then ran `.replace(/[()]/g, '')` over each operand, which deleted the very
   * parentheses that express grouping. `(a AND (b OR c))` came back as
   * `left: 'a', right: 'b OR c'` - a string nothing ever parsed again - so the
   * inner group was silently dropped. Operands are now `BooleanExpression`
   * nodes wherever the input nests, and strings only at the leaves.
   *
   * Leaves stay strings so that the common `(faith AND works)` shape still
   * yields `left: 'faith'`, `right: 'works'`.
   */
  private parseBooleanExpression(query: string): BooleanExpression {
    const tokens = this.tokenizeBoolean(query);
    const cursor = { index: 0 };
    const parsed = tokens.length > 0 ? this.parseOrExpression(tokens, cursor) : '';

    // Trailing tokens mean unbalanced parentheses or a stray operator. Rather
    // than throw at the user, fall back to treating the whole query as one
    // leaf, which is what an ordinary multi-word search would have done.
    if (cursor.index < tokens.length) {
      return { operator: 'AND', left: this.stripGrouping(query) };
    }

    return typeof parsed === 'string' ? { operator: 'AND', left: parsed } : parsed;
  }

  /**
   * Split a boolean query into parentheses, operators, quoted phrases and bare
   * words. Quoted phrases keep their quotes so that a leaf can be handed to the
   * FTS5 escaper intact.
   */
  private tokenizeBoolean(query: string): string[] {
    const tokens: string[] = [];
    const pattern = /\(|\)|"[^"]*"|\S+/g;
    let match;

    while ((match = pattern.exec(query)) !== null) {
      const token = match[0];
      // A bare word can arrive glued to a parenthesis ("(love"), because \S+
      // is greedy; the alternation above handles a leading paren but not one
      // in the middle of a word, so split those out here.
      if (token.length > 1 && /[()]/.test(token) && !/^"/.test(token)) {
        for (const part of token.split(/([()])/)) {
          if (part.trim().length > 0) tokens.push(part);
        }
        continue;
      }
      tokens.push(token);
    }

    return tokens;
  }

  private isOperator(token: string | undefined, operator: string): boolean {
    return token !== undefined && token.toUpperCase() === operator;
  }

  private parseOrExpression(
    tokens: string[],
    cursor: { index: number }
  ): BooleanExpression | string {
    let left = this.parseAndExpression(tokens, cursor);

    while (this.isOperator(tokens[cursor.index], 'OR')) {
      cursor.index++;
      const right = this.parseAndExpression(tokens, cursor);
      left = { operator: 'OR', left, right };
    }

    return left;
  }

  private parseAndExpression(
    tokens: string[],
    cursor: { index: number }
  ): BooleanExpression | string {
    let left = this.parseUnaryExpression(tokens, cursor);

    // `a NOT b` is the binary exclusion form, which FTS5 supports directly.
    // It sits at the same precedence as AND so that `a AND b NOT c` groups
    // left to right, the way a reader expects.
    while (this.isOperator(tokens[cursor.index], 'AND') || this.isOperator(tokens[cursor.index], 'NOT')) {
      const operator = tokens[cursor.index].toUpperCase() as 'AND' | 'NOT';
      cursor.index++;
      const right = this.parseUnaryExpression(tokens, cursor);
      left = { operator, left, right };
    }

    return left;
  }

  private parseUnaryExpression(
    tokens: string[],
    cursor: { index: number }
  ): BooleanExpression | string {
    if (this.isOperator(tokens[cursor.index], 'NOT')) {
      cursor.index++;
      return { operator: 'NOT', left: this.parseUnaryExpression(tokens, cursor) };
    }

    return this.parsePrimaryExpression(tokens, cursor);
  }

  private parsePrimaryExpression(
    tokens: string[],
    cursor: { index: number }
  ): BooleanExpression | string {
    if (tokens[cursor.index] === '(') {
      cursor.index++;
      const inner = this.parseOrExpression(tokens, cursor);
      // Tolerate a missing ')' rather than failing the whole query.
      if (tokens[cursor.index] === ')') cursor.index++;
      return inner;
    }

    // A run of consecutive words with no operator between them is one leaf.
    const words: string[] = [];
    while (cursor.index < tokens.length) {
      const token = tokens[cursor.index];
      if (token === '(' || token === ')') break;
      if (this.isOperator(token, 'AND') || this.isOperator(token, 'OR') || this.isOperator(token, 'NOT')) break;
      words.push(token);
      cursor.index++;
    }

    return words.join(' ');
  }

  /** Remove grouping characters for the give-up path, where they cannot help. */
  private stripGrouping(query: string): string {
    return query.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Extract all quoted phrases from a query
   */
  extractPhrases(query: string): string[] {
    const phrases: string[] = [];
    const regex = /"([^"]+)"/g;
    let match;

    while ((match = regex.exec(query)) !== null) {
      phrases.push(match[1]);
    }

    return phrases;
  }

  /**
   * Remove phrases from query (for extracting remaining terms)
   */
  removePhrases(query: string): string {
    return query.replace(/"[^"]+"/g, '').trim();
  }

  /**
   * Check if query is a Bible reference (for navigation vs search detection)
   * Examples: "John 3:16", "Genesis 1", "Rom 8:28-30"
   *
   * Returns true if it looks like a reference, false otherwise
   */
  isReference(query: string): boolean {
    // Simple heuristic: contains book name pattern + numbers with colons
    const referencePattern = /^[123]?\s*[a-z]+\s+\d+/i;
    return referencePattern.test(query.trim());
  }

  /**
   * Validate search query
   * Returns error message if invalid, undefined if valid
   */
  validate(query: string): string | undefined {
    if (!query || query.trim().length === 0) {
      return 'Search query cannot be empty';
    }

    // Check for unmatched quotes
    const quoteCount = (query.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      return 'Unmatched quote in search query';
    }

    // Check for unmatched parentheses
    let parenCount = 0;
    for (const char of query) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (parenCount < 0) return 'Unmatched closing parenthesis';
    }
    if (parenCount !== 0) {
      return 'Unmatched opening parenthesis';
    }

    // Check for invalid regex
    const regexMatch = query.match(/^\/(.+)\/$/);
    if (regexMatch) {
      try {
        new RegExp(regexMatch[1]);
      } catch (e) {
        return `Invalid regular expression: ${(e as Error).message}`;
      }
    }

    return undefined;
  }

  /**
   * Get suggested corrections for common misspellings
   * Useful for KJV's different spellings (neighbour vs neighbor, etc.)
   */
  getSuggestions(query: string): string[] {
    const suggestions: string[] = [];

    // Common KJV spelling variants
    const variants: Record<string, string> = {
      'neighbor': 'neighbour',
      'honor': 'honour',
      'favor': 'favour',
      'labor': 'labour',
      'savior': 'saviour',
    };

    for (const [modern, kjv] of Object.entries(variants)) {
      if (query.toLowerCase().includes(modern)) {
        suggestions.push(query.toLowerCase().replace(modern, kjv));
      }
    }

    return suggestions;
  }
}
