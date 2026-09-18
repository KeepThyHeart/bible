/**
 * Full-text search — the data behind `/` when the typed text is not a
 * reference (task 0001-bible-cli, "Wireframes › Search results").
 *
 * Extracted from the old `screens/SearchResults.ts` screen, which the 2026
 * redesign (`screens/Main.ts`) replaces with a `StudyView` the same way it
 * replaced cross-references, commentaries and topics: the search itself is
 * pure and asynchronous, and `Main.ts` turns its {@link SearchOutcome} into
 * rows and owns the keys, on the same "no rendering, no keys" split as
 * `app/studyPanes.ts` and `app/history.ts`.
 *
 * ## An empty result and an unanswerable one are different answers
 *
 * `searchProximityInBook()` returns `[]` when the book index was never
 * built, and every module this app opens is read-only, so no index can ever
 * be built (see `data/bookIndex.ts`). A `~10` query would therefore report
 * "no matches" when the truth is "this module cannot answer that". {@link
 * runSearch} checks first and the caller can tell which of the two it is.
 */
import { BibleSearchService, VerseIdHelper, type SearchResult } from '@bible/core';
import { SearchQueryParser } from '@bible/core/Services/SearchQueryParser';

import { ensureBookIndex } from '../data/bookIndex';
import type { Library } from './library';
import { stringWidth, truncateToWidth } from '../term/layout';
import type { StyledLine, StyledSegment, Theme } from '../term/style';

/** What core wraps a matched word in. The same pair on every search path. */
const MARKER_OPEN = '<strong><u>';
const MARKER_CLOSE = '</u></strong>';

/** Where a matched word sits in {@link SearchHit.text}. */
export interface Highlight {
  readonly start: number;
  readonly end: number;
}

/** One result, reduced to what a terminal needs to draw and to navigate to. */
export interface SearchHit {
  readonly verseId: number;
  readonly bookNumber: number;
  readonly chapter: number;
  readonly verse: number;
  /** As core formats it, e.g. `John 3:16`. */
  readonly reference: string;
  /** Plain text — core's highlight markers removed. */
  readonly text: string;
  readonly highlights: readonly Highlight[];
}

export interface SearchOutcome {
  readonly query: string;
  /** The module that was searched, e.g. `KJV`. */
  readonly module: string;
  readonly hits: readonly SearchHit[];
  readonly elapsedMs: number;
  /**
   * Set when the module *cannot answer* this query, as opposed to answering
   * it with nothing. The distinction is the whole reason this field exists.
   */
  readonly unanswerable: string | undefined;
  /** Set when the query itself was rejected — bad syntax, unmatched quote. */
  readonly error: string | undefined;
}

export interface RunSearchOptions {
  /** Core's own default is 200; `Main.ts` caps it lower to fit a two-digit picker. */
  readonly maxResults?: number;
}

/** What {@link runSearch} needs of the reader's position — the tab's translation and book. */
export interface RunSearchTarget {
  readonly library: Library;
  readonly translation: string;
  /** Used only to probe whether a proximity index exists for this module. */
  readonly bookNumber: number;
}

const parser = new SearchQueryParser();

/**
 * Run a query against the tab's translation and reduce it to a
 * {@link SearchOutcome}.
 *
 * Only the tab's own Bible is searched — searching the whole library would
 * put results from translations the user is not reading above the ones they
 * are, and there is nowhere in the new design to name more than one module
 * at once.
 *
 * `autoFuzzy` is turned off. Core supplements an exact query with approximate
 * matches whenever it finds between one and nine results, and those arrive
 * unmarked and inflate the count — a search that quietly adds verses the
 * user did not ask for is reporting a number that is not the answer to the
 * question. `~word` remains available for anyone who wants it.
 */
