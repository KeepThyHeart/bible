/**
 * Full-text search — extracted from `screens/SearchResults.test.ts` when that
 * screen was removed (task 0001-bible-cli, "delete the old screens").
 *
 * Driven against the real bundled KJV, for the same reason the original
 * screen's tests were: what is being verified is that a real FTS5 index, a
 * real read-only module and core's real `BibleSearchService` produce the
 * results the wireframe describes. A fixture would only prove this file
 * agrees with itself.
 *
 * The Screen-specific groups from the old file (rendering, keys, opening a
 * result in a tab, `F2` syntax) do not carry over — `screens/Main.ts` renders
 * and keys this itself now — but the pure claims about `runSearch` and the
 * distribution graph do.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { VerseIdHelper } from '@bible/core';

import { discoverModules } from '../data/modules';
import { stringWidth } from '../term/layout';
import { createTheme, renderStyledLine, stripAnsi } from '../term/style';
import { Library } from './library';
import {
  distributionGraph,
  GRAPH_WIDTH,
  runSearch,
  stripHighlightMarkers,
  type RunSearchTarget,
  type SearchHit,
} from './search';

const MODULES = join(import.meta.dir, '..', '..', '..', '..', 'data', 'modules');
const hasKjv = existsSync(join(MODULES, 'bible_kjv.db'));

const theme = createTheme('ansi256');
const JOHN = 43;
const DANIEL = 27;

let shared: Library | undefined;
function library(): Library {
  shared ??= Library.open({ modules: discoverModules() });
  return shared;
}

function target(overrides: Partial<RunSearchTarget> = {}): RunSearchTarget {
  return { library: library(), translation: 'KJV', bookNumber: JOHN, ...overrides };
}

describe.skipIf(!hasKjv)('running a search', () => {
  test('finds what the wireframe says it finds, in the tab’s own translation', async () => {
    const outcome = await runSearch('everlasting life', target());
    expect(outcome.module).toBe('KJV');
    expect(outcome.error).toBeUndefined();
    expect(outcome.unanswerable).toBeUndefined();
    expect(outcome.hits.map((hit) => hit.reference)).toContain('John 3:16');
    // Daniel 12:2 is the wireframe's first result and the only Old Testament
    // one; it is what makes the distribution graph worth drawing.
    expect(outcome.hits[0]?.reference).toBe('Daniel 12:2');
  });

  test('a hit carries the coordinates the reader needs, not just a label', async () => {
    const outcome = await runSearch('everlasting life', target());
    const john = outcome.hits.find((hit) => hit.reference === 'John 3:16');
    expect(john).toBeDefined();
    expect(john?.bookNumber).toBe(JOHN);
    expect(john?.chapter).toBe(3);
    expect(john?.verse).toBe(16);
    expect(john?.verseId).toBe(VerseIdHelper.calculate(JOHN, 3, 16));
  });

  test('the markers core wraps a match in never reach the caller', async () => {
    const outcome = await runSearch('everlasting life', target());
    for (const hit of outcome.hits) {
      expect(hit.text).not.toContain('<strong>');
      expect(hit.text).not.toContain('</u>');
    }
    const daniel = outcome.hits[0]!;
    expect(daniel.highlights.length).toBeGreaterThan(0);
    // The ranges must index the *plain* text, not the marked-up original.
    const marked = daniel.highlights.map(({ start, end }) => daniel.text.slice(start, end));
    expect(marked).toContain('everlasting');
  });

  test('a stemmed match is underlined where it actually matched', async () => {
    // `faith` matches `faithful` through the Porter stemmer. Deriving
    // highlight positions from the query term would underline `faith` inside
    // `faithful`; deriving them from core's markers gets the whole word.
    const outcome = await runSearch('(faith OR hope) AND love', target());
    const deuteronomy = outcome.hits.find((hit) => hit.reference === 'Deuteronomy 7:9');
    expect(deuteronomy).toBeDefined();
    const marked = deuteronomy!.highlights.map(({ start, end }) =>
      deuteronomy!.text.slice(start, end),
    );
    expect(marked).toContain('faithful');
  });

  test('a query the index rejects is reported, not thrown', async () => {
    const outcome = await runSearch('faith NEAR/3 works', target());
    expect(outcome.error).toBeDefined();
    // One line: SQLite appends the whole failing statement to its message.
    expect(outcome.error).not.toContain('\n');
    expect(outcome.error).toContain('fts5');
  });

  test('an unmatched quote is refused before it reaches SQLite', async () => {
    const outcome = await runSearch('"still small', target());
    expect(outcome.error).toContain('Unmatched quote');
  });

  test('a result count can be capped, for a picker with a fixed number of digits', async () => {
    const outcome = await runSearch('love', target(), { maxResults: 5 });
    expect(outcome.hits.length).toBeLessThanOrEqual(5);
  });
});

describe.skipIf(!hasKjv)('empty and unanswerable are different answers', () => {
  test('a word-proximity query on a read-only module says it cannot be answered', async () => {
    // A read-only module's proximity index can never be built, so this must
    // say "cannot be answered" rather than "no matches" (Tasks.md §10).
    const outcome = await runSearch('faith works ~10', target());
    expect(outcome.hits).toHaveLength(0);
    expect(outcome.unanswerable).toBeDefined();
    expect(outcome.unanswerable).toContain('read-only');
  });

  test('verse proximity needs no index, so it is answered normally', async () => {
    const outcome = await runSearch('faith works ~3v', target());
    expect(outcome.unanswerable).toBeUndefined();
    expect(outcome.hits.length).toBeGreaterThan(0);
  });

  test('a query with genuinely no matches says so, and says it differently', async () => {
    const outcome = await runSearch('zzzzqqq', target());
    expect(outcome.hits).toHaveLength(0);
    expect(outcome.unanswerable).toBeUndefined();
    expect(outcome.error).toBeUndefined();
  });
});

describe.skipIf(!hasKjv)('the syntax the reminder line claims', () => {
  /**
   * These pin the two examples the old screen printed under every result
   * set, and `Main.ts`'s search view still relies on the same claim: if core
   * ever makes bare `AND` work, this test fails and the hint text should be
   * changed back.
   */
  test('brackets are what make AND an operator', async () => {
    const bracketed = await runSearch('(faith AND works)', target());
    const bare = await runSearch('faith AND works', target());
    expect(bracketed.hits.length).toBeGreaterThan(bare.hits.length);
  });

  test('an exact phrase is exact', async () => {
    const outcome = await runSearch('"still small voice"', target());
    expect(outcome.hits).toHaveLength(1);
    expect(outcome.hits[0]?.reference).toBe('1 Kings 19:12');
  });
});

