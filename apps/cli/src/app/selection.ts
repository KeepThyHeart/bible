/**
 * Selection and ranges.
 *
 * A selection is **an anchor plus the cursor**, not a start and an end. The
 * difference is the whole point: with a start/end pair, `shift+↑` from a range
 * that grew downwards has to decide whether it is moving the start or the end,
 * and every implementation that guesses gets it wrong in one direction —
 * `shift+↓ ↓ ↑` should give you back two verses, not invert the range or leave
 * the cursor somewhere you did not put it. With an anchor, the answer falls
 * out: the cursor moves, the anchor does not, and the range is whatever lies
 * between them. There is also exactly one place the cursor lives, so the reader
 * never has two ideas of where you are.
 *
 * This module is deliberately **not a screen**. Selection is a behaviour of the
 * reader, so `screens/Main.ts` owns the three keys (`shift+↑`, `shift+↓`, `v`)
 * and this owns the arithmetic underneath them: resolving, extending,
 * shrinking, clamping, the range a reference implies, and the summary shown
 * above the input line.
 *
 * ## Why the clamp is the chapter and not the book
 *
 * A selection stops at the first and last verse of the chapter the tab is on.
 * Two reasons, and the first is sufficient on its own:
 *
 * 1. **The reader lays out one chapter.** A selection running into the next
 *    chapter would be half invisible, and a selection you cannot see is a
 *    selection you cannot check before pressing `y`. Showing what `y` will copy
 *    is the only job a selection has.
 * 2. **The summary is chapter-relative** — `16-17 selected`,
 *    `John 3:16-17 selected — 2 verses`. Verse numbers with no chapter only
 *    read correctly inside one chapter, and a range that spanned two would have
 *    to be written differently depending on how far it had grown.
 *
 * `<` and `>` still move by chapter with a selection active; what happens then
 * is that the anchor is left behind in a chapter the tab is no longer on, and
 * {@link selectedRange} discards it rather than producing a range out of two
 * verses in different chapters. Defending in the resolver rather than relying
 * on every navigation path to remember to clear the anchor is the difference
 * between one place to get right and a dozen.
 */
import { splitVerseWords, VerseIdHelper } from '@bible/core';

import type { ResolvedReference } from './input';
import type { TabState } from './state';
import { mergeStyle, type Style, type StyledLine, type Theme } from '../term/style';
import type { ReadingLine } from '../term/reading';

/** An inclusive run of verse *numbers* inside one chapter. */
export interface VerseRange {
  readonly start: number;
  readonly end: number;
}

/** Chapter limits for the clamp. Verses run `1..verseCount`. */
export interface SelectionBounds {
  readonly bookNumber: number;
  readonly chapter: number;
  readonly verseCount: number;
}

// --- resolving -----------------------------------------------------------

/** True when the tab has a live selection of more than the cursor verse. */
export function hasSelection(tab: TabState): boolean {
  const range = selectedRange(tab);
  return range.end > range.start;
}

/**
 * The tab's selection as an ordered range of verse numbers.
 *
 * Always defined: with no anchor the selection *is* the cursor verse, which is
 * what `y` copies by default. An anchor that is not in the cursor's own
 * chapter is discarded — see the note at the top of the file.
 */
export function selectedRange(tab: TabState): VerseRange {
  const cursor = VerseIdHelper.parse(tab.cursorVerse);
  if (tab.selectionAnchor === undefined) {
    return { start: cursor.verse, end: cursor.verse };
  }

  const anchor = VerseIdHelper.parse(tab.selectionAnchor);
  if (anchor.bookNumber !== cursor.bookNumber || anchor.chapter !== cursor.chapter) {
    return { start: cursor.verse, end: cursor.verse };
  }

  return {
    start: Math.min(anchor.verse, cursor.verse),
    end: Math.max(anchor.verse, cursor.verse),
  };
}

/** True when `verse` (a verse number) falls inside the range. */
export function rangeContains(range: VerseRange, verse: number): boolean {
  return verse >= range.start && verse <= range.end;
}

// --- changing ------------------------------------------------------------

