/**
 * Fts5QueryCompiler
 *
 * The only place that writes SQLite FTS5 MATCH syntax (task 0026, revision 2,
 * subtask M2). Everything upstream of this module works with `KeywordQuery`
 * (M1's provider-neutral shape); this file compiles that shape - and nothing
 * else - into the query language this one provider (SQLite FTS5) understands.
 *
 * `escapeFts5Term`/`escapeFts5Query` moved here unchanged from the F1/M1-era
 * `Services/FtsQuery.ts` (same behaviour, same exported names - just
 * relocated so every FTS5-syntax writer lives beside them instead of a term
 * escaper living apart from the code that most needs it).
 *
 * FTS5 treats a handful of characters and bare words as query syntax rather
 * than as text. Passing raw user input straight into a MATCH expression is
 * therefore not just a wrong-results problem - an apostrophe, a hyphen, or the
 * word "not" makes SQLite raise a syntax error, which surfaces as a 500 from
 * any route that forwards the query verbatim. `compileKeywordQuery` below is
 * written so every piece of raw text it touches goes through the escaper
 * before it reaches the output string.
 */

import { KeywordQuery } from '../KeywordTypes';
import { BooleanExpression } from '../../../types/search';

/** FTS5 bare words that are query operators unless quoted. */
const FTS5_RESERVED_WORDS = ['and', 'or', 'not', 'near'];

/**
 * Escape a single search term for use inside an FTS5 MATCH expression.
 *
 * Terms that need no quoting are returned as-is so they keep the benefit of
 * FTS5's Porter stemmer - searching "walking" still matches "walk"/"walked".
 */
export function escapeFts5Term(term: string): string {
  const isReservedWord = FTS5_RESERVED_WORDS.includes(term.toLowerCase());
  // " ' ( ) : * ^ - all carry meaning in FTS5 query syntax.
  const needsQuoting = isReservedWord || /["'():*^-]/.test(term);

  if (!needsQuoting) return term;

  // Inside a quoted string, a literal double quote is written doubled.
  const escaped = term.includes('"') ? term.replace(/"/g, '""') : term;
  return `"${escaped}"`;
}

/**
 * Escape a whole user-typed phrase into an FTS5 MATCH expression by escaping
 * each whitespace-separated term. Returns an empty string when the input has no
 * usable terms, which callers should treat as "no query" rather than passing on
 * to MATCH.
 */
export function escapeFts5Query(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(term => term.length > 0)
    .map(escapeFts5Term)
    .join(' ');
}

/**
 * Quote a whole phrase for an FTS5 phrase query.
 *
 * Unlike `escapeFts5Term`, the outer quotes are unconditional: a phrase query
 * needs them even when the phrase has no character that would otherwise force
 * quoting, because it's the quotes themselves that make FTS5 treat the words
 * as one exact sequence instead of implicitly-combined bare terms. Any
 * embedded double quote is doubled, exactly as `escapeFts5Term` doubles one
 * inside a quoted term.
 */
function quoteFts5Phrase(phrase: string): string {
  const escaped = phrase.includes('"') ? phrase.replace(/"/g, '""') : phrase;
  return `"${escaped}"`;
}

/**
 * Split a boolean-expression leaf into terms, preserving quoted phrases as a
 * single term. Mirrors `SearchQueryParser`'s own term tokenizer so a leaf like
 * `kingdom of heaven` (a run of bare words with no operator between them, per
 * `SearchQueryParser`'s grammar) is escaped term-by-term rather than as one
 * over-long "term" that would only get quoted, and stemmed, as a whole.
 */
function splitLeafTerms(leaf: string): string[] {
  const terms: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(leaf)) !== null) {
    const term = match[1] ?? match[2];
    if (term.length > 0) terms.push(term);
  }

  return terms;
}

/** Is this operand a negation with nothing of its own to exclude from? */
function isBareNegation(operand: BooleanExpression | string): boolean {
  return (
    typeof operand !== 'string' &&
    operand.operator === 'NOT' &&
    operand.right === undefined
  );
}

/**
 * Compile one node of a boolean expression tree (or a leaf string) into an
 * FTS5 fragment. Returns `''` when the node has no FTS5 equivalent - see
 * `compileKeywordQuery`'s boolean case for what that means to a caller.
 */
function compileBooleanNode(node: BooleanExpression | string): string {
  if (typeof node === 'string') {
    const terms = splitLeafTerms(node);
    if (terms.length === 0) return '';
    // FTS5 defaults to OR when terms are space-separated; explicit AND
    // ensures all terms in a leaf must appear (matching ordinary multi-word
    // search semantics for a run of bare words).
    return terms.map(escapeFts5Term).join(' AND ');
  }

  const { operator, left, right } = node;

  // A unary NOT as an operand IS expressible when it has something to
  // subtract from: `faith AND NOT works` is FTS5's `faith NOT works`.
  if (operator === 'AND' && right !== undefined && isBareNegation(right)) {
    return combineBoolean(left, (right as BooleanExpression).left, 'NOT');
  }

  if (right === undefined) {
    // Unary NOT at this position has no left-hand set to exclude from.
    if (operator === 'NOT') return '';
    return compileBooleanNode(left);
  }

  // `a OR NOT b` has no FTS5 equivalent for the same reason as a bare
  // negation: the right operand is a complement, not a match set.
  if (isBareNegation(right)) return '';

  return combineBoolean(left, right, operator);
}

function combineBoolean(
  left: BooleanExpression | string,
  right: BooleanExpression | string,
  operator: 'AND' | 'OR' | 'NOT'
): string {
  const compiledLeft = compileBooleanNode(left);
  const compiledRight = compileBooleanNode(right);

  // An empty operand collapses rather than poisoning the whole query: for
  // AND and NOT the surviving side still constrains the result, and for OR
  // it is the only alternative left.
  if (compiledLeft === '') return operator === 'NOT' ? '' : compiledRight;
  if (compiledRight === '') return compiledLeft;

  return `(${compiledLeft} ${operator} ${compiledRight})`;
}

/**
 * Compile a provider-neutral `KeywordQuery` (M1) into a SQLite FTS5 MATCH
 * string. This is the "provider-neutral query -> this provider's syntax"
 * direction: every `Data/Access` caller and every FTS5-MATCH-building call
 * site in `BibleSearchService` routes through this one function instead of
 * building MATCH syntax ad hoc.
 *
 * Every term, phrase and stem passes through `escapeFts5Term` (or the
 * phrase-quoting it mirrors) before reaching the output, so a hyphen,
 * apostrophe or FTS5 reserved word never breaks the resulting MATCH syntax.
 *
 * Returns `''` only for a `'boolean'` query whose expression has no FTS5
 * equivalent (a bare negation with nothing to exclude from, e.g. `NOT evil`
 * with no left-hand match set) - the same "empty means no query" convention
 * `escapeFts5Query` already uses. `searchBoolean` in `BibleSearchService`
 * treats that result as "no results" rather than querying with it.
 */
export function compileKeywordQuery(query: KeywordQuery): string {
  switch (query.kind) {
    case 'terms': {
      const escaped = query.terms.map(escapeFts5Term);
      return escaped.join(query.all ? ' AND ' : ' OR ');
    }

    case 'phrase':
      return quoteFts5Phrase(query.phrase);

    case 'prefix':
      return `${escapeFts5Term(query.stem)}*`;

    case 'near': {
      const escaped = query.terms.map(escapeFts5Term);
      return `NEAR(${escaped.join(' ')}, ${query.distance})`;
    }

    case 'boolean':
      return compileBooleanNode(query.expr);
  }
}
