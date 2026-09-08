/**
 * Tiny parser + evaluator for `when` clauses.
 *
 * Grammar (kept intentionally minimal - see spec sectionWhenExpressionParser):
 *
 *   expr        := orExpr
 *   orExpr      := andExpr ('||' andExpr)*
 *   andExpr     := unaryExpr ('&&' unaryExpr)*
 *   unaryExpr   := '!' unaryExpr | comparison
 *   comparison  := primary (('==' | '!=' | '>' | '>=' | '<' | '<=') primary)?
 *   primary     := identifier | literal | '(' expr ')'
 *   identifier  := [a-zA-Z_][a-zA-Z_0-9.]*
 *   literal     := stringLiteral | numberLiteral | 'true' | 'false' | 'null'
 *
 * Resolution rules:
 *  - A bare identifier with no comparison is coerced to boolean.
 *  - Comparison against a missing key returns `false` (never `undefined`).
 *  - Malformed expressions return `false` rather than throwing - the goal is
 *    "the menu item disappears", not "the app crashes".
 *
 * Explicitly NOT supported: function calls, ternary, regex, `in`,
 * array/object literals. Resist the temptation to grow the grammar.
 */

import type { WhenContextValue } from './IWhenContextService';

export type LookupFn = (key: string) => WhenContextValue | undefined;

type Token =
  | { type: 'IDENT'; value: string }
  | { type: 'NUMBER'; value: number }
  | { type: 'STRING'; value: string }
  | { type: 'BOOL'; value: boolean }
  | { type: 'NULL' }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'NOT' }
  | { type: 'AND' }
  | { type: 'OR' }
  | { type: 'EQ' }
  | { type: 'NEQ' }
  | { type: 'GT' }
  | { type: 'GTE' }
  | { type: 'LT' }
  | { type: 'LTE' }
  | { type: 'EOF' };

type Node =
  | { kind: 'or'; left: Node; right: Node }
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'not'; expr: Node }
  | {
      kind: 'cmp';
      op: '==' | '!=' | '>' | '>=' | '<' | '<=';
      left: Node;
      right: Node;
    }
  | { kind: 'ident'; name: string }
  | { kind: 'literal'; value: WhenContextValue };

