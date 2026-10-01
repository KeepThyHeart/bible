/**
 * Reads the chapter/verse part that follows a book name, over normalised
 * text (ASCII digits, "-" dashes, single spaces), using one locale's
 * separators:
 *
 *   tail  := unit [range] { list item [range] }
 *   unit  := C [chSuffix] [ cvSep V | (after chSuffix) V ] [vSuffix]
 *   range := "-"-like C2 cvSep V2 | N [chSuffix]
 *   item  := C cvSep V | N            (N is a verse when the previous unit had one)
 *
 * Examples: "3", "3:16", "3:16-18", "3:16-4:2", "3-5", "3:16, 18; 4:1",
 * "3章16节", "3章16-18节", "3：16" (already normalised to "3:16").
 */
import type { ReferenceSyntaxData } from './types';

export interface RawRange {
  chapter: number;
  verse?: number;
  endChapter?: number;
  endVerse?: number;
  /** A chapter suffix (章) was written, so a single-chapter book's number is a chapter, not a verse. */
  explicitChapter?: boolean;
  /** Span in the normalised text; a list item's span starts at its separator. */
  start: number;
  end: number;
}

export interface TailResult {
  ranges: RawRange[];
  /** Normalised index just after the last consumed character. */
  end: number;
}

export interface TailOptions {
  lists: boolean;
  /** Scan mode: list items only continue verses (", 17"), and never cross into a new chapter by bare number. */
  scan?: boolean;
  /** Skip the leading separator check (bookless input). */
  bookless?: boolean;
  /** Bookless input with a known chapter: a bare number is a verse of it. */
  contextChapter?: number;
  /** True when a book name starts at this index ("1 Cor"), so a list must stop before it. */
  bookAt?: (index: number) => boolean;
}

class Cursor {
  constructor(readonly s: string, public i: number) {}
  ws(): void {
    while (this.s[this.i] === ' ') this.i++;
  }
  num(): number | undefined {
    const m = /^\d{1,4}/.exec(this.s.slice(this.i));
    if (!m) return undefined;
    // A longer digit run is not a chapter or verse number.
    if (/\d/.test(this.s[this.i + m[0].length] ?? '')) return undefined;
    this.i += m[0].length;
    return Number(m[0]);
  }
  /** Consume one of `seps` (longest first), optionally surrounded by spaces. */
  sep(seps: readonly string[], spaces = true): string | undefined {
    const save = this.i;
    if (spaces) this.ws();
    for (const s of [...seps].sort((a, b) => b.length - a.length)) {
      if (s && this.s.startsWith(s, this.i)) {
        this.i += s.length;
        if (spaces) this.ws();
        return s;
      }
    }
    this.i = save;
    return undefined;
  }
  peekDigit(): boolean {
    return /\d/.test(this.s[this.i] ?? '');
  }
}

/** Parse from `start`. Returns undefined when no chapter number follows. */
export function parseTail(
  s: string,
  start: number,
  syntax: Required<ReferenceSyntaxData>,
  opts: TailOptions,
): TailResult | undefined {
  const c = new Cursor(s, start);
  const cv = syntax.chapterVerse;
  // ":" is reserved for chapter:verse; make sure list separators never steal it.
  const listSeps = syntax.list.filter((x) => !cv.includes(x) || x === ',');
  const ranges: RawRange[] = [];

  const readVerseAfterCv = (): number | undefined => {
    const save = c.i;
    if (c.sep(cv)) {
      const v = c.num();
      if (v !== undefined) return v;
    }
    c.i = save;
    return undefined;
  };

  /** C [章] [: V | V] [节] */
  const readUnit = (first: number, unitStart: number): RawRange | undefined => {
    const r: RawRange = { chapter: first, start: unitStart, end: c.i };
    if (c.sep(syntax.chapterSuffix, false)) {
      r.explicitChapter = true;
      const save = c.i;
      c.ws();
      const v = c.num();
      if (v !== undefined) {
        r.verse = v;
        c.sep(syntax.verseSuffix, false);
      } else c.i = save;
    } else {
      const v = readVerseAfterCv();
      if (v !== undefined) {
        r.verse = v;
        c.sep(syntax.verseSuffix, false);
      }
    }
    r.end = c.i;
    return r;
  };

  const readRange = (r: RawRange): void => {
    const save = c.i;
    if (!c.sep(syntax.range)) return;
    const x = c.num();
    if (x === undefined) {
      c.i = save;
      return;
    }
    if (c.sep(syntax.chapterSuffix, false)) {
      r.endChapter = x;
      const s2 = c.i;
      c.ws();
      const y = c.num();
      if (y !== undefined) {
        r.endVerse = y;
        c.sep(syntax.verseSuffix, false);
      } else c.i = s2;
    } else {
      const y = readVerseAfterCv();
      if (y !== undefined) {
        r.endChapter = x;
        r.endVerse = y;
      } else if (r.verse !== undefined) r.endVerse = x;
      else r.endChapter = x;
      c.sep(syntax.verseSuffix, false);
    }
    r.end = c.i;
  };

  c.ws();
  if (!opts.bookless) {
    // "Gen. 1:1": a period after an abbreviation.
    if (s[c.i] === '.') {
      c.i++;
      c.ws();
    }
  }
  const unitStart = c.i;
  const first = c.num();
  if (first === undefined) return undefined;

  let head: RawRange | undefined;
  if (opts.contextChapter !== undefined && !s.slice(c.i).trimStart().startsWith(cv[0] ?? ':')) {
    // Bookless "16" or "16-18" with a known chapter: verses.
    head = { chapter: opts.contextChapter, verse: first, start: unitStart, end: c.i };
    c.sep(syntax.verseSuffix, false);
  } else head = readUnit(first, unitStart);
  if (!head) return undefined;
  readRange(head);
  ranges.push(head);

  if (opts.lists) {
    for (;;) {
      const itemStart = c.i;
      const save = c.i;
      const sepUsed = c.sep(listSeps);
      if (!sepUsed) break;
      // "Rom 8:28; 1 Cor 13:4": the number starts a numbered book's name, not a list item.
      if (opts.bookAt?.(c.i)) {
        c.i = save;
        break;
      }
      const n = c.num();
      if (n === undefined) {
        c.i = save;
        break;
      }
      const prev = ranges[ranges.length - 1];
      const lastChapter = prev.endChapter ?? prev.chapter;
      let item: RawRange | undefined;
      const v = readVerseAfterCv();
      if (v !== undefined) {
        item = { chapter: n, verse: v, start: itemStart, end: c.i };
        c.sep(syntax.verseSuffix, false);
      } else if (c.sep(syntax.chapterSuffix, false)) {
        if (opts.scan) {
          c.i = save;
          break;
        }
        item = { chapter: n, explicitChapter: true, start: itemStart, end: c.i };
      } else if (prev.verse !== undefined) {
        item = { chapter: lastChapter, verse: n, start: itemStart, end: c.i };
        c.sep(syntax.verseSuffix, false);
      } else {
        if (opts.scan) {
          c.i = save;
          break;
        }
        item = { chapter: n, start: itemStart, end: c.i };
      }
      item.end = c.i;
      readRange(item);
      ranges.push(item);
    }
  }

  return { ranges, end: c.i };
}
