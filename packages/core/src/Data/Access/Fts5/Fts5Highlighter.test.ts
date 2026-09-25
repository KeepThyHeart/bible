/**
 * `Fts5Highlighter`'s own tests (task 0027, revision 2, subtask F7).
 *
 * Runs against a real, in-memory `better-sqlite3` connection - the mechanism
 * under test IS a real SQLite temp virtual table and a real `highlight()`
 * call, so nothing here is mocked. `BibleSearchService.test.ts`'s "Result
 * Highlighting"/"FTS5 Stemmed Highlighting" suites are the acceptance bar for
 * this class wired into a real search; these tests are the isolated unit
 * coverage of the mechanism itself.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TestSqliteProvider } from '../../../__tests__/helpers/TestSqliteProvider';
import { KeywordQuery } from '../KeywordTypes';
import { Fts5Highlighter } from './Fts5Highlighter';

describe('Fts5Highlighter', () => {
  let sql: TestSqliteProvider;
  let highlighter: Fts5Highlighter;

  beforeEach(() => {
    sql = new TestSqliteProvider(':memory:');
    highlighter = new Fts5Highlighter(sql);
  });

  afterEach(() => {
    sql.close();
  });

  it("matches the design doc's worked example: 'walk' highlights the stemmed 'walked'", () => {
    const text = 'And Enoch walked with God';
    const query: KeywordQuery = { kind: 'terms', terms: ['walk'], all: true };

    const matches = highlighter.spans(text, query);

    expect(matches).toHaveLength(1);
    expect(matches[0].term).toBe('walked');
    expect(text.slice(matches[0].startPos, matches[0].endPos)).toBe('walked');
  });

  it('maps each of several calls to the right source text, with no cross-contamination', () => {
    const query: KeywordQuery = { kind: 'terms', terms: ['walk'], all: true };

    const page = [
      'And Enoch walked with God',
      'Noah walked with God',
      'There is nothing about the weather here',
      'He walks in righteousness',
    ];

    const results = page.map(text => highlighter.spans(text, query));

    expect(results[0].map(m => m.term)).toEqual(['walked']);
    expect(results[1].map(m => m.term)).toEqual(['walked']);
    expect(results[2]).toEqual([]);
    expect(results[3].map(m => m.term)).toEqual(['walks']);

    // Every match's offsets are into ITS OWN text, not some other row's.
    for (let i = 0; i < page.length; i++) {
      for (const match of results[i]) {
        expect(page[i].slice(match.startPos, match.endPos)).toBe(match.term);
      }
    }
  });

  it('returns multiple, correctly-offset spans when a query matches multiple words in one text', () => {
    const text = 'God so loved the world, and the world loved God back';
    const query: KeywordQuery = { kind: 'terms', terms: ['love', 'god'], all: false };

    const matches = highlighter.spans(text, query);

    expect(matches.length).toBeGreaterThanOrEqual(4);

    // Ascending, non-overlapping, and each one slices back to itself.
    let prevEnd = -1;
    for (const match of matches) {
      expect(match.startPos).toBeGreaterThanOrEqual(prevEnd);
      expect(match.endPos).toBeGreaterThan(match.startPos);
      expect(text.slice(match.startPos, match.endPos)).toBe(match.term);
      prevEnd = match.endPos;
    }

    const terms = matches.map(m => m.term.toLowerCase());
    expect(terms).toContain('god');
    expect(terms).toContain('loved');
  });

  it('returns an empty array, without throwing, for text with no match', () => {
    const query: KeywordQuery = { kind: 'terms', terms: ['xyzzy'], all: true };
    expect(() => highlighter.spans('Nothing relevant here', query)).not.toThrow();
    expect(highlighter.spans('Nothing relevant here', query)).toEqual([]);
  });

  it('returns an empty array for empty text, without throwing', () => {
    const query: KeywordQuery = { kind: 'terms', terms: ['walk'], all: true };
    expect(() => highlighter.spans('', query)).not.toThrow();
    expect(highlighter.spans('', query)).toEqual([]);
  });

  it('returns an empty array for a boolean query with no FTS5 equivalent (bare negation)', () => {
    // Same convention as Fts5QueryCompiler's other callers: a bare NOT with
    // nothing to exclude from compiles to '', which means "no matches", not
    // a MATCH '' syntax error.
    const query: KeywordQuery = { kind: 'boolean', expr: { operator: 'NOT', left: 'evil' } };
    expect(() => highlighter.spans('Depart from evil, and do good', query)).not.toThrow();
    expect(highlighter.spans('Depart from evil, and do good', query)).toEqual([]);
  });

  describe('every KeywordQuery kind', () => {
    const text = 'Blessed are the poor in spirit, for theirs is the kingdom of heaven';

    it('terms (all: true)', () => {
      const query: KeywordQuery = { kind: 'terms', terms: ['poor', 'spirit'], all: true };
      const matches = highlighter.spans(text, query);
      expect(matches.map(m => m.term.toLowerCase()).sort()).toEqual(['poor', 'spirit']);
    });

    it('terms (all: false / OR)', () => {
      const query: KeywordQuery = { kind: 'terms', terms: ['poor', 'nonexistentxyz'], all: false };
      const matches = highlighter.spans(text, query);
      expect(matches.map(m => m.term.toLowerCase())).toEqual(['poor']);
    });

    it('phrase', () => {
      // `highlight()` merges adjacent matched tokens into ONE marked span
      // rather than one pair of markers per token, so a contiguous phrase
      // match is a single `Match` spanning the whole phrase.
      const query: KeywordQuery = { kind: 'phrase', phrase: 'kingdom of heaven' };
      const matches = highlighter.spans(text, query);
      expect(matches.map(m => m.term.toLowerCase())).toEqual(['kingdom of heaven']);
      expect(text.slice(matches[0].startPos, matches[0].endPos)).toBe('kingdom of heaven');
    });

    it('phrase (no match: wrong order is not the phrase)', () => {
      const query: KeywordQuery = { kind: 'phrase', phrase: 'heaven of kingdom' };
      expect(highlighter.spans(text, query)).toEqual([]);
    });

    it('prefix', () => {
      const query: KeywordQuery = { kind: 'prefix', stem: 'king' };
      const matches = highlighter.spans(text, query);
      expect(matches.map(m => m.term.toLowerCase())).toEqual(['kingdom']);
    });

    it('near', () => {
      const query: KeywordQuery = { kind: 'near', terms: ['poor', 'spirit'], distance: 3 };
      const matches = highlighter.spans(text, query);
      expect(matches.map(m => m.term.toLowerCase()).sort()).toEqual(['poor', 'spirit']);
    });

    it('boolean', () => {
      const query: KeywordQuery = {
        kind: 'boolean',
        expr: { operator: 'AND', left: 'poor', right: 'spirit' },
      };
      const matches = highlighter.spans(text, query);
      expect(matches.map(m => m.term.toLowerCase()).sort()).toEqual(['poor', 'spirit']);
    });
  });

  it('does not leak or accumulate rows across repeated calls on the same instance', () => {
    const query: KeywordQuery = { kind: 'terms', terms: ['walk'], all: true };

    // Same text, many times - if a previous call's row were still in the
    // temp table, `highlight()` would either error (ambiguous / multiple
    // rows for what should be a single-row lookup) or this call's result
    // would double up. Neither happens: each call is independent.
    for (let i = 0; i < 5; i++) {
      const matches = highlighter.spans('And Enoch walked with God', query);
      expect(matches).toHaveLength(1);
      expect(matches[0].term).toBe('walked');
    }

    // And the table is genuinely empty between calls, not just "answers look
    // right by coincidence" - a query with no match after several real
    // matches proves nothing carried over.
    expect(highlighter.spans('The weather today is fine', query)).toEqual([]);
  });

  it('offsets are into the clean text - no marker characters leak into a slice', () => {
    const text = 'Blessed are the poor in spirit';
    const query: KeywordQuery = { kind: 'terms', terms: ['poor'], all: true };

    const matches = highlighter.spans(text, query);

    expect(matches).toHaveLength(1);
    const slice = text.slice(matches[0].startPos, matches[0].endPos);
    expect(slice).toBe('poor');
    expect(slice).not.toContain('\x02');
    expect(slice).not.toContain('\x03');
  });
});