export async function runSearch(
  query: string,
  target: RunSearchTarget,
  options: RunSearchOptions = {},
): Promise<SearchOutcome> {
  const text = query.trim();
  const bible = target.library.bible(target.translation);
  if (bible === undefined) {
    return outcome(text, 'no module', { error: 'There is no Bible module open to search.' });
  }
  const module = bible.abbreviation;

  // `validate` catches the two failures worth naming precisely — an empty
  // query and an unmatched quote — before `parse` can throw a less helpful
  // version of the same thing.
  const invalid = parser.validate(text);
  if (invalid !== undefined) return outcome(text, module, { error: invalid });

  let searchType: string;
  try {
    searchType = parser.parse(text).searchType;
  } catch (error) {
    return outcome(text, module, { error: message(error) });
  }

  // Word proximity is the one search type that reads an index rather than
  // the FTS table, and it fails silently when that index is absent.
  // Read-onlyness is a property of the file, not of one book, so a single
  // probe answers for the whole module — and the book being read is the
  // cheapest one to probe.
  if (searchType === 'proximity') {
    const index = probeBookIndex(bible.sql, bible.repo, target.bookNumber);
    if (index !== undefined) return outcome(text, module, { unanswerable: index });
  }

  const service = new BibleSearchService(new Map([[module, bible.repo]]), target.library.bookRepository());
  const started = performance.now();
  let results: SearchResult[];
  try {
    results = await service.search(text, {
      modules: [module],
      maxResults: options.maxResults ?? 200,
      autoFuzzy: false,
    });
  } catch (error) {
    return outcome(text, module, { error: message(error) });
  }

  return {
    query: text,
    module,
    hits: results.map(toHit),
    elapsedMs: performance.now() - started,
    unanswerable: undefined,
    error: undefined,
  };
}

/** Returns the reason proximity search cannot be answered, or `undefined`. */
function probeBookIndex(
  sql: Parameters<typeof ensureBookIndex>[0],
  repo: Parameters<typeof ensureBookIndex>[1],
  bookNumber: number,
): string | undefined {
  try {
    const result = ensureBookIndex(sql, repo, bookNumber);
    return result.state === 'unavailable'
      ? (result.detail ?? 'this module cannot build a proximity index')
      : undefined;
  } catch (error) {
    // `ensureBookIndex` rethrows anything that is not a read-only refusal. A
    // failure to build the index is still a failure to answer the query.
    return message(error);
  }
}

function outcome(
  query: string,
  module: string,
  fields: { error?: string; unanswerable?: string },
): SearchOutcome {
  return {
    query,
    module,
    hits: [],
    elapsedMs: 0,
    unanswerable: fields.unanswerable,
    error: fields.error,
  };
}

/**
 * The first line of an error.
 *
 * SQLite errors arrive with the whole failing statement appended, which is
 * several hundred characters of SQL the user cannot act on. `fts5: syntax
 * error near "/"` is the part that helps.
 */
function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0] ?? text;
}

function toHit(result: SearchResult): SearchHit {
  const parsed = VerseIdHelper.parse(result.verseId);
  const { text, highlights } = stripHighlightMarkers(result.text);
  return {
    verseId: result.verseId,
    bookNumber: parsed.bookNumber,
    chapter: parsed.chapter,
    verse: parsed.verse,
    reference: result.reference,
    text,
    highlights,
  };
}

/**
 * Turn core's HTML-marked text into plain text plus the ranges that were
 * marked.
 *
 * Derived from the markers rather than from `SearchResult.matches`, because
 * the markers are what the search actually matched: a stemmed hit marks
 * `faithful` for a query of `faith`, and re-deriving positions from the
 * query terms would underline `faith` inside it and miss `faithful` entirely.
 */
export function stripHighlightMarkers(html: string): {
  text: string;
  highlights: Highlight[];
} {
  let text = '';
  const highlights: Highlight[] = [];
  let openedAt: number | undefined;
  let index = 0;

  while (index < html.length) {
    if (html.startsWith(MARKER_OPEN, index)) {
      openedAt ??= text.length;
      index += MARKER_OPEN.length;
      continue;
    }
    if (html.startsWith(MARKER_CLOSE, index)) {
      if (openedAt !== undefined) {
        highlights.push({ start: openedAt, end: text.length });
        openedAt = undefined;
      }
      index += MARKER_CLOSE.length;
      continue;
    }
    text += html[index];
    index += 1;
  }

  return { text, highlights };
}

