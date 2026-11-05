import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { SearchQueryParser } from './SearchQueryParser';
import { compileKeywordQuery } from '../Data/Access/Fts5/Fts5QueryCompiler';

/**
 * Operator behaviour end to end against a real FTS5 table: the user's text goes
 * through the parser, then the compiler, then MATCH (desktop UI review D6).
 */
const VERSES = [
  'love the lord hate evil',
  'love one another with faith',
  'faith hope and love abide',
  'hate is not love',
  'faith and then many words go by before the last word hope',
  'only love here',
];

describe('keyword operators through parser + FTS5', () => {
  const parser = new SearchQueryParser();
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(':memory:');
    db.exec(`CREATE VIRTUAL TABLE kw USING fts5(text, tokenize='porter unicode61')`);
    const ins = db.prepare('INSERT INTO kw(text) VALUES (?)');
    for (const v of VERSES) ins.run(v);
  });
  afterAll(() => db.close());

  function run(query: string): string[] {
    const kq = parser.toKeywordQuery(query);
    const match = compileKeywordQuery(kq);
    return (db.prepare('SELECT text FROM kw WHERE kw MATCH ?').all(match) as { text: string }[]).map(r => r.text);
  }
  function runSymbols(query: string): string[] {
    const parsed = parser.parse(query, { symbolOperators: true });
    const match = compileKeywordQuery({ kind: 'boolean', expr: parsed.boolean! });
    return (db.prepare('SELECT text FROM kw WHERE kw MATCH ?').all(match) as { text: string }[]).map(r => r.text);
  }

  it('-word excludes instead of including', () => {
    const rows = run('love -hate');
    expect(rows.length).toBe(3);
    expect(rows).toContain('love one another with faith');
    for (const r of rows) expect(r).not.toMatch(/hate/);
  });

  it('+word terms are required together with exclusions', () => {
    const rows = run('+love +faith -hope');
    expect(rows).toEqual(['love one another with faith']);
  });

  it('a quoted phrase can be combined with -word', () => {
    expect(run('"love one"')).toEqual(['love one another with faith']);
    expect(run('"love one" -hate')).toEqual(['love one another with faith']);
    expect(run('"love one" -faith')).toEqual([]);
  });

  it('-"phrase" excludes a phrase', () => {
    const rows = run('love -"lord hate"');
    expect(rows).not.toContain('love the lord hate evil');
    expect(rows).toContain('only love here');
  });

  it('&&, || and ! behave in symbol mode', () => {
    expect(runSymbols('love && hate').sort()).toEqual(['hate is not love', 'love the lord hate evil'].sort());
    expect(runSymbols('love && !hate')).not.toContain('love the lord hate evil');
    expect(runSymbols('love && !hate')).toContain('only love here');
    expect(runSymbols('hope || evil').length).toBe(3);
  });

  // W-008 keeps the glued form ("faith~5") as plain text on purpose; only the spaced suffix is proximity.
  it('the spaced ~N suffix is proximity; the glued form is not', () => {
    const two = parser.parse('faith hope ~3');
    expect(two.searchType).toBe('proximity');
    expect(two.proximity).toEqual({ terms: ['faith', 'hope'], distance: 3 });
    expect(parser.parse('faith~5').searchType).not.toBe('proximity');
  });

  it('near: terms within the distance match, those far apart do not', () => {
    const near = (d: number) =>
      db
        .prepare('SELECT text FROM kw WHERE kw MATCH ?')
        .all(compileKeywordQuery({ kind: 'near', terms: ['faith', 'hope'], distance: d })) as { text: string }[];
    expect(near(5).map(r => r.text)).toEqual(['faith hope and love abide']);
    expect(near(20).length).toBe(2);
  });

  it('leaves hyphenated words and a lone minus alone', () => {
    expect(parser.parse('well-beloved').searchType).toBe('multi-word');
    expect(parser.parse('love - hate').searchType).toBe('multi-word');
    expect(parser.parse('-hate').searchType).toBe('multi-word');
  });
});