describe('stripHighlightMarkers', () => {
  test('removes the markers and reports where they were', () => {
    const { text: plain, highlights } = stripHighlightMarkers(
      'have <strong><u>everlasting</u></strong> <strong><u>life</u></strong>.',
    );
    expect(plain).toBe('have everlasting life.');
    expect(highlights).toEqual([
      { start: 5, end: 16 },
      { start: 17, end: 21 },
    ]);
  });

  test('unmarked text passes through unchanged', () => {
    const { text: plain, highlights } = stripHighlightMarkers('and he loved her');
    expect(plain).toBe('and he loved her');
    expect(highlights).toHaveLength(0);
  });

  test('an unclosed marker does not swallow the rest of the verse', () => {
    const { text: plain, highlights } = stripHighlightMarkers('a <strong><u>b');
    expect(plain).toBe('a b');
    expect(highlights).toHaveLength(0);
  });
});

describe('distributionGraph', () => {
  const hit = (bookNumber: number): SearchHit => ({
    verseId: VerseIdHelper.calculate(bookNumber, 1, 1),
    bookNumber,
    chapter: 1,
    verse: 1,
    reference: `Book ${bookNumber} 1:1`,
    text: '',
    highlights: [],
  });

  const bars = (hits: readonly SearchHit[], width = 88): string => {
    const rows = distributionGraph(hits, theme, width);
    return stripAnsi(renderStyledLine(rows[1] ?? [], theme.depth));
  };

  test('one cell per book, with a gap between the testaments', () => {
    expect(stringWidth(bars([hit(1)]))).toBe(GRAPH_WIDTH);
  });

  test('a book with no matches is not the same glyph as a book with one', () => {
    const row = bars([hit(DANIEL)]);
    expect(row[DANIEL - 1]).toBe('█'); // the only book, so also the busiest
    expect(row[0]).toBe('·'); // Genesis
  });

  test('the busiest book always reaches the top of the scale', () => {
    const hits = [hit(1), ...Array.from({ length: 20 }, () => hit(JOHN))];
    const row = bars(hits);
    expect(row[JOHN - 1 + 2]).toBe('█'); // +2 for the testament gap
    expect(row[0]).toBe('▁'); // one match is the lowest non-zero level
  });

  test('no graph at all when a book cannot have its own column', () => {
    expect(distributionGraph([hit(1)], theme, GRAPH_WIDTH - 1)).toHaveLength(0);
  });

  test('no graph when there is nothing to plot', () => {
    expect(distributionGraph([], theme, 88)).toHaveLength(0);
  });
});