// --- the distribution graph ------------------------------------------------

/** Books before Matthew, and after it. Fixed: one versification scheme. */
const OT_BOOKS = 39;
const NT_BOOKS = 27;
/** Columns between the two testament blocks. */
const TESTAMENT_GAP = 2;
/** One cell per book, plus the gap. */
export const GRAPH_WIDTH = OT_BOOKS + TESTAMENT_GAP + NT_BOOKS;

const LEVELS = '▁▂▃▄▅▆▇█';
/**
 * A book with no matches.
 *
 * Not `▁`, which would make a book with one match and a book with none the
 * same glyph. Telling those apart is the entire job of the graph, so `▁` is
 * reserved for the lowest *non-zero* level.
 */
const NO_MATCHES = '·';

/**
 * A per-book histogram of where the matches fell, in block characters.
 *
 * Returns no rows when the pane is too narrow to hold one column per book.
 * Compressing several books into a cell would produce a graph whose bars no
 * longer stand over the labels, which is worse than not drawing it.
 */
export function distributionGraph(
  hits: readonly SearchHit[],
  theme: Theme,
  width: number,
): StyledLine[] {
  if (width < GRAPH_WIDTH || hits.length === 0) return [];

  const counts = new Array<number>(OT_BOOKS + NT_BOOKS).fill(0);
  for (const hit of hits) {
    const index = hit.bookNumber - 1;
    if (index >= 0 && index < counts.length) counts[index] += 1;
  }
  const max = Math.max(...counts);
  if (max === 0) return [];

  const gap: StyledSegment = { text: ' '.repeat(TESTAMENT_GAP) };
  return [
    [
      { text: pad('OLD TESTAMENT', OT_BOOKS), style: theme.muted },
      gap,
      { text: 'NEW TESTAMENT', style: theme.muted },
    ],
    [...bars(counts.slice(0, OT_BOOKS), max, theme), gap, ...bars(counts.slice(OT_BOOKS), max, theme)],
    [
      { text: between('Gen', 'Mal', OT_BOOKS), style: theme.muted },
      gap,
      { text: between('Mt', 'Rev', NT_BOOKS), style: theme.muted },
    ],
    [],
  ];
}

/** One cell per book, adjacent cells of the same style coalesced into one segment. */
function bars(counts: readonly number[], max: number, theme: Theme): StyledSegment[] {
  const out: StyledSegment[] = [];
  for (const count of counts) {
    // Scaled so that any non-zero count reaches at least `▁` and the busiest
    // book always reaches `█`; a linear scale from zero would flatten every
    // query whose matches cluster in one book.
    const char =
      count === 0 ? NO_MATCHES : (LEVELS[Math.min(LEVELS.length - 1, Math.ceil((count / max) * LEVELS.length) - 1)] ?? '▁');
    const style = count === 0 ? theme.rule : undefined;
    const last = out[out.length - 1];
    if (last !== undefined && last.style === style) {
      out[out.length - 1] = { text: last.text + char, ...(style === undefined ? {} : { style }) };
    } else {
      out.push({ text: char, ...(style === undefined ? {} : { style }) });
    }
  }
  return out;
}

function pad(text: string, width: number): string {
  const short = width - stringWidth(text);
  return short > 0 ? text + ' '.repeat(short) : truncateToWidth(text, width);
}

/** `Gen` at the left of a block and `Mal` at its right, exactly `width` wide. */
function between(left: string, right: string, width: number): string {
  const space = width - stringWidth(left) - stringWidth(right);
  return space > 0 ? `${left}${' '.repeat(space)}${right}` : truncateToWidth(`${left} ${right}`, width);
}