/**
 * `v` — arm the selection at the cursor without moving anything.
 *
 * That is genuinely all it does, and it is what makes the `v then ↓`
 * fallback work for free: once the anchor is set, the reader's *ordinary* `↓`
 * carries it along (every reader movement rebuilds the tab by spreading it, so
 * `selectionAnchor` survives), and the range grows. The fallback exists because
 * some terminals swallow `shift+arrow` for their own selection.
 *
 * Pressing `v` again on an armed selection collapses it back to the cursor,
 * so the key is its own undo rather than a state you can only leave via `esc`.
 */
export function beginSelection(tab: TabState): TabState {
  if (tab.selectionAnchor !== undefined) return clearSelection(tab);
  // Arming is what makes the plain arrows extend. It is set *only* here: a
  // selection made with `shift+arrow` or by typing a range leaves the
  // arrows alone, so the next one collapses the range instead of growing it.
  return { ...tab, selectionAnchor: tab.cursorVerse, selectionArmed: true };
}

/** `esc` — back to the cursor verse alone, and out of `v` mode with it. */
export function clearSelection(tab: TabState): TabState {
  if (tab.selectionAnchor === undefined && tab.selectionArmed !== true) return tab;
  return { ...tab, selectionAnchor: undefined, selectionArmed: undefined };
}

/**
 * Whether the ordinary arrow keys should extend rather than replace.
 *
 * True only between `v` and the `esc` (or second `v`) that ends it. Everything
 * else that produces a selection deliberately leaves this false — see
 * {@link beginSelection}.
 */
export function isSelectionArmed(tab: TabState): boolean {
  return tab.selectionArmed === true;
}

/**
 * `shift+↑` / `shift+↓` — move the cursor and let the range follow.
 *
 * Extending and shrinking are the same operation, which is the anchor's whole
 * dividend: moving the cursor *away* from the anchor grows the range and moving
 * it *back* shrinks it, with no branch and no way for the two to disagree. The
 * anchor is set on the first press if it was not already, so `shift+↓` from a
 * bare cursor selects two verses rather than one.
 *
 * Returns the tab unchanged — identity-equal, so a caller can return `none` —
 * when the cursor is already against the end of the chapter it is clamped to.
 */
export function moveSelection(tab: TabState, delta: number, bounds: SelectionBounds): TabState {
  const cursor = VerseIdHelper.parse(tab.cursorVerse);
  const target = clampVerse(cursor.verse + delta, bounds);
  const anchor = tab.selectionAnchor ?? tab.cursorVerse;

  // Already against the clamp. Reported as "nothing happened" rather than as a
  // changed tab, so the reader can leave the key to the shell.
  if (target === cursor.verse) return tab;

  return {
    ...tab,
    selectionAnchor: anchor,
    cursorVerse: VerseIdHelper.calculate(bounds.bookNumber, bounds.chapter, target),
  };
}

/**
 * The cursor and anchor a reference implies — `16-17`, `3:16-17` (a range typed as a
 * reference is selected on arrival).
 *
 * Returned as loose fields rather than a `TabState` because the caller is
 * mid-navigation: it is already rebuilding the tab from the reference's book
 * and chapter, and handing it a whole tab back would mean two places deciding
 * where the reader ends up.
 *
 * `clamped` is set when the reference reached past the chapter — a cross-chapter
 * range such as `3:16-4:2`, which the input line parses and the selection cannot
 * hold. The range is cut at the chapter end rather than refused, because
 * arriving at John 3:16 with sixteen verses selected is a better answer than an
 * error, but the caller can say so.
 */
export function selectionForReference(
  reference: ResolvedReference,
  verseCount: number,
): { cursorVerse: number; selectionAnchor: number | undefined; clamped: boolean } {
  const bounds: SelectionBounds = {
    bookNumber: reference.book,
    chapter: reference.chapter,
    verseCount,
  };
  const anchorVerse = clampVerse(reference.verse ?? 1, bounds);

  if (reference.endVerse === undefined) {
    return {
      cursorVerse: VerseIdHelper.calculate(reference.book, reference.chapter, anchorVerse),
      selectionAnchor: undefined,
      clamped: false,
    };
  }

  const crossChapter =
    reference.endChapter !== undefined && reference.endChapter > reference.chapter;
  const cursorVerse = clampVerse(crossChapter ? verseCount : reference.endVerse, bounds);
  const start = Math.min(anchorVerse, cursorVerse);
  const end = Math.max(anchorVerse, cursorVerse);

  return {
    cursorVerse: VerseIdHelper.calculate(reference.book, reference.chapter, end),
    selectionAnchor:
      end === start ? undefined : VerseIdHelper.calculate(reference.book, reference.chapter, start),
    clamped: crossChapter || cursorVerse !== reference.endVerse,
  };
}

