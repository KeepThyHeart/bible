import { ParsedQuery, BooleanExpression } from '../types/search';
import { KeywordQuery } from '../Data/Access/KeywordTypes';

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
/** Options for {@link SearchQueryParser.parse}. */
export interface ParseOptions {
  /**
   * Recognise `&&` (and), `||` (or) and `!` (not), with parentheses, as boolean
   * operators. Off by default: ordinary search treats those characters as text.
   */
  symbolOperators?: boolean;
  /**
   * Accept `/pattern/` as a regular-expression search. On by default (the
   * desktop app offers it); `false` makes such a query throw a
   * {@link SearchQueryRejectedError} instead (W-001: on a shared server a
   * user-supplied pattern such as `/^(\w+\s?)*$/` backtracks catastrophically
   * against every verse and hangs the event loop).
   */
  allowRegex?: boolean;
}

/** Message of the error a `/pattern/` query raises when `allowRegex` is false. */
export const PATTERN_SEARCH_DISABLED_MESSAGE = 'Pattern (regular expression) search is not available here';

/**
 * A well-formed query this caller has chosen not to run (W-001). Distinct from
 * the syntax errors `validate()` reports, so a server can answer it with a 400
 * by `code` rather than by matching message text.
 */
export class SearchQueryRejectedError extends Error {
  readonly code = 'SEARCH_QUERY_REJECTED';
  constructor(message: string) {
    super(message);
    this.name = 'SearchQueryRejectedError';
  }
}

/** `~N` + `v` at the end of a query (verse proximity); see `matchProximitySuffix` (W-008). */
const VERSE_PROXIMITY_SUFFIX = /~(\d+)v$/i;
/** `~N` or `~Nw` at the end of a query (word proximity). */
const WORD_PROXIMITY_SUFFIX = /~(\d+)w?$/i;

/** Operator tokens in symbol mode. */
const SYMBOL_OPERATORS = { AND: '&&', OR: '||', NOT: '!' } as const;

interface Cursor {
  index: number;
  /** Symbol mode: operators are `&&` `||` `!`, and the words AND/OR/NOT are plain words. */
  symbols: boolean;
}

export class SearchQueryParser {
  /**
   * Main parsing method
   * Analyzes query and determines search type and components
   */
  parse(query: string, options: ParseOptions = {}): ParsedQuery {
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
      if (options.allowRegex === false) {
        throw new SearchQueryRejectedError(PATTERN_SEARCH_DISABLED_MESSAGE);
      }
      return {
        originalQuery: trimmedQuery,
        searchType: 'regex',
        regex: regexMatch[1],
      };
    }

