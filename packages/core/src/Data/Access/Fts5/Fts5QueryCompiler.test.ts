import { describe, it, expect } from 'vitest';
import { escapeFts5Term, escapeFts5Query, compileKeywordQuery } from './Fts5QueryCompiler';
import { KeywordQuery } from '../KeywordTypes';

describe('escapeFts5Term', () => {
  it('leaves plain words unquoted so the stemmer still applies', () => {
    expect(escapeFts5Term('walking')).toBe('walking');
    expect(escapeFts5Term('God')).toBe('God');
  });

  it('quotes FTS5 reserved words', () => {
    expect(escapeFts5Term('not')).toBe('"not"');
    expect(escapeFts5Term('NOT')).toBe('"NOT"');
    expect(escapeFts5Term('and')).toBe('"and"');
    expect(escapeFts5Term('or')).toBe('"or"');
    expect(escapeFts5Term('near')).toBe('"near"');
  });

  it('quotes terms containing FTS5 syntax characters', () => {
    // These are the inputs that previously produced a SQLite syntax error,
    // surfacing as a 500 from the dictionary search route.
    expect(escapeFts5Term("God's")).toBe('"God\'s"');
    expect(escapeFts5Term('God-fearing')).toBe('"God-fearing"');
    expect(escapeFts5Term('foo(bar)')).toBe('"foo(bar)"');
    expect(escapeFts5Term('col:val')).toBe('"col:val"');
    expect(escapeFts5Term('star*')).toBe('"star*"');
  });

  it('doubles internal double quotes', () => {
    expect(escapeFts5Term('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('escapeFts5Query', () => {
  it('escapes each term of a phrase independently', () => {
    expect(escapeFts5Query('Jesus Christ')).toBe('Jesus Christ');
    expect(escapeFts5Query("God's mercy")).toBe('"God\'s" mercy');
  });

  it('collapses surrounding and repeated whitespace', () => {
    expect(escapeFts5Query('  Jesus   Christ  ')).toBe('Jesus Christ');
  });

  it('returns an empty string for input with no usable terms', () => {
    // Callers treat this as "no query" rather than handing it to MATCH.
    expect(escapeFts5Query('')).toBe('');
    expect(escapeFts5Query('   ')).toBe('');
  });
});

describe('compileKeywordQuery', () => {
  describe('terms', () => {
    it('AND-joins escaped terms when all is true', () => {
      const q: KeywordQuery = { kind: 'terms', terms: ['love', 'joy', 'peace'], all: true };
      expect(compileKeywordQuery(q)).toBe('love AND joy AND peace');
    });

    it('OR-joins escaped terms when all is false', () => {
      const q: KeywordQuery = { kind: 'terms', terms: ['love', 'joy'], all: false };
      expect(compileKeywordQuery(q)).toBe('love OR joy');
    });

    it('escapes each term (regression: hyphenated term no longer reaches MATCH raw)', () => {
      const q: KeywordQuery = { kind: 'terms', terms: ['long-suffering', 'faith'], all: true };
      expect(compileKeywordQuery(q)).toBe('"long-suffering" AND faith');
    });
  });

  describe('phrase', () => {
    it('quotes the whole phrase', () => {
      const q: KeywordQuery = { kind: 'phrase', phrase: 'for God so loved' };
      expect(compileKeywordQuery(q)).toBe('"for God so loved"');
    });

    it('regression: a phrase containing an apostrophe is quoted, not passed through raw', () => {
      const q: KeywordQuery = { kind: 'phrase', phrase: "God's love" };
      // Always valid FTS5 syntax: a bare, unescaped apostrophe never reaches MATCH.
      expect(compileKeywordQuery(q)).toBe('"God\'s love"');
    });

    it('doubles an embedded double quote', () => {
      const q: KeywordQuery = { kind: 'phrase', phrase: 'say "hi" now' };
      expect(compileKeywordQuery(q)).toBe('"say ""hi"" now"');
    });
  });

  describe('prefix', () => {
    it('appends a wildcard to the escaped stem', () => {
      const q: KeywordQuery = { kind: 'prefix', stem: 'believ' };
      expect(compileKeywordQuery(q)).toBe('believ*');
    });

    it('regression: a hyphenated stem is escaped before the wildcard is appended', () => {
      const q: KeywordQuery = { kind: 'prefix', stem: 'self-control' };
      expect(compileKeywordQuery(q)).toBe('"self-control"*');
    });
  });

  describe('near', () => {
    it('builds a NEAR() expression with escaped terms', () => {
      const q: KeywordQuery = { kind: 'near', terms: ['ant', 'sluggard'], distance: 10 };
      expect(compileKeywordQuery(q)).toBe('NEAR(ant sluggard, 10)');
    });

    it('regression: a NEAR query with a hyphenated term is escaped, not passed through raw', () => {
      const q: KeywordQuery = { kind: 'near', terms: ['long-suffering', 'patience'], distance: 5 };
      expect(compileKeywordQuery(q)).toBe('NEAR("long-suffering" patience, 5)');
    });
  });

  describe('boolean', () => {
    it('compiles a simple AND', () => {
      const q: KeywordQuery = { kind: 'boolean', expr: { operator: 'AND', left: 'faith', right: 'works' } };
      expect(compileKeywordQuery(q)).toBe('(faith AND works)');
    });

    it('compiles a simple OR', () => {
      const q: KeywordQuery = { kind: 'boolean', expr: { operator: 'OR', left: 'Jerusalem', right: 'Zion' } };
      expect(compileKeywordQuery(q)).toBe('(Jerusalem OR Zion)');
    });

    it('compiles the binary NOT exclusion form', () => {
      const q: KeywordQuery = { kind: 'boolean', expr: { operator: 'NOT', left: 'faith', right: 'works' } };
      expect(compileKeywordQuery(q)).toBe('(faith NOT works)');
    });

    it('compiles NOT nested inside AND to the binary exclusion form', () => {
      const q: KeywordQuery = {
        kind: 'boolean',
        expr: { operator: 'AND', left: 'faith', right: { operator: 'NOT', left: 'works' } },
      };
      expect(compileKeywordQuery(q)).toBe('(faith NOT works)');
    });

    it('compiles a nested group', () => {
      const q: KeywordQuery = {
        kind: 'boolean',
        expr: {
          operator: 'AND',
          left: 'faith',
          right: { operator: 'OR', left: 'hope', right: 'love' },
        },
      };
      expect(compileKeywordQuery(q)).toBe('(faith AND (hope OR love))');
    });

    it('returns an empty string for a bare negation with nothing to exclude from', () => {
      // Same "no usable query" convention escapeFts5Query already uses.
      const q: KeywordQuery = { kind: 'boolean', expr: { operator: 'NOT', left: 'evil' } };
      expect(compileKeywordQuery(q)).toBe('');
    });

    it('escapes special characters inside boolean leaves', () => {
      const q: KeywordQuery = {
        kind: 'boolean',
        expr: { operator: 'AND', left: "God's", right: 'long-suffering' },
      };
      expect(compileKeywordQuery(q)).toBe('("God\'s" AND "long-suffering")');
    });

    it('AND-joins a multi-word leaf (a run of bare words with no operator)', () => {
      const q: KeywordQuery = {
        kind: 'boolean',
        expr: { operator: 'OR', left: 'kingdom of heaven', right: 'kingdom of God' },
      };
      expect(compileKeywordQuery(q)).toBe('(kingdom AND of AND heaven OR kingdom AND of AND God)');
    });
  });
});