// --- what it says on screen ----------------------------------------------

export interface SelectionSummaryOptions {
  /** The passage, already formatted — `John 3:16-17`. */
  readonly reference: string;
  /** Plain text of each selected verse, for the word count. */
  readonly texts: readonly string[];
  readonly theme: Theme;
  /** Body width, so the teaching line can be dropped rather than truncated. */
  readonly width: number;
}

/**
 * The two rows shown directly above the input line:
 *
 * ```
 *   John 3:16-17 selected — 2 verses, 47 words.   y copies · esc clears
 *   Also selects:  shift+↓   v then ↓   16-17   3:16-17
 * ```
 *
 * These go in `ScreenView.notice`. The second row is a teaching line, so it is **dropped
 * whole** when it will not fit rather than truncated: a list of alternatives
 * cut off mid-item teaches the wrong alternatives, and the row it costs is a
 * row of Scripture.
 */
export function selectionSummary(options: SelectionSummaryOptions): StyledLine[] {
  const { reference, texts, theme, width } = options;
  const words = countWords(texts);
  const verses = texts.length;

  const summary = `${reference} selected — ${plural(verses, 'verse')}, ${plural(words, 'word')}.`;
  const rows: StyledLine[] = [
    [
      { text: summary, style: theme.title },
      { text: '   y copies · esc clears', style: theme.muted },
    ],
  ];

  const teach = 'Also selects:  shift+↓   v then ↓   16-17   3:16-17';
  if (teach.length <= width) rows.push([{ text: teach, style: theme.muted }]);

  return rows;
}

/** Words as the span data counts them, so a count here matches a count there. */
export function countWords(texts: readonly string[]): number {
  return texts.reduce((total, text) => total + splitVerseWords(text).length, 0);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Light every row of a laid-out chapter that the selection covers.
 *
 * Offered here rather than in `term/reading.ts` because `ReadingOptions` takes
 * a single `cursorVerse`, and widening that to a range would change the one
 * function every screen lays text out through for the sake of one screen's
 * feature. Post-processing the rows costs a pass over what is about to be drawn
 * and keeps the change inside this file.
 *
 * The selection background is merged *under* each segment's own style, exactly
 * as the cursor highlight is, so a selected verse does not lose its red letter
 * or its italics on the way in.
 */
export function highlightSelection(
  lines: readonly ReadingLine[],
  range: VerseRange,
  theme: Theme,
): ReadingLine[] {
  if (range.end === range.start) return [...lines];

  // Merged styles are fresh objects and the renderer coalesces adjacent
  // segments by style *identity*, so the merge is memoised per base style —
  // exactly as `reading.ts` does it. Without that, a selected verse emits one
  // SGR pair per word instead of one per style change.
  const merged = new Map<Style | undefined, Style>();
  const under = (base: Style | undefined): Style => {
    const cached = merged.get(base);
    if (cached !== undefined) return cached;
    const style = mergeStyle(theme.cursorVerse, base);
    merged.set(base, style);
    return style;
  };

  return lines.map((line) => {
    if (line.verse === undefined || !rangeContains(range, line.verse)) return line;
    return {
      ...line,
      segments: line.segments.map((segment) => ({ ...segment, style: under(segment.style) })),
    };
  });
}

// --- clamping ------------------------------------------------------------

/** Into `1..verseCount`. The chapter is the boundary — see the file header. */
function clampVerse(verse: number, bounds: SelectionBounds): number {
  return Math.min(Math.max(1, verse), Math.max(1, bounds.verseCount));
}