    // Check for verse proximity search (~Nv)
    const verseProximityMatch = this.matchProximitySuffix(trimmedQuery, VERSE_PROXIMITY_SUFFIX);
    if (verseProximityMatch) {
      const terms = this.extractTerms(verseProximityMatch.head);
      const distance = parseInt(verseProximityMatch.distance, 10);

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
    const proximityMatch = this.matchProximitySuffix(trimmedQuery, WORD_PROXIMITY_SUFFIX);
    if (proximityMatch) {
      const terms = this.extractTerms(proximityMatch.head);
      const distance = parseInt(proximityMatch.distance, 10);

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

    // Symbol operators (&&, ||, !), advanced search only (B-017). Words AND/OR/NOT
    // stay ordinary words in this mode, so "faith and works && love" searches the
    // word "and" like any other.
    if (options.symbolOperators && this.hasSymbolOperators(trimmedQuery)) {
      return {
        originalQuery: trimmedQuery,
        searchType: 'boolean',
        boolean: this.parseBooleanExpression(trimmedQuery, true),
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

    // `+word` / `-word` (and `-"a phrase"`): required and excluded terms, as the
    // Advanced Search hint documents. Without this the sign was quoted away
    // ("-hate" searched for `hate`), so an exclusion behaved like an inclusion.
    const signed = this.parseSignedTerms(trimmedQuery);
    if (signed) {
      return {
        originalQuery: trimmedQuery,
        searchType: 'boolean',
        boolean: signed,
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
   * Parse raw user search input into a provider-neutral `KeywordQuery` (M1,
   * task 0026 subtask M2) instead of `parse()`'s `ParsedQuery`.
   *
   * Only the search types that resolve to a single full-text query have a
   * `KeywordQuery` shape: multi-word -> terms, phrase -> phrase, word
   * proximity -> near, and boolean -> boolean. Fuzzy (`~word`) maps to prefix,
   * matching how this service actually implements it today (a trailing-`*`
   * wildcard pattern, see `buildFuzzyPattern` in `BibleSearchService`) rather
   * than true edit-distance matching.
   *
   * Verse proximity has no `KeywordQuery` equivalent: it is evaluated as
   * several independent term lookups plus JS-side verse-distance math, never
   * as one query. Regex and Strong's-number searches are not full-text
   * queries at all. `parse()` remains the entry point for those.
   *
   * @throws Error if `query` is empty (same as `parse()`), or if it parses to
   *         a search type with no `KeywordQuery` equivalent.
   */
  toKeywordQuery(query: string): KeywordQuery {
    const parsed = this.parse(query);

    switch (parsed.searchType) {
      case 'multi-word':
        return { kind: 'terms', terms: parsed.terms || [], all: true };

      case 'phrase':
        return { kind: 'phrase', phrase: parsed.phrase || '' };

      case 'proximity':
        return {
          kind: 'near',
          terms: parsed.proximity?.terms || [],
          distance: parsed.proximity?.distance ?? 10,
        };

      case 'fuzzy':
        return { kind: 'prefix', stem: parsed.fuzzy?.term || '' };

      case 'boolean':
        // parse() only sets searchType: 'boolean' alongside a populated
        // `boolean` field, so this is unreachable in practice; the check
        // keeps the function total rather than trusting that invariant.
        if (!parsed.boolean) {
          throw new Error(`Boolean query failed to parse: ${query}`);
        }
        return { kind: 'boolean', expr: parsed.boolean };

      default:
        throw new Error(
          `"${parsed.searchType}" search has no KeywordQuery equivalent - it is not a single full-text query`
        );
    }
  }

  /**
   * Parse a query with `-word` exclusions (and optional `+word` requirements)
   * into `((required terms) NOT excluded) NOT ...`, or null when it has no
   * exclusion or nothing positive to exclude from. A sign only counts at the
   * start of a token outside quotes and when something follows it, so
   * hyphenated words ("well-beloved") and a lone "-" are untouched.
   */
  private parseSignedTerms(query: string): BooleanExpression | null {
    const tokens = query.match(/[+-]?"[^"]*"|\S+/g) ?? [];
    const positives: string[] = [];
    const excluded: string[] = [];
    for (const token of tokens) {
      const sign = token[0];
      const body = token.slice(1);
      if ((sign === '-' || sign === '+') && body.length > 0 && body !== '"') {
        (sign === '-' ? excluded : positives).push(body);
      } else {
        positives.push(token);
      }
    }
    if (excluded.length === 0 || positives.length === 0) return null;

    let expr: BooleanExpression | string = positives.join(' ');
    for (const term of excluded) {
      expr = { operator: 'NOT', left: expr, right: term };
    }
    return expr as BooleanExpression;
  }

  /**
   * Split `<terms> <whitespace> ~N` (with the unit `suffix` allows) into the
   * terms and the distance, or null when the query does not end that way.
   *
   * W-008: this was `/(.+?)\s+~(\d+)v$/` (and `...w?$`). Unanchored, with a
   * lazy group and `\s+` both able to take the same spaces, it backtracked
   * cubically on a run of whitespace: "a" + 510 spaces + "b" took ~190 ms a
   * regex. The suffix is now found on its own (one `~`, its digits, the unit,
   * end of input: linear), and the rest is plain string work that gives the
   * same answer the old regex did:
   * - the `~` must follow whitespace (`\s+`);
   * - the head is everything before that whitespace run (the lazy group
   *   stopped as early as `\s+~N$` let it, i.e. before the whole run);
   * - `.` never matched a line terminator, so the old match began after the
   *   head's last one, and only that last line's words were the terms.
   */
  private matchProximitySuffix(query: string, suffix: RegExp): { head: string; distance: string } | null {
    const match = suffix.exec(query);
    if (!match || match.index === 0 || !/\s/.test(query[match.index - 1])) return null;
    const trimmedHead = query.slice(0, match.index).trimEnd();
    let lineStart = 0;
    for (let i = trimmedHead.length - 1; i >= 0; i--) {
      const ch = trimmedHead[i];
      if (ch === '\n' || ch === '\r' || ch === ' ' || ch === ' ') { lineStart = i + 1; break; }
    }
    const head = trimmedHead.slice(lineStart);
    if (head.length === 0) return null;
    return { head, distance: match[1] };
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
  private parseBooleanExpression(query: string, symbols = false): BooleanExpression {
    const tokens = symbols ? this.tokenizeSymbols(query) : this.tokenizeBoolean(query);
    const cursor: Cursor = { index: 0, symbols };
    const parsed = tokens.length > 0 ? this.parseOrExpression(tokens, cursor) : '';

    // Trailing tokens mean unbalanced parentheses or a stray operator. Rather
    // than throw at the user, fall back to treating the whole query as one
    // leaf, which is what an ordinary multi-word search would have done.
    if (cursor.index < tokens.length) {
      return { operator: 'AND', left: this.stripGrouping(query, symbols) };
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

  private isOperator(token: string | undefined, operator: 'AND' | 'OR' | 'NOT', symbols: boolean): boolean {
    if (token === undefined) return false;
    return symbols ? token === SYMBOL_OPERATORS[operator] : token.toUpperCase() === operator;
  }

  /** True when the query holds at least one symbol operator outside quotes. */
  private hasSymbolOperators(query: string): boolean {
    return this.tokenizeSymbols(query).some(
      (t) => t === SYMBOL_OPERATORS.AND || t === SYMBOL_OPERATORS.OR || t === SYMBOL_OPERATORS.NOT
    );
  }

  /**
   * Tokenizer for symbol mode: parentheses, quoted phrases (kept whole, so a
   * `&&` inside quotes is text), the operators `&&` and `||`, a `!` that begins
   * a token (`!hate`, `! hate`, `!(a b)`), and bare words. A `!`, `&` or `|`
   * inside or at the end of a word stays part of it ("wait!").
   */
  private tokenizeSymbols(query: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    const n = query.length;
    while (i < n) {
      const ch = query[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '(' || ch === ')') { tokens.push(ch); i++; continue; }
      if (ch === '"') {
        const close = query.indexOf('"', i + 1);
        const end = close === -1 ? n : close + 1;
        tokens.push(query.slice(i, end));
        i = end;
        continue;
      }
      if (query.startsWith('&&', i)) { tokens.push('&&'); i += 2; continue; }
      if (query.startsWith('||', i)) { tokens.push('||'); i += 2; continue; }
      if (ch === '!') { tokens.push('!'); i++; continue; }
      let j = i;
      while (j < n && !/[\s()"]/.test(query[j]) && !query.startsWith('&&', j) && !query.startsWith('||', j)) j++;
      tokens.push(query.slice(i, j));
      i = j;
    }
    return tokens;
  }

  private parseOrExpression(
    tokens: string[],
    cursor: Cursor
  ): BooleanExpression | string {
    let left = this.parseAndExpression(tokens, cursor);

    while (this.isOperator(tokens[cursor.index], 'OR', cursor.symbols)) {
      cursor.index++;
      const right = this.parseAndExpression(tokens, cursor);
      left = { operator: 'OR', left, right };
    }

    return left;
  }

  private parseAndExpression(
    tokens: string[],
    cursor: Cursor
  ): BooleanExpression | string {
    let left = this.parseUnaryExpression(tokens, cursor);

    // `a NOT b` is the binary exclusion form, which FTS5 supports directly.
    // It sits at the same precedence as AND so that `a AND b NOT c` groups
    // left to right, the way a reader expects.
    while (this.isOperator(tokens[cursor.index], 'AND', cursor.symbols) || this.isOperator(tokens[cursor.index], 'NOT', cursor.symbols)) {
      const operator: 'AND' | 'NOT' = this.isOperator(tokens[cursor.index], 'AND', cursor.symbols) ? 'AND' : 'NOT';
      cursor.index++;
      const right = this.parseUnaryExpression(tokens, cursor);
      left = { operator, left, right };
    }

    return left;
  }

  private parseUnaryExpression(
    tokens: string[],
    cursor: Cursor
  ): BooleanExpression | string {
    if (this.isOperator(tokens[cursor.index], 'NOT', cursor.symbols)) {
      cursor.index++;
      return { operator: 'NOT', left: this.parseUnaryExpression(tokens, cursor) };
    }

    return this.parsePrimaryExpression(tokens, cursor);
  }

  private parsePrimaryExpression(
    tokens: string[],
    cursor: Cursor
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
      if (this.isOperator(token, 'AND', cursor.symbols) || this.isOperator(token, 'OR', cursor.symbols) || this.isOperator(token, 'NOT', cursor.symbols)) break;
      words.push(token);
      cursor.index++;
    }

    return words.join(' ');
  }

  /** Remove grouping characters for the give-up path, where they cannot help. */
  private stripGrouping(query: string, symbols = false): string {
    const plain = symbols
      ? this.tokenizeSymbols(query).filter((t) => t !== '(' && t !== ')' && t !== '&&' && t !== '||' && t !== '!').join(' ')
      : query.replace(/[()]/g, ' ');
    return plain.replace(/\s+/g, ' ').trim();
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
    // Simple heuristic: a word (any script) then a number. Scripts written
    // without spaces (CJK) may run the book straight into the number:
    // "约翰福音3:16".
    const referencePattern = /^[123]?\s*[\p{L}\p{M}]+(?:\s+|(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]))\p{Nd}+/u;
    return referencePattern.test(query.trim());
  }

  /**
   * Validate search query
   * Returns error message if invalid, undefined if valid
   */
  validate(query: string, options: ParseOptions = {}): string | undefined {
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

    // Check for invalid regex. Not when patterns are refused outright: parse()
    // then rejects the query whatever it holds (W-001).
    const regexMatch = query.match(/^\/(.+)\/$/);
    if (regexMatch && options.allowRegex !== false) {
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
