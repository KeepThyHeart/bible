/**
 * Selection and ranges (DesignSpec §4.2).
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
 * reader, so `Reader.ts` owns the three keys (`shift+↑`, `shift+↓`, `v`) and
 * this owns the arithmetic underneath them: resolving, extending, shrinking,
 * clamping, the `:sel` forms, and the summary the wireframe pins above the
 * input line.
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
 * 2. **The wireframe's own summary is chapter-relative** — `16-17 selected`,
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

/**
 * The least a verse has to offer for {@link selectParagraph}.
 *
 * Structural rather than a concrete type, so `DisplayVerse` (from
 * `verseText.ts`, which the reader already has laid out) satisfies it without
 * an adapter, and a test can hand over three object literals.
 *
 * `paragraphStart` comes from `BibleVerse.isParagraphStart()`, which reads the
 * v2 `formatting.block.paragraph_start` flag and falls back to v1's
 * `formatting_data.paragraphStart`. That fallback is why paragraph selection —
 * unlike span rendering — needs no formatting-version argument: the *block*
 * data is readable in both shapes, whereas v1 span offsets are expressed
 * against HTML words and are wrong unless converted (see the note in
 * `verseText.ts`).
 */
export interface ParagraphVerse {
  readonly verse: number;
  readonly paragraphStart: boolean;
  /** A psalm title or section heading. Also starts a paragraph — see below. */
  readonly heading?: string | undefined;
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
 * what `y` copies by default (§4.2). An anchor that is not in the cursor's own
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

/** Every verse number the selection covers, in order. */
export function selectedVerseNumbers(tab: TabState): number[] {
  const { start, end } = selectedRange(tab);
  const out: number[] = [];
  for (let verse = start; verse <= end; verse += 1) out.push(verse);
  return out;
}

/** True when `verse` (a verse number) falls inside the range. */
export function rangeContains(range: VerseRange, verse: number): boolean {
  return verse >= range.start && verse <= range.end;
}

// --- changing ------------------------------------------------------------

/**
 * `v` — arm the selection at the cursor without moving anything.
 *
 * That is genuinely all it does, and it is what makes the wireframe's `v then ↓`
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
  // selection made with `shift+arrow`, `:sel` or a paragraph command leaves the
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
 * Select an explicit range, clamped into the chapter.
 *
 * The cursor lands on `end` rather than on `start`, because every way of asking
 * for a range names it in reading order and the useful place to be afterwards
 * is at the bottom of what you just selected — the next `shift+↓` grows it.
 */
export function setSelection(
  tab: TabState,
  start: number,
  end: number,
  bounds: SelectionBounds,
): TabState {
  const first = clampVerse(Math.min(start, end), bounds);
  const last = clampVerse(Math.max(start, end), bounds);
  return {
    ...tab,
    selectionAnchor:
      first === last ? undefined : VerseIdHelper.calculate(bounds.bookNumber, bounds.chapter, first),
    cursorVerse: VerseIdHelper.calculate(bounds.bookNumber, bounds.chapter, last),
  };
}

/**
 * `:sel para` — the paragraph the cursor verse is in.
 *
 * A paragraph runs from the last break at or before the cursor to the verse
 * before the next break, both clamped to the chapter. **A heading starts a
 * paragraph too**, and it has to: `layoutReading` flushes the current paragraph
 * when a verse carries one, so a selection that ignored headings would run
 * across a break the user can plainly see on screen. Matching what is drawn
 * matters more here than matching the module's `paragraph_start` flag alone,
 * because the selection is checked by eye.
 *
 * A chapter with no breaks at all is one paragraph, which is the right answer
 * rather than a degenerate one — plenty of short chapters carry no flags.
 */
export function selectParagraph(
  tab: TabState,
  verses: readonly ParagraphVerse[],
  bounds: SelectionBounds,
): TabState {
  const cursor = VerseIdHelper.parse(tab.cursorVerse).verse;
  const ordered = [...verses].sort((a, b) => a.verse - b.verse);
  if (ordered.length === 0) return tab;

  let start = ordered[0]!.verse;
  let end = ordered[ordered.length - 1]!.verse;

  for (const verse of ordered) {
    if (!startsParagraph(verse)) continue;
    if (verse.verse <= cursor) start = verse.verse;
    else {
      end = verse.verse - 1;
      break;
    }
  }

  return setSelection(tab, start, end, bounds);
}

function startsParagraph(verse: ParagraphVerse): boolean {
  return verse.paragraphStart || (verse.heading !== undefined && verse.heading !== '');
}

/**
 * The cursor and anchor a reference implies — `16-17`, `3:16-17` (§4.1, "that
 * range, selected on arrival").
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

// --- the `:sel` command --------------------------------------------------

/** What `:sel …` asked for. */
export type SelArgument =
  | { readonly kind: 'range'; readonly start: number; readonly end: number }
  | { readonly kind: 'paragraph' };

const SEL_RANGE = /^(\d+)\s*-\s*(\d+)$/;
const SEL_VERSE = /^(\d+)$/;

/**
 * Parse the argument of `:sel`. The commands wireframe defines two forms,
 * `:sel 16-17` and `:sel para`; a bare `:sel 16` is accepted as the degenerate
 * range because refusing it would be a rule with nothing behind it.
 *
 * Returns `undefined` for anything else, so the caller reports what the forms
 * are instead of silently selecting something the user did not ask for.
 */
export function parseSelArgument(args: string): SelArgument | undefined {
  const text = args.trim().toLowerCase();
  if (text === 'para' || text === 'paragraph') return { kind: 'paragraph' };

  const range = SEL_RANGE.exec(text);
  if (range !== null) {
    return { kind: 'range', start: Number(range[1]), end: Number(range[2]) };
  }

  const single = SEL_VERSE.exec(text);
  if (single !== null) {
    const verse = Number(single[1]);
    return { kind: 'range', start: verse, end: verse };
  }

  return undefined;
}

/** `:sel …` end to end. `undefined` means the argument was not one of the forms. */
export function applySelCommand(
  tab: TabState,
  args: string,
  verses: readonly ParagraphVerse[],
  bounds: SelectionBounds,
): TabState | undefined {
  const parsed = parseSelArgument(args);
  if (parsed === undefined) return undefined;
  return parsed.kind === 'paragraph'
    ? selectParagraph(tab, verses, bounds)
    : setSelection(tab, parsed.start, parsed.end, bounds);
}

// --- what it says on screen ----------------------------------------------

/**
 * The right-hand status when a selection is live: `16-17 selected`.
 *
 * Empty for a bare cursor, because the reader's own `v16/36` already says where
 * the cursor is and repeating it as a one-verse "selection" would make the
 * status say the same thing twice.
 */
export function selectionStatus(tab: TabState): string {
  const range = selectedRange(tab);
  if (range.end === range.start) return '';
  return `${range.start}-${range.end} selected`;
}

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
 * The two rows the wireframe pins directly above the input line:
 *
 * ```
 *   John 3:16-17 selected — 2 verses, 47 words.   y copies · esc clears
 *   Also selects:  shift+↓   v then ↓   16-17   3:16-17   :sel para
 * ```
 *
 * These go in `ScreenView.notice`, which exists for exactly this and had no
 * caller until now. The second row is a teaching line, so it is **dropped
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

  const teach = 'Also selects:  shift+↓   v then ↓   16-17   3:16-17   :sel para';
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
 * and keeps the change inside this lane.
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