class ParseError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;
  while (i < len) {
    const c = input[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }
    if (c === '!' && input[i + 1] === '=') {
      tokens.push({ type: 'NEQ' });
      i += 2;
      continue;
    }
    if (c === '!') {
      tokens.push({ type: 'NOT' });
      i++;
      continue;
    }
    if (c === '=' && input[i + 1] === '=') {
      tokens.push({ type: 'EQ' });
      i += 2;
      continue;
    }
    if (c === '>' && input[i + 1] === '=') {
      tokens.push({ type: 'GTE' });
      i += 2;
      continue;
    }
    if (c === '<' && input[i + 1] === '=') {
      tokens.push({ type: 'LTE' });
      i += 2;
      continue;
    }
    if (c === '>') {
      tokens.push({ type: 'GT' });
      i++;
      continue;
    }
    if (c === '<') {
      tokens.push({ type: 'LT' });
      i++;
      continue;
    }
    if (c === '&' && input[i + 1] === '&') {
      tokens.push({ type: 'AND' });
      i += 2;
      continue;
    }
    if (c === '|' && input[i + 1] === '|') {
      tokens.push({ type: 'OR' });
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < len && input[j] !== quote) j++;
      if (j >= len) throw new ParseError('Unterminated string literal');
      tokens.push({ type: 'STRING', value: input.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '-' && input[i + 1] && input[i + 1]! >= '0' && input[i + 1]! <= '9')) {
      let j = i + 1;
      while (j < len && ((input[j]! >= '0' && input[j]! <= '9') || input[j] === '.')) j++;
      const num = parseFloat(input.slice(i, j));
      if (Number.isNaN(num)) throw new ParseError(`Invalid number at ${i}`);
      tokens.push({ type: 'NUMBER', value: num });
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i + 1;
      while (
        j < len &&
        ((input[j]! >= 'a' && input[j]! <= 'z') ||
          (input[j]! >= 'A' && input[j]! <= 'Z') ||
          (input[j]! >= '0' && input[j]! <= '9') ||
          input[j] === '_' ||
          input[j] === '.')
      ) {
        j++;
      }
      const word = input.slice(i, j);
      if (word === 'true') tokens.push({ type: 'BOOL', value: true });
      else if (word === 'false') tokens.push({ type: 'BOOL', value: false });
      else if (word === 'null') tokens.push({ type: 'NULL' });
      else tokens.push({ type: 'IDENT', value: word });
      i = j;
      continue;
    }
    throw new ParseError(`Unexpected character ${JSON.stringify(c)} at ${i}`);
  }
  tokens.push({ type: 'EOF' });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }
  private consume(): Token {
    return this.tokens[this.pos++]!;
  }

  parse(): Node {
    const node = this.parseOr();
    if (this.peek().type !== 'EOF') {
      throw new ParseError(`Trailing tokens at position ${this.pos}`);
    }
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek().type === 'OR') {
      this.consume();
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseUnary();
    while (this.peek().type === 'AND') {
      this.consume();
      const right = this.parseUnary();
      left = { kind: 'and', left, right };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.peek().type === 'NOT') {
      this.consume();
      return { kind: 'not', expr: this.parseUnary() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parsePrimary();
    const t = this.peek();
    let op: '==' | '!=' | '>' | '>=' | '<' | '<=' | null = null;
    switch (t.type) {
      case 'EQ': op = '=='; break;
      case 'NEQ': op = '!='; break;
      case 'GT': op = '>'; break;
      case 'GTE': op = '>='; break;
      case 'LT': op = '<'; break;
      case 'LTE': op = '<='; break;
      default: break;
    }
    if (op) {
      this.consume();
      const right = this.parsePrimary();
      return { kind: 'cmp', op, left, right };
    }
    return left;
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (t.type === 'LPAREN') {
      this.consume();
      const inner = this.parseOr();
      if (this.peek().type !== 'RPAREN') {
        throw new ParseError('Expected )');
      }
      this.consume();
      return inner;
    }
    if (t.type === 'IDENT') {
      this.consume();
      return { kind: 'ident', name: t.value };
    }
    if (t.type === 'NUMBER') {
      this.consume();
      return { kind: 'literal', value: t.value };
    }
    if (t.type === 'STRING') {
      this.consume();
      return { kind: 'literal', value: t.value };
    }
    if (t.type === 'BOOL') {
      this.consume();
      return { kind: 'literal', value: t.value };
    }
    if (t.type === 'NULL') {
      this.consume();
      return { kind: 'literal', value: null };
    }
    throw new ParseError(`Unexpected token ${t.type}`);
  }
}

function evalNode(node: Node, lookup: LookupFn): WhenContextValue | undefined {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'ident':
      return lookup(node.name);
    case 'not':
      return !toBool(evalNode(node.expr, lookup));
    case 'and':
      return toBool(evalNode(node.left, lookup)) && toBool(evalNode(node.right, lookup));
    case 'or':
      return toBool(evalNode(node.left, lookup)) || toBool(evalNode(node.right, lookup));
    case 'cmp': {
      const l = evalNode(node.left, lookup);
      const r = evalNode(node.right, lookup);
      // Comparison against missing key always false (per spec).
      if (l === undefined || r === undefined) return false;
      switch (node.op) {
        case '==': return l === r;
        case '!=': return l !== r;
        case '>': return (l as number) > (r as number);
        case '>=': return (l as number) >= (r as number);
        case '<': return (l as number) < (r as number);
        case '<=': return (l as number) <= (r as number);
      }
    }
  }
}

function toBool(v: WhenContextValue | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return false;
}

const cache = new Map<string, Node | null>(); // null means parse-failed; cache the failure too

function compile(expression: string): Node | null {
  if (cache.has(expression)) return cache.get(expression)!;
  try {
    const tokens = tokenize(expression);
    const node = new Parser(tokens).parse();
    cache.set(expression, node);
    return node;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[when] failed to parse expression ${JSON.stringify(expression)}:`, (err as Error).message);
    cache.set(expression, null);
    return null;
  }
}

/**
 * Evaluate a when-expression against a lookup function. Returns `false` for
 * malformed expressions and for any expression that references missing keys
 * via comparison.
 */
export function evaluateWhen(expression: string, lookup: LookupFn): boolean {
  const trimmed = expression.trim();
  if (!trimmed) return true; // empty when-clause = always allowed
  const node = compile(trimmed);
  if (!node) return false;
  try {
    return toBool(evalNode(node, lookup));
  } catch {
    return false;
  }
}

/** Test-only: clear the parser cache between test cases. */
export function _resetWhenParserCache(): void {
  cache.clear();
}
