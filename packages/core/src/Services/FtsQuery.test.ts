import { describe, it, expect } from 'vitest';
import { escapeFts5Term, escapeFts5Query } from './FtsQuery';

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
