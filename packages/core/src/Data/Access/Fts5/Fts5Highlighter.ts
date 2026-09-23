/**
 * Fts5Highlighter
 *
 * The one {@link IHighlighter} implementation this pass adds (task 0027,
 * "Module Format v2", revision 2, subtask F7, design doc §4.5 - task 0026's
 * M8). Computes `Match[]` offset spans for a piece of text against a
 * provider-neutral `KeywordQuery`, WITHOUT hand-porting FTS5's Porter
 * stemmer into JavaScript.
 *
 * ## The mechanism
 *
 * `InModuleFts5Provider` can call SQLite's `highlight()` because its table is
 * external-content FTS5 (it indexes `bible_verse.text` without duplicating
 * it). `SidecarFts5Provider`'s `kw` table cannot: it is CONTENTLESS
 * (`content = ''`), so `highlight()`/`snippet()` against it return NULL -
 * there is no stored text for either function to slice into (see
 * `sidecarSchema.ts`'s doc comment on why `columnsize=0` is deliberately
 * NOT set, so that NULL is what a caller gets, not a "malformed" error).
 *
 * This class works either way by never relying on an index's own content at
 * all: it inserts the ONE piece of text a caller wants highlighted into a
 * small, transient, in-memory, CONTENT-BEARING FTS5 table it owns, built
 * with the exact same tokenizer the real index used, and runs the exact same
 * compiled MATCH query against THAT. Same tokenizer, same query, doing both
 * the indexing and the highlighting - exact behavioural parity with whatever
 * index answered the original query, by construction, with no separate
 * stemmer implementation to keep in sync.
 *
 * ```sql
 * CREATE VIRTUAL TABLE temp.hl USING fts5(text, tokenize='porter unicode61');
 * INSERT INTO temp.hl(rowid, text) VALUES (?, ?);
 * SELECT highlight(hl, 0, char(2), char(3)) FROM temp.hl WHERE hl MATCH ?;
 * -- -> "And Enoch \x02walked\x03 with God"  for the query  walk
 * ```
 *
 * `char(2)`/`char(3)` (ASCII STX/ETX) are the internal markers: control
 * characters real Bible text never contains, so they can never collide with
 * genuine content. They are parsed into `Match[]` offsets inside `spans()`
 * below and never returned to a caller - see `IHighlighter`'s doc comment on
 * why this interface deals in offsets, not marked-up HTML.
 *
 * ## Table lifecycle
 *
 * One `temp.hl` per `Fts5Highlighter` instance, created lazily on the first
 * `spans()` call (never in the constructor - constructing this class must
 * never be the thing that touches the connection or throws, the same
 * convention `BaseModuleRepository.moduleCodec()` already uses for its own
 * lazy resource). `temp.` tables are connection-scoped: created once, they
 * are cheap to reuse for the life of the connection, and disappear on their
 * own when the connection closes - there is nothing for this class to
 * dispose. What it DOES do explicitly is delete the row(s) it inserted after
 * every `spans()` call (in a `finally`, so a thrown MATCH error still cleans
 * up), so a long-lived connection used for many searches never accumulates
 * rows in its highlighting scratch table.
 *
 * A fresh `CREATE VIRTUAL TABLE`/`INSERT`/`MATCH`/`DELETE` cycle per call
 * (rather than, say, batching a whole page of hits into one multi-row
 * `INSERT`) is deliberately the simple choice: SQLite temp tables are cheap
 * to create and clear, `spans()`'s own contract is one text at a time (see
 * `IHighlighter`), and the design doc's own measured target - low single-digit
 * milliseconds per page of ~20 hits - has plenty of room under it for one
 * highlighter instance handling ~20 short `spans()` calls per page.
 *
 * ## Tokenizer
 *
 * Hardcoded to {@link SIDECAR_TOKENIZER} (`'porter unicode61'`) by default -
 * the same literal `sidecarSchema.ts` builds every `.kwi` with, and the same
 * one the in-module `bible_verse_fts` tables (`InModuleFts5Provider`) were
 * already built with (see that provider's doc comment). Importing the
 * constant rather than a second hardcoded string is what makes "the same
 * tokenizer" true by construction instead of by two files agreeing to stay in
 * sync. A caller with a genuinely different tokenizer (there is none today)
 * can still override it via the constructor.
 */

import { ISql } from '../../Core/ISql';
import { Match } from '../../../types/search';
import { IHighlighter } from '../IHighlighter';
import { KeywordQuery } from '../KeywordTypes';
import { compileKeywordQuery } from './Fts5QueryCompiler';
import { SIDECAR_TOKENIZER } from './sidecarSchema';

