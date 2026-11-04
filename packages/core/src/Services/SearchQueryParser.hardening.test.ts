import { describe, it, expect } from 'vitest';
import {
  SearchQueryParser,
  SearchQueryRejectedError,
  PATTERN_SEARCH_DISABLED_MESSAGE,
} from './SearchQueryParser';

const parser = new SearchQueryParser();

describe('SearchQueryParser: pattern search can be refused (W-001)', () => {
  it('still parses /pattern/ by default (desktop)', () => {
    const parsed = parser.parse('/^(\\w+\\s?)*$/');
    expect(parsed.searchType).toBe('regex');
    expect(parsed.regex).toBe('^(\\w+\\s?)*$');
  });

  it('throws SearchQueryRejectedError for /pattern/ when allowRegex is false', () => {
    let error: unknown;
    try {
      parser.parse('/^(\\w+\\s?)*$/', { allowRegex: false });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SearchQueryRejectedError);
    expect((error as SearchQueryRejectedError).code).toBe('SEARCH_QUERY_REJECTED');
    expect((error as Error).message).toBe(PATTERN_SEARCH_DISABLED_MESSAGE);
  });

  it('leaves other queries alone when allowRegex is false', () => {
    expect(parser.parse('love joy', { allowRegex: false }).searchType).toBe('multi-word');
    expect(parser.parse('a/b', { allowRegex: false }).searchType).toBe('multi-word');
  });

  it('validate() does not report an invalid pattern that will be refused anyway', () => {
    expect(parser.validate('/[/')).toMatch(/^Invalid regular expression/);
    expect(parser.validate('/[/', { allowRegex: false })).toBeUndefined();
  });
});

describe('SearchQueryParser proximity suffix (W-008)', () => {
  // The pre-W-008 regexes, as the reference for behaviour on short inputs.
  const OLD_VERSE = /(.+?)\s+~(\d+)v$/i;
  const OLD_WORD = /(.+?)\s+~(\d+)w?$/i;

  function oldParse(query: string): { type: string; terms?: string[]; distance?: number } {
    const q = query.trim();
    const terms = (s: string) => {
      const out: string[] = [];
      const re = /"([^"]+)"|(\S+)/g;
      let m;
      while ((m = re.exec(s)) !== null) out.push(m[1] || m[2]);
      return out.filter(t => t.length > 0);
    };
    const v = q.match(OLD_VERSE);
    if (v) return { type: 'verse-proximity', terms: terms(v[1]), distance: parseInt(v[2], 10) };
    const w = q.match(OLD_WORD);
    if (w) return { type: 'proximity', terms: terms(w[1]), distance: parseInt(w[2], 10) };
    return { type: 'other' };
  }

  function newParse(query: string): { type: string; terms?: string[]; distance?: number } {
    const p = parser.parse(query);
    if (p.searchType === 'verse-proximity') return { type: p.searchType, terms: p.verseProximity!.terms, distance: p.verseProximity!.distance };
    if (p.searchType === 'proximity') return { type: p.searchType, terms: p.proximity!.terms, distance: p.proximity!.distance };
    return { type: 'other' };
  }

  it('parses the usual shapes as before', () => {
    expect(newParse('faith hope ~5v')).toEqual({ type: 'verse-proximity', terms: ['faith', 'hope'], distance: 5 });
    expect(newParse('faith hope ~5V')).toEqual({ type: 'verse-proximity', terms: ['faith', 'hope'], distance: 5 });
    expect(newParse('love God ~10')).toEqual({ type: 'proximity', terms: ['love', 'God'], distance: 10 });
    expect(newParse('love God ~10w')).toEqual({ type: 'proximity', terms: ['love', 'God'], distance: 10 });
    expect(newParse('"in the beginning" God   ~3v')).toEqual({ type: 'verse-proximity', terms: ['in the beginning', 'God'], distance: 3 });
    expect(newParse('a ~3v ~5v')).toEqual({ type: 'verse-proximity', terms: ['a', '~3v'], distance: 5 });
    expect(newParse('a~5v').type).not.toBe('verse-proximity');
    expect(newParse('~5v').type).not.toBe('verse-proximity');
  });

  it('agrees with the old regexes on random short queries', () => {
    const alphabet = ['a', 'b', ' ', ' ', '\t', '\n', '~', '1', '2', 'v', 'V', 'w', '"'];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 5000; i++) {
      const len = 1 + Math.floor(next() * 14);
      let q = '';
      for (let j = 0; j < len; j++) q += alphabet[Math.floor(next() * alphabet.length)];
      if (!q.trim()) continue;
      // Quotes and parentheses route elsewhere before or after; compare only the suffix outcome.
      let expected;
      try {
        expected = oldParse(q);
      } catch {
        continue;
      }
      expect(newParse(q), JSON.stringify(q)).toEqual(expected);
    }
  });

  it('is linear on runs of whitespace', () => {
    const cases = [
      'a' + ' '.repeat(510) + 'b',
      'a' + ' '.repeat(5000) + 'b',
      'a '.repeat(2500) + 'b',
      'a ~'.repeat(1700) + 'b',
      'a' + ' '.repeat(5000) + '~1',
      'a' + '\n '.repeat(2500) + 'b ~3v',
    ];
    for (const q of cases) {
      const t = performance.now();
      parser.parse(q);
      const ms = performance.now() - t;
      // The old regexes took ~190 ms on the first (510 spaces) and grow cubically.
      expect(ms, `${JSON.stringify(q.slice(0, 20))}... (${q.length} chars)`).toBeLessThan(50);
    }
  });
});