/** The one row `spans()` ever has in flight at a time; deleted after every call. */
const HL_ROWID = 1;

/** ASCII STX / ETX - see the file doc comment for why these are safe markers. */
const MARK_START = '\x02';
const MARK_END = '\x03';

export class Fts5Highlighter implements IHighlighter {
  private tableReady = false;

  /**
   * @param sql       An already-open connection. Any real `ISql` works: this
   *                   class only ever touches `temp.hl`, never a caller's own
   *                   tables, so sharing a module's existing connection (what
   *                   `BibleSearchService` does, via `IBibleRepository.getSql()`)
   *                   is safe even though that connection is usually opened
   *                   read-only - SQLite's temp database is always writable,
   *                   independent of the main file's open mode.
   * @param tokenizer  Defaults to {@link SIDECAR_TOKENIZER}; see the class doc
   *                   comment.
   */
  constructor(
    private readonly sql: ISql,
    private readonly tokenizer: string = SIDECAR_TOKENIZER
  ) {}

  /**
   * Find every match `q` would highlight inside `text`. See `IHighlighter`
   * for the contract; see the class doc comment for the mechanism.
   */
  spans(text: string, q: KeywordQuery): Match[] {
    if (text.length === 0) return [];

    // Same convention as every other `compileKeywordQuery` caller in this
    // package (Fts5QueryCompiler's own doc comment, InModuleFts5Provider,
    // SidecarFts5Provider): a boolean expression with no FTS5 equivalent
    // compiles to '' and means "no matches", not "run MATCH ''" (which
    // SQLite rejects outright).
    const compiled = compileKeywordQuery(q);
    if (compiled === '') return [];

    this.ensureTable();

    try {
      this.sql.execute('INSERT INTO temp.hl(rowid, text) VALUES (?, ?)', [HL_ROWID, text]);

      const row = this.sql.queryOne<{ highlighted: string | null }>(
        'SELECT highlight(hl, 0, ?, ?) AS highlighted FROM temp.hl WHERE hl MATCH ?',
        [MARK_START, MARK_END, compiled]
      );

      // No row back means `text` did not match `q` under this tokenizer -
      // an ordinary "nothing to highlight" outcome, not an error.
      if (!row || row.highlighted === null || row.highlighted === undefined) {
        return [];
      }

      return parseMarkedText(row.highlighted);
    } finally {
      // Unconditional, so a thrown MATCH/highlight() error still leaves the
      // table empty for the next call - see the class doc comment on table
      // lifecycle.
      this.sql.execute('DELETE FROM temp.hl');
    }
  }

  /**
   * Create `temp.hl` on first use. `IF NOT EXISTS` makes this idempotent so
   * `ensureTable()` can be called unconditionally from every `spans()` call
   * with only the `tableReady` flag guarding the (cheap, but not free)
   * `execute()` round-trip on every call after the first.
   */
  private ensureTable(): void {
    if (this.tableReady) return;
    this.sql.execute(
      `CREATE VIRTUAL TABLE IF NOT EXISTS temp.hl USING fts5(text, tokenize='${this.tokenizer}')`
    );
    this.tableReady = true;
  }
}

/**
 * Parse `char(2)`/`char(3)`-delimited output into `Match[]` offsets into the
 * CLEAN text (markers stripped) - never into the marked-up string itself.
 * `startPos`/`endPos` are computed by walking the marked-up string once and
 * accumulating the length of the clean text built so far, which is what
 * keeps a match's offset correct even when an earlier match in the same text
 * shifted where later characters would otherwise land in the marked-up
 * string (the markers themselves are never counted).
 *
 * `highlight()` never nests or overlaps markers - each match is a disjoint
 * `MARK_START...MARK_END` pair - so a simple left-to-right scan is exact.
 */
function parseMarkedText(highlighted: string): Match[] {
  const matches: Match[] = [];
  let cleanLength = 0;
  let cursor = 0;

  for (;;) {
    const startIdx = highlighted.indexOf(MARK_START, cursor);
    if (startIdx === -1) {
      break;
    }

    // Plain text between the previous match (or the start) and this one.
    cleanLength += startIdx - cursor;

    const endIdx = highlighted.indexOf(MARK_END, startIdx + 1);
    if (endIdx === -1) {
      // Malformed output (an opening marker with no closing one). Never
      // observed from SQLite's own `highlight()`; stop rather than
      // mis-parse the remainder as one more match.
      break;
    }

    const term = highlighted.slice(startIdx + 1, endIdx);
    const spanStart = cleanLength;
    cleanLength += term.length;

    matches.push({ term, startPos: spanStart, endPos: cleanLength });

    cursor = endIdx + 1;
  }

  return matches;
}
