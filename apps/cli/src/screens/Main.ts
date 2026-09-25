/**
 * The main screen, and the app's only one: a two-pane layout — a main pane
 * (the Bible in reading mode, or the open study resource in study mode) and a
 * narrower right-hand pane (the current verse, then the keyboard-shortcut
 * legend) — plus a session history.
 *
 * **Reading mode vs. study mode.** `studyView === 'hints'` *is* reading mode:
 * the main pane shows the chapter, `↑`/`↓` move the verse cursor, and the
 * right pane's legend is the full command list (`hintsRows`). Any other
 * `StudyView` is study mode: the main pane shows that resource instead, `↑`/
 * `↓` scroll it rather than the verse (`scrollStudy`), and `<`/`>` step the
 * verse cursor while staying on the resource, for the views where that means
 * something (`VERSE_STEP_VIEWS`) — see `stepStudyVerse`. This mapping is why
 * there is no separate "is the study pane open" flag any more: the main
 * pane's content and `studyView` are the same fact. The right pane itself
 * only exists on a wide-enough terminal (`RIGHT_PANE_BREAKPOINT_COLUMNS`);
 * narrower than that, `narrowStudyRows` folds a one-line verse header into the
 * top of the main pane instead, and the footer's one-line hint carries the
 * shortcuts.
 *
 * Study views (`StudyView`): `hints` (reading mode), `x` cross references,
 * `c`/`m` commentaries, `t` topics, `d` dictionaries, `k` books, `h` history,
 * `o` options, `b` bookmarks and `/` search results. Each is a view the main
 * pane switches into, **not** a pushed `Screen`: the verse cursor stays live
 * beside every one of them ("every study view follows the verse cursor"),
 * which only works if `MainScreen` keeps owning the cursor while a study view
 * is showing. The data behind each view is pure and lives in
 * `app/studyPanes.ts`, `app/history.ts`, `app/bookmarks.ts` and
 * `app/search.ts` (no rendering, no keys); this screen turns their rows into
 * `StyledLine`s and owns every key.
 *
 * - **Numbered pickers** (`PICKER_VIEWS`, `pickerKey`): type a number, then
 *   Enter, to pick a row. A dictionary's entry list is the one picker that
 *   accepts four digits instead of two (`pickerDigits`): a Strong's module's
 *   "G"/"H" buckets run into the thousands.
 * - **Dictionaries and books** are not verse-scoped, so each is a browser.
 *   `d` drills list, letter index, that letter's entries, one entry; `k` drills
 *   list, table of contents (recursively, one level of children at a time,
 *   via `bookSectionStack`), one section. Both leaf reading views reuse
 *   `layoutCommentary`, as a commentary entry does. Neither is in
 *   `VERSE_STEP_VIEWS`: `<`/`>` has nothing to step them by.
 * - **Options** (`o`) is a plain menu, not a picker: `↑`/`↓` move the selected
 *   row (`optionsSelected`) and `←`/`→` change its value — see `optionsKey`
 *   and `stepOptionRow`. It used to be a numbered row plus Enter, which cycled
 *   the value instead of setting it; that interaction is gone.
 * - **Bookmarks** (`app/bookmarks.ts`) are a flat, user-ordered list in
 *   `~/.bible/state.db`: a typed row number plus a letter acts on it: `a`dd,
 *   `r`ename, re-`p`oint, `d`elete (twice, to confirm), `[`/`]` to reorder;
 *   Enter alone is a plain jump, like every other picker's numbers. Renaming
 *   needs free text from a screen that cannot open the input line itself
 *   (`app/App.ts`'s docblock): `r` arms `bookmarkRenameTarget`, and the next
 *   line submitted through `/` is read as the new name rather than classified
 *   as a reference or a search (`nameFromIntent`).
 * - **Search** (`/`, `app/search.ts`) fills the `searchResults` view, on the
 *   same numbered-picker pattern as every other list.
 * - `m` reopens the last-opened commentary (`ctx.lastCommentary`, persisted
 *   through the `lastCommentary` action).
 * - **The "/" popup** (`commandPopup`) replaces the input line's old
 *   permanently-open entry box (`app/frame.ts`'s docblock): while `ctx.input`
 *   is open this screen returns an `overlay` with usage text, a live preview
 *   of how the typed text classifies (`classifyInput`), and up to five
 *   matching book names.
 *
 * Reuses `term/reading.ts`'s `layoutReading` for the chapter itself (paragraph
 * flow, the cursor highlight, verse numbers), `app/selection.ts` for
 * shift+up/down, `app/verseText.ts` for the styled runs,
 * `app/commentaryMarkup.ts`'s `layoutCommentary` for turning a commentary
 * entry's markup into terminal rows, and the shell in `app/App.ts` for chrome,
 * the input line, persistence and the screen contract (`screens/types.ts`).
 * `screens/Modules.ts` (`^O`, the module library) is a separate screen.
 */
import { ENGLISH_BOOK_NAMES, VerseIdHelper, type CommentaryEntry } from '@bible/core';

import {
  addBookmark,
  bookmarkAt,
  moveBookmark,
  removeBookmark,
  renameBookmark,
  rePointBookmark,
  type Bookmark,
} from '../app/bookmarks';
import { classifyInput, type Intent, type ResolvedReference } from '../app/input';
import {
  addHistoryEntry,
  arrayIndexToDisplayIndex,
  displayIndexToArrayIndex,
  displayOrder,
  emptyHistory,
  navigateToIndex,
  type HistoryEntry,
  type HistorySlot,
} from '../app/history';
import {
  MIN_PANE_WIDTH,
  PANE_SEPARATOR_WIDTH,
  RIGHT_PANE_BREAKPOINT_COLUMNS,
  RIGHT_PANE_WIDTH,
} from '../app/layoutConfig';
import { MARGIN } from '../app/frame';
import type { Chapter, OpenBible } from '../app/library';
import { distributionGraph, runSearch, type SearchOutcome } from '../app/search';
import {
  beginSelection,
  clearSelection,
  hasSelection,
  highlightSelection,
  isSelectionArmed,
  moveSelection,
  selectedRange,
  selectionForReference,
  selectionSummary,
  type SelectionBounds,
  type VerseRange,
} from '../app/selection';
import { cursorVerseNumber, type TabState } from '../app/state';
import {
  bestCommentaryEntry,
  bookListRows,
  bookSection,
  bookSectionRows,
  commentaryListRows,
  crossReferenceGroups,
  dictionaryEntry,
  dictionaryEntryRows,
  dictionaryListRows,
  dictionaryLetterRows,
  topicListRows,
  topicVerseRows,
} from '../app/studyPanes';
import { toDisplayVerse, type DisplayVerse } from '../app/verseText';
import { copyToClipboard, describeFailure } from '../term/clipboard';
import type { Key } from '../term/keys';
import {
  ellipsize,
  makeToken,
  padLineTo,
  padTo,
  tokenizeText,
  truncateLineToWidth,
  wrapTokens,
} from '../term/layout';
import { clampScroll, layoutReading, type ReadingLine } from '../term/reading';
import type { ColorDepth, StyledLine } from '../term/style';
import { layoutCommentary } from '../app/commentaryMarkup';
import type {
  DisplaySettings,
  Overlay,
  Screen,
  ScreenAction,
  ScreenContext,
  ScreenResult,
  ScreenView,
  VerseNumberStyle,
} from './types';

/** Title + blank line above the chapter text. */
const TITLE_ROWS = 2;

interface Laid {
  readonly bible: OpenBible;
  readonly chapter: Chapter;
  readonly verses: readonly DisplayVerse[];
  readonly lines: readonly ReadingLine[];
}

interface Dimensions {
  /** Whether the terminal is wide enough to draw the right-hand pane at all. */
  readonly showRightPane: boolean;
  readonly totalWidth: number;
  /** Width of the main pane — the full width when the right pane is not shown. */
  readonly mainWidth: number;
  /** Width of the right-hand pane; `0` when it is not shown. */
  readonly rightWidth: number;
}

type StudyView =
  | 'hints'
  | 'history'
  | 'crossReferences'
  | 'commentaryList'
  | 'commentaryEntry'
  | 'topicsList'
  | 'topicVerses'
  | 'dictionaryList'
  | 'dictionaryLetters'
  | 'dictionaryEntries'
  | 'dictionaryEntry'
  | 'bookList'
  | 'bookSections'
  | 'bookEntry'
  | 'options'
  | 'bookmarksList'
  | 'searchResults';

/** The views a numbered buffer plus Enter picks a row in. */
const PICKER_VIEWS: ReadonlySet<StudyView> = new Set([
  'crossReferences',
  'commentaryList',
  'topicsList',
  'topicVerses',
  'dictionaryList',
  'dictionaryLetters',
  'dictionaryEntries',
  'bookList',
  'bookSections',
  'searchResults',
]);

/**
 * The study views `<`/`>` step the verse cursor in, one verse at a time,
 * while staying on the same resource (`stepStudyVerse`) — the Navigation
 * requirement's "prev/next verse while keeping the current resource".
 *
 * Every one of these already re-reads `ctx.tab.cursorVerse` on every render
 * (`crossReferenceGroups`, `commentaryListRows`/`bestCommentaryEntry`,
 * `topicListRows`, `topicVerseRows`'s parent list), so stepping the cursor is
 * enough to make the view follow — no view-specific refresh logic is needed.
 * Left out on purpose: dictionaries, books, bookmarks, history and search are
 * keyed by a word, a section, a saved point, a session or a query, not by the
 * cursor verse, so `<`/`>` would move an invisible cursor with nothing on
 * screen to show for it.
 */
const VERSE_STEP_VIEWS: ReadonlySet<StudyView> = new Set([
  'crossReferences',
  'commentaryList',
  'commentaryEntry',
  'topicsList',
  'topicVerses',
]);

/**
 * How many hits `/` shows, per {@link RunSearchOptions.maxResults}.
 *
 * Every other picker in this app is a two-digit field, and a search can
 * otherwise run into the hundreds — core's own default is 200. Capped at two
 * digits rather than widened to match: a Bible search is for finding a verse
 * you half-remember, not for reading every occurrence of "the".
 */
const MAX_SEARCH_RESULTS = 99;

/**
 * How many digits `pickerBuffer` accepts before Enter is needed. Two for
 * every list, except a dictionary's entry list, whose "G"/"H" buckets run into the
 * thousands on a Strong's module, where a two-digit cap would leave almost
 * everything unreachable.
 */
function pickerDigits(view: StudyView): number {
  return view === 'dictionaryEntries' ? 4 : 2;
}

/**
 * Where `esc` in a `PICKER_VIEWS` list goes back to. A fixed parent per view,
 * since each of these is one linear drill-down (list → sub-list → entry), not
 * a tree with several ways in — `bookSections`'s stack pop is handled in
 * `pickerKey` itself, before this ever runs.
 */
function pickerEscapeTarget(view: StudyView): StudyView {
  switch (view) {
    case 'topicVerses':
      return 'topicsList';
    case 'dictionaryLetters':
      return 'dictionaryList';
    case 'dictionaryEntries':
      return 'dictionaryLetters';
    case 'bookSections':
      return 'bookList';
    default:
      return 'hints';
  }
}

// --- options (`o`) ---------------------------------------------------------

/**
 * One stop in a setting's cycle, and how to reach it.
 */
interface OptionChoice {
  readonly label: string;
  readonly apply: (ctx: ScreenContext) => ScreenAction;
}

interface OptionRow {
  readonly label: string;
  readonly current: (ctx: ScreenContext) => string;
  /** A function of `ctx` rather than a fixed list: Translation's choices are
   * whatever the library has installed, which the tab alone cannot say. */
  readonly choices: (ctx: ScreenContext) => readonly OptionChoice[];
}

/** A choice that changes a global display setting. */
function displayOption(
  label: string,
  change: (display: DisplaySettings) => DisplaySettings,
): OptionChoice {
  return { label, apply: (ctx) => ({ kind: 'display', display: change(ctx.display) }) };
}

const VERSE_NUMBER_STYLES: readonly VerseNumberStyle[] = [
  'superscript',
  'margin',
  'inline',
  'hidden',
];

/** Depths named in terms a reader has a way to judge. */
const COLOUR_CHOICES: readonly { readonly label: string; readonly depth: ColorDepth | 'auto' }[] = [
  { label: 'auto', depth: 'auto' },
  { label: 'full', depth: 'ansi256' },
  { label: '16', depth: 'ansi16' },
  { label: 'none', depth: 'none' },
];

/** Every installed Bible, alphabetical by abbreviation — Translation's row. */
function translationChoices(ctx: ScreenContext): readonly OptionChoice[] {
  const modules = [...ctx.library.bibleModules()].sort((a, b) =>
    a.abbreviation.localeCompare(b.abbreviation),
  );
  return modules.map((module) => ({
    label: module.abbreviation.toUpperCase(),
    apply: (c) => ({
      kind: 'tab',
      tab: { ...c.tab, translation: module.abbreviation.toUpperCase(), scrollOffset: 0 },
    }),
  }));
}

/**
 * Every setting `o` shows, in the order the numbered rows list them. Adding
 * one is a record here.
 */
const OPTION_ROWS: readonly OptionRow[] = [
  {
    label: 'Translation',
    current: (ctx) => ctx.tab.translation,
    choices: translationChoices,
  },
  {
    label: 'Layout',
    current: (ctx) => ctx.tab.displayMode,
    choices: () =>
      (['paragraph', 'numbered'] as const).map((mode) => ({
        label: mode,
        apply: (ctx) => ({ kind: 'tab', tab: { ...ctx.tab, displayMode: mode, scrollOffset: 0 } }),
      })),
  },
  {
    label: 'Verse numbers',
    current: (ctx) => ctx.display.verseNumbers,
    choices: () =>
      VERSE_NUMBER_STYLES.map((style) => displayOption(style, (d) => ({ ...d, verseNumbers: style }))),
  },
  {
    label: 'Break on verse',
    current: (ctx) => (ctx.display.breakOnVerse ? 'on' : 'off'),
    choices: () => [
      displayOption('off', (d) => ({ ...d, breakOnVerse: false })),
      displayOption('on', (d) => ({ ...d, breakOnVerse: true })),
    ],
  },
  {
    label: 'Words of Christ',
    current: (ctx) => (ctx.display.redLetter ? 'red' : 'plain'),
    choices: () => [
      displayOption('red', (d) => ({ ...d, redLetter: true })),
      displayOption('plain', (d) => ({ ...d, redLetter: false })),
    ],
  },
  {
    label: 'Supplied words',
    current: (ctx) => (ctx.display.showSupplied ? 'italic' : 'plain'),
    choices: () => [
      displayOption('italic', (d) => ({ ...d, showSupplied: true })),
      displayOption('plain', (d) => ({ ...d, showSupplied: false })),
    ],
  },
  {
    label: 'Scroll',
    current: (ctx) => ctx.display.scroll,
    choices: () => [
      displayOption('stepped', (d) => ({ ...d, scroll: 'stepped' })),
      displayOption('instant', (d) => ({ ...d, scroll: 'instant' })),
    ],
  },
  {
    label: 'Colour',
    current: (ctx) => COLOUR_CHOICES.find((c) => c.depth === ctx.display.colour)?.label ?? 'auto',
    choices: () => COLOUR_CHOICES.map((c) => displayOption(c.label, (d) => ({ ...d, colour: c.depth }))),
  },
];

/**
 * The choice one step away from a row's current value, wrapping at either
 * end — `←`/`→` in the options menu (`optionsKey`).
 *
 * Used to cycle a numbered row to its *next* value with no way to go back;
 * `direction` replaces that with an ordinary two-way stepper, which is what
 * "up/down navigates options sensibly" (the Navigation requirement) needed
 * for the value itself, not just which row is selected.
 */
function stepOptionRow(row: OptionRow, ctx: ScreenContext, direction: 1 | -1): ScreenAction {
  const choices = row.choices(ctx);
  if (choices.length === 0) {
    return { kind: 'message', text: `No ${row.label.toLowerCase()} to choose from.`, tone: 'error' };
  }
  const at = choices.findIndex((c) => c.label === row.current(ctx));
  const from = at === -1 ? 0 : at;
  const next = choices[(from + direction + choices.length) % choices.length] ?? choices[0]!;
  return next.apply(ctx);
}

// --- study-mode verse stepping (`<`/`>`) ------------------------------------

/**
 * Whether two commentary entries are the same underlying passage —
 * `stepStudyVerse`'s "don't silently jump" guard.
 *
 * `entryId` is the real identity when the repository set one; falling back to
 * the verse span covers a module or a code path that leaves it unset, since
 * two entries covering exactly the same verses are, for this purpose, the
 * same entry even if nothing else is known about them.
 */
function sameCommentaryEntry(a: CommentaryEntry, b: CommentaryEntry): boolean {
  if (a.entryId !== undefined && b.entryId !== undefined) return a.entryId === b.entryId;
  return a.verseIdStart === b.verseIdStart && a.verseIdEnd === b.verseIdEnd;
}

// --- bookmarks (`b`) --------------------------------------------------------

/**
 * What a rename typed on the shell's input line is taken to mean.
 *
 * `search` is the overwhelmingly common case — free text that is not a
 * reference or a step is classified as a search, and its `query`
 * is the trimmed text exactly as typed (`app/input.ts`). A name that happens
 * to *parse* as a reference (`3:16`, `john 3:16`) is read back through
 * {@link formatResolvedReference} instead of being lost: that reconstructs
 * the same words the reference parser accepted, so naming a bookmark after
 * its own passage works instead of silently failing. A chapter
 * step (`<`, `+5`) carries no text to recover and is rejected.
 */
function nameFromIntent(ctx: ScreenContext, intent: Intent): string | undefined {
  switch (intent.kind) {
    case 'search':
      return intent.query.trim().length > 0 ? intent.query.trim() : undefined;
    case 'reference':
      return formatResolvedReference(ctx, intent.reference);
    case 'step-unit':
    case 'step-verse':
    case 'empty':
      return undefined;
  }
}

function formatResolvedReference(ctx: ScreenContext, reference: ResolvedReference): string {
  const book = ctx.library.bookName(reference.book);
  const verse = reference.verse === undefined ? '' : `:${reference.verse}`;
  const end =
    reference.endChapter !== undefined
      ? `-${reference.endChapter}:${reference.endVerse}`
      : reference.endVerse !== undefined
        ? `-${reference.endVerse}`
        : '';
  return `${book} ${reference.chapter}${verse}${end}`;
}

export class MainScreen implements Screen {
  readonly name = 'main';

  private cache: { key: string; laid: Laid } | undefined;

  /** Session history — lasts for this run only. */
  private history: HistorySlot = emptyHistory();

  private studyView: StudyView = 'hints';
  /**
   * `s`, in reading mode, on a terminal too narrow for the right pane: shows
   * the shortcut legend (`hintsRows`) in the main pane in place of the Bible
   * text, without leaving reading mode — `↑`/`↓` still move the verse, not
   * the legend. A wide terminal never consults this: the right pane already
   * shows the legend all the time, so there is nothing for `s` to reveal
   * (`character`'s `s` handler is a harmless no-op there).
   */
  private narrowHintsPeek = false;
  /** Digits typed while choosing a history row — a screen key, not the shell's line (§ shell docs). */
  private historyBuffer = '';
  /** Digits typed while choosing a numbered row in `PICKER_VIEWS` — same idea, one field for all four. */
  private pickerBuffer = '';
  /** How far the Study pane is scrolled past the top of its current view's content. */
  private studyScroll = 0;
  /** What `studyScroll` was last computed against; changing this resets it to 0. */
  private studyAnchor = '';
  /** The selected row in the options menu (`↑`/`↓`) — replaces the old numbered picker. */
  private optionsSelected = 0;
  /**
   * Whether the right pane's shortcut legend has taken over the space the
   * verse preview would use — `?` toggles it (Navigation/usability: "showing
   * more shortcuts if needed"). Ephemeral, like every other UI toggle here:
   * it is not worth a row in `state.db` for what is a per-session reading aid.
   */
  private shortcutsExpanded = false;
  /** The commentary `commentaryEntry` is reading. `m` and the commentary list both set this. */
  private commentaryModuleAbbreviation: string | undefined;
  /** Where `esc` from `commentaryEntry` goes back to. */
  private commentaryEntryOrigin: 'commentaryList' | 'hints' = 'commentaryList';
  /**
   * A `<`/`>` step in `commentaryEntry` that would land inside the *same*
   * commentary passage as the one already showing — held here rather than
   * applied, so the entry stays put and a notice explains why, instead of a
   * step that visibly does nothing. `f` (`commentaryEntryKey`) commits it: the
   * cursor verse moves to it, even though the text on screen does not change.
   * Set by `stepStudyVerse`, cleared by `confirmCommentaryStep`, by leaving
   * `commentaryEntry`, and by opening a (possibly different) commentary afresh.
   */
  private commentaryPendingVerse: number | undefined;
  /** The topic `topicVerses` is listing, and the module it came from. */
  private topicModuleAbbreviation: string | undefined;
  private topicId: number | undefined;
  /** The dictionary `dictionaryLetters`/`dictionaryEntries`/`dictionaryEntry` is browsing. */
  private dictionaryAbbreviation: string | undefined;
  /** The letter `dictionaryEntries` is listing. */
  private dictionaryLetter: string | undefined;
  /** The entry `dictionaryEntry` is reading. */
  private dictionaryEntryKey: string | undefined;
  /** The book `bookSections`/`bookEntry` is browsing. */
  private bookAbbreviation: string | undefined;
  /** The table-of-contents ids `bookSections` has drilled into, root first; empty at the top level. */
  private bookSectionStack: number[] = [];
  /** The section `bookEntry` is reading. */
  private bookSectionId: number | undefined;
  /** The last `/` search that was not a reference — `searchResults`'s content. */
  private searchOutcome: SearchOutcome | undefined;
  /**
   * The bookmark `r` is waiting to rename — set the moment `r` is pressed with
   * a valid row typed, so the *next* line submitted (`/`, the new name, Enter)
   * is taken as that bookmark's new name rather than a reference or a search.
   * A screen cannot open the input line itself (`app/App.ts`'s docblock: only
   * `/` and `:` do), so this is the one place a study view has to wait for a
   * keystroke the shell, not this screen, will decide the shape of.
   */
  private bookmarkRenameTarget: number | undefined;
  /** The bookmark `d` would delete on a second press — cleared by any other bookmarks key. */
  private bookmarkDeleteConfirm: number | undefined;

  view(ctx: ScreenContext): ScreenView {
    const laid = this.layout(ctx);
    if (laid === undefined) return emptyLibraryView(ctx);
    this.ensureHistorySeeded(ctx);

    const dims = this.dimensions(ctx);
    const bodyHeight = Math.max(1, ctx.bodyHeight);
    const reading = this.studyView === 'hints';
    // See `narrowHintsPeek`'s docblock: reading mode, peeking at the legend,
    // on a terminal with no right pane to show it in continuously.
    const peeking = reading && !dims.showRightPane && this.narrowHintsPeek;
    const showBible = reading && !peeking;

    const mainRows = showBible
      ? this.bibleRows(ctx, laid, bodyHeight)
      : dims.showRightPane
        ? this.studyRows(ctx, dims.mainWidth, bodyHeight)
        : this.narrowStudyRows(ctx, laid, dims.mainWidth, bodyHeight);

    const range = selectedRange(ctx.tab);
    const notice =
      showBible && hasSelection(ctx.tab)
        ? selectionSummary({
            reference: referenceOf(laid, range),
            texts: textsIn(laid, range),
            theme: ctx.theme,
            width: dims.mainWidth,
          })
        : undefined;

    const body = dims.showRightPane
      ? composeSideBySide(
          mainRows,
          this.rightPaneRows(ctx, laid, dims.rightWidth, bodyHeight),
          dims,
          bodyHeight,
          ctx.theme,
        )
      : mainRows;

    return {
      status: status(laid, ctx),
      body,
      hints: this.hintsText(dims.showRightPane, reading),
      ...(notice === undefined ? {} : { notice }),
      ...(ctx.inputOpen ? { overlay: this.commandPopup(ctx) } : {}),
    };
  }

  /** The chapter itself — reading mode's main-pane content. */
  private bibleRows(ctx: ScreenContext, laid: Laid, bodyHeight: number): StyledLine[] {
    const range = selectedRange(ctx.tab);
    const lit = highlightSelection(laid.lines, range, ctx.theme);
    const window = Math.max(1, bodyHeight - TITLE_ROWS);
    const offset = clampScroll(lit, cursorVerseNumber(ctx.tab), ctx.tab.scrollOffset, window);
    return padRows(
      [
        [{ text: `${laid.chapter.bookName} ${laid.chapter.chapter}`, style: ctx.theme.title }],
        [],
        ...lit.slice(offset, offset + window).map((l) => l.segments),
      ],
      bodyHeight,
    );
  }

  /**
   * Study mode's main-pane content on a terminal too narrow for the right
   * pane — the current verse folded into a one-line header (what the right
   * pane would otherwise be showing) above the resource itself, so the
   * "current verse" fact is not lost, only its dedicated column.
   */
  private narrowStudyRows(ctx: ScreenContext, laid: Laid, width: number, height: number): StyledLine[] {
    const cursorNum = cursorVerseNumber(ctx.tab);
    const header: StyledLine = [
      { text: `${laid.chapter.bookName} ${laid.chapter.chapter}:${cursorNum}`, style: ctx.theme.title },
    ];
    const preview = laid.lines.filter((l) => l.verse === cursorNum).map((l) => l.segments);
    const top = [header, ...preview, []];
    return padRows([...top, ...this.studyRows(ctx, width, Math.max(0, height - top.length))], height);
  }

  key(key: Key, ctx: ScreenContext): ScreenResult {
    const laid = this.layout(ctx);
    if (laid === undefined) return { kind: 'none' };

    const handled = this.subViewKey(key, ctx);
    if (handled !== undefined) return handled;

    const window = Math.max(1, ctx.bodyHeight - TITLE_ROWS);
    const studying = this.studyView !== 'hints';

    // Study mode: up/down scroll the resource, not the verse (Navigation
    // requirement). Shift makes it a page, matching pgup/pgdn below, since
    // there is no selection to extend outside reading mode.
    if (key.name === 'up' || key.name === 'down') {
      if (studying) {
        const step = key.shift ? Math.max(1, ctx.bodyHeight - 2) : 1;
        return this.scrollStudy(key.name === 'up' ? -step : step);
      }
      if (key.shift) return this.extend(ctx, laid, key.name === 'up' ? -1 : 1, window);
      const active = isSelectionArmed(ctx.tab) ? ctx : { ...ctx, tab: clearSelection(ctx.tab) };
      return this.moveVerse(active, laid, key.name === 'up' ? -1 : 1, window);
    }

    switch (key.name) {
      case 'escape':
        return hasSelection(ctx.tab) ? { kind: 'tab', tab: clearSelection(ctx.tab) } : { kind: 'none' };
      case 'pageup':
      case 'pagedown':
        return studying
          ? this.scrollStudy(key.name === 'pagedown' ? Math.max(1, ctx.bodyHeight - 2) : -Math.max(1, ctx.bodyHeight - 2))
          : { kind: 'none' };
      case 'char':
      case 'space':
        if (key.ctrl) return { kind: 'none' };
        if (key.alt && key.char === 'c') return this.copy(ctx, laid);
        if (key.alt) return { kind: 'none' };
        // `space` pages study mode's content when it has not claimed the key
        // some other way (`subViewKey` already ran); otherwise it falls
        // through as an ordinary character.
        if (key.name === 'space' && studying) {
          return this.scrollStudy(Math.max(1, ctx.bodyHeight - 2));
        }
        return this.character(key.char ?? '', ctx, laid, window);
      default:
        return { kind: 'none' };
    }
  }

  submit(intent: Intent, ctx: ScreenContext): ScreenResult {
    // `r` left a bookmark waiting for its new name — the *next* line submitted
    // is that name, not a reference or a search, however it happens to parse.
    if (this.bookmarkRenameTarget !== undefined) return this.applyBookmarkRename(intent, ctx);

    const laid = this.layout(ctx);
    if (laid === undefined) return { kind: 'none' };
    const window = Math.max(1, ctx.bodyHeight - TITLE_ROWS);

    switch (intent.kind) {
      case 'reference':
        return this.goToReference(ctx, intent.reference, window);
      case 'step-unit':
        return this.moveChapter(ctx, laid, intent.delta);
      case 'step-verse':
        return this.stepVerses(ctx, laid, intent.delta, window);
      case 'search':
        return this.runSearchView(intent.query, ctx);
      case 'empty':
        return { kind: 'none' };
    }
  }

  /**
   * `/` text that is not a reference. Asynchronous because `runSearch` is — `app/App.ts`'s
   * `resolve` awaits a screen's `ScreenResult` exactly for this — so the
   * outcome is stored on `this` and the pane switched only once it lands.
   */
  private async runSearchView(query: string, ctx: ScreenContext): Promise<ScreenAction> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return { kind: 'none' };

    this.searchOutcome = await runSearch(
      trimmed,
      { library: ctx.library, translation: ctx.tab.translation, bookNumber: ctx.tab.bookNumber },
      { maxResults: MAX_SEARCH_RESULTS },
    );
    this.pickerBuffer = '';
    this.studyView = 'searchResults';
    return { kind: 'redraw' };
  }

  // --- single-key commands -------------------------------------------------

  private character(char: string, ctx: ScreenContext, laid: Laid, window: number): ScreenAction {
    if (char === 'q') return { kind: 'quit' };
    if (char === 'y') return this.copy(ctx, laid);
    if (char === 'v') return { kind: 'tab', tab: beginSelection(ctx.tab) };
    if (char === 'n') return this.moveChapter(ctx, laid, 1);
    if (char === 'p') return this.moveChapter(ctx, laid, -1);

    // Reading mode: `<`/`>` step the chapter, same as `n`/`p`. Study mode:
    // they step the verse cursor instead, staying on the same resource — the
    // Navigation requirement's "prev/next verse while keeping the current
    // resource" — for the views that follow the cursor at all.
    if (char === '>' || char === '<') {
      const delta = char === '>' ? 1 : -1;
      if (this.studyView === 'hints') return this.moveChapter(ctx, laid, delta);
      if (!VERSE_STEP_VIEWS.has(this.studyView)) return { kind: 'none' };
      return this.stepStudyVerse(ctx, laid, delta, window);
    }

    // `?` — the right pane's shortcut legend takes over the verse preview's
    // space, for when there are more shortcuts than fit (usability pass).
    if (char === '?') {
      this.shortcutsExpanded = !this.shortcutsExpanded;
      return { kind: 'redraw' };
    }

    // Study mode: leave it, back to reading. Reading mode: toggle
    // `narrowHintsPeek` (a no-op on a wide terminal — see its docblock).
    // Replaces the old wide/narrow show-or-hide toggle, which has no
    // equivalent left now that the main pane always shows *something* and a
    // wide terminal's right pane shows the legend continuously.
    if (char === 's') {
      if (this.studyView !== 'hints') {
        this.studyView = 'hints';
        return { kind: 'redraw' };
      }
      this.narrowHintsPeek = !this.narrowHintsPeek;
      return { kind: 'redraw' };
    }

    if (char === 'h') {
      this.studyView = 'history';
      this.historyBuffer = '';
      return { kind: 'redraw' };
    }

    if (char === 'x') {
      this.studyView = 'crossReferences';
      this.pickerBuffer = '';
      return { kind: 'redraw' };
    }

    if (char === 'c') {
      this.studyView = 'commentaryList';
      this.pickerBuffer = '';
      return { kind: 'redraw' };
    }

    if (char === 'm') return this.openLastCommentary(ctx);

    if (char === 't') {
      this.studyView = 'topicsList';
      this.pickerBuffer = '';
      return { kind: 'redraw' };
    }

    if (char === 'd') {
      this.studyView = 'dictionaryList';
      this.pickerBuffer = '';
      return { kind: 'redraw' };
    }

    if (char === 'k') {
      this.studyView = 'bookList';
      this.pickerBuffer = '';
      return { kind: 'redraw' };
    }

    if (char === 'o') {
      this.studyView = 'options';
      this.optionsSelected = 0;
      return { kind: 'redraw' };
    }

    if (char === 'b') {
      this.studyView = 'bookmarksList';
      this.pickerBuffer = '';
      this.bookmarkDeleteConfirm = undefined;
      return { kind: 'redraw' };
    }

    return { kind: 'none' };
  }

  /** `pgup`/`pgdn`/`space`/`↑↓` in study mode — the pane scrolls on its own keys. */
  private scrollStudy(delta: number): ScreenAction {
    // Clamped against the real content length in `studyRows`, which is the
    // only place that number is known; a deliberate overshoot here is how
    // `end`-style requests would work too, though nothing sends one yet.
    this.studyScroll += delta;
    return { kind: 'redraw' };
  }

  /**
   * `<`/`>` in a `VERSE_STEP_VIEWS` view — step the verse cursor one at a
   * time, staying on the resource. Every such view already re-reads
   * `ctx.tab.cursorVerse` on every render, so most of them just follow.
   *
   * `commentaryEntry` is the exception: its one entry can span several
   * verses, so a step that would land inside the entry already showing is
   * held rather than applied (`commentaryPendingVerse`) — see the class
   * docblock and `commentaryEntryRows`'s notice.
   */
  private stepStudyVerse(ctx: ScreenContext, laid: Laid, delta: number, window: number): ScreenAction {
    const proposed = this.moveVerse(ctx, laid, delta, window);
    if (proposed.kind !== 'tab') return proposed;

    if (this.studyView !== 'commentaryEntry' || this.commentaryModuleAbbreviation === undefined) {
      this.commentaryPendingVerse = undefined;
      return proposed;
    }

    const module = ctx.library.studyModule('commentary', this.commentaryModuleAbbreviation);
    if (module === undefined) {
      this.commentaryPendingVerse = undefined;
      return proposed;
    }

    const current = bestCommentaryEntry(module, ctx.tab.cursorVerse);
    const target = bestCommentaryEntry(module, proposed.tab.cursorVerse);
    if (current !== undefined && target !== undefined && sameCommentaryEntry(current, target)) {
      this.commentaryPendingVerse = proposed.tab.cursorVerse;
      return { kind: 'redraw' };
    }

    this.commentaryPendingVerse = undefined;
    return proposed;
  }

  /** `f` — commit a step `stepStudyVerse` held because it stayed inside the same commentary passage. */
  private confirmCommentaryStep(ctx: ScreenContext): ScreenAction {
    const verseId = this.commentaryPendingVerse;
    this.commentaryPendingVerse = undefined;
    if (verseId === undefined) return { kind: 'none' };

    const { bookNumber, chapter } = VerseIdHelper.parse(verseId);
    const tab: TabState = { ...ctx.tab, bookNumber, chapter, cursorVerse: verseId, selectionAnchor: undefined };
    return { kind: 'tab', tab };
  }

  /** `m` — the last commentary opened this session (`ctx.lastCommentary`, persisted by the shell), or the first with something here. */
  private openLastCommentary(ctx: ScreenContext): ScreenAction {
    const rows = commentaryListRows(ctx.library, ctx.tab.cursorVerse);
    if (rows.length === 0) return { kind: 'message', text: 'No commentary is installed.' };

    const wanted = ctx.lastCommentary;
    const chosen = rows.find((r) => r.abbreviation === wanted) ?? rows.find((r) => r.hasEntry) ?? rows[0]!;

    this.commentaryModuleAbbreviation = chosen.abbreviation;
    this.commentaryEntryOrigin = 'hints';
    this.commentaryPendingVerse = undefined;
    this.studyView = 'commentaryEntry';
    return chosen.abbreviation === wanted
      ? { kind: 'redraw' }
      : { kind: 'lastCommentary', abbreviation: chosen.abbreviation };
  }

  // --- sub-view keys (history, and the four numbered pickers) ----------------

  /** Dispatches a key to whichever sub-view owns the Study pane. `undefined` means "not claimed". */
  private subViewKey(key: Key, ctx: ScreenContext): ScreenResult | undefined {
    if (this.studyView === 'history') return this.historyKey(key, ctx);
    if (this.studyView === 'commentaryEntry') return this.commentaryEntryKey(key, ctx);
    if (this.studyView === 'dictionaryEntry') return this.dictionaryReadingKey(key);
    if (this.studyView === 'bookEntry') return this.bookReadingKey(key);
    if (this.studyView === 'options') return this.optionsKey(key, ctx);
    if (this.studyView === 'bookmarksList') return this.bookmarksKey(key, ctx);
    if (PICKER_VIEWS.has(this.studyView)) return this.pickerKey(key, ctx);
    return undefined;
  }

  /** Handles a key while the History list has the study pane. `undefined` means "not ours". */
  private historyKey(key: Key, ctx: ScreenContext): ScreenResult | undefined {
    if (key.name === 'escape') {
      this.studyView = 'hints';
      this.historyBuffer = '';
      return { kind: 'redraw' };
    }
    if (key.name === 'backspace') {
      this.historyBuffer = this.historyBuffer.slice(0, -1);
      return { kind: 'redraw' };
    }
    if (key.name === 'char' && key.char !== undefined && /^[0-9]$/.test(key.char)) {
      this.historyBuffer = (this.historyBuffer + key.char).slice(0, 2);
      return { kind: 'redraw' };
    }
    if (key.name === 'enter') {
      return this.pickHistory(ctx);
    }
    // Any other key falls through to ordinary navigation (arrows still move
    // the verse and the history list follows).
    return undefined;
  }

  /**
   * `esc` from a commentary entry — back to the list it was opened from, or
   * to the hints (`m`). `f` — while `stepStudyVerse` is holding a step inside
   * the same passage — commits it (`confirmCommentaryStep`).
   */
  private commentaryEntryKey(key: Key, ctx: ScreenContext): ScreenResult | undefined {
    if (key.name === 'escape') {
      this.studyView = this.commentaryEntryOrigin;
      this.commentaryPendingVerse = undefined;
      return { kind: 'redraw' };
    }
    if (this.commentaryPendingVerse !== undefined && key.name === 'char' && key.char === 'f') {
      return this.confirmCommentaryStep(ctx);
    }
    return undefined;
  }

  /** `esc` from an open dictionary entry — back to that letter's entry list. */
  private dictionaryReadingKey(key: Key): ScreenResult | undefined {
    if (key.name !== 'escape') return undefined;
    this.studyView = 'dictionaryEntries';
    return { kind: 'redraw' };
  }

  /** `esc` from an open book section — back to the table of contents it came from. */
  private bookReadingKey(key: Key): ScreenResult | undefined {
    if (key.name !== 'escape') return undefined;
    this.studyView = 'bookSections';
    return { kind: 'redraw' };
  }

  /**
   * `o` — a plain menu: `↑`/`↓` move `optionsSelected`, `←`/`→` step that
   * row's value (`stepOptionRow`), `enter` is a `→` alias for whoever reaches
   * for it out of habit. Replaces the old "type a number, Enter cycles it" —
   * see the class docblock and the Navigation requirement it answers.
   */
  private optionsKey(key: Key, ctx: ScreenContext): ScreenResult | undefined {
    if (key.name === 'escape') {
      this.studyView = 'hints';
      return { kind: 'redraw' };
    }
    if (key.name === 'up') {
      this.optionsSelected = Math.max(0, this.optionsSelected - 1);
      return { kind: 'redraw' };
    }
    if (key.name === 'down') {
      this.optionsSelected = Math.min(OPTION_ROWS.length - 1, this.optionsSelected + 1);
      return { kind: 'redraw' };
    }
    const row = OPTION_ROWS[this.optionsSelected];
    if (row === undefined) return undefined;
    if (key.name === 'left') return stepOptionRow(row, ctx, -1);
    if (key.name === 'right' || key.name === 'enter') return stepOptionRow(row, ctx, 1);
    return undefined;
  }

  /**
   * `b` — the bookmark list. A typed row number plus a letter acts on that
   * bookmark (`a`dd needs none — it always targets the cursor verse); `Enter`
   * with a row typed is a plain jump, like every other picker's numbers.
   *
   * Not a `PICKER_VIEWS` member: those all share "type a number, Enter picks
   * it", and this view layers several more actions onto the same buffer,
   * which the shared `pickerKey`/`pickerSelect` have no room for.
   */
  private bookmarksKey(key: Key, ctx: ScreenContext): ScreenResult | undefined {
    // Reaching here at all means the last key was not `/` — the one path
    // that completes a pending rename (`applyBookmarkRename`, via `submit`).
    // Any other keystroke abandons it, so a stale target from an earlier `r`
    // can never survive to consume some later, unrelated line. `r` itself
    // re-arms it below, after this clears.
    this.bookmarkRenameTarget = undefined;

    if (key.name === 'escape') {
      this.studyView = 'hints';
      this.pickerBuffer = '';
      this.bookmarkDeleteConfirm = undefined;
      return { kind: 'redraw' };
    }
    if (key.name === 'backspace') {
      this.pickerBuffer = this.pickerBuffer.slice(0, -1);
      return { kind: 'redraw' };
    }
    if (key.name === 'char' && key.char !== undefined && /^[0-9]$/.test(key.char)) {
      this.pickerBuffer = (this.pickerBuffer + key.char).slice(0, 2);
      this.bookmarkDeleteConfirm = undefined;
      return { kind: 'redraw' };
    }
    if (key.name === 'enter') return this.jumpToBookmark(ctx);
    if (key.name === 'char' && key.char === 'a') return this.addBookmarkHere(ctx);
    if (key.name === 'char' && key.char === 'r') return this.beginRenameBookmark(ctx);
    if (key.name === 'char' && key.char === 'p') return this.rePointSelectedBookmark(ctx);
    if (key.name === 'char' && key.char === 'd') return this.deleteSelectedBookmark(ctx);
    if (key.name === 'char' && key.char === '[') return this.reorderSelectedBookmark(ctx, 'up');
    if (key.name === 'char' && key.char === ']') return this.reorderSelectedBookmark(ctx, 'down');
    // Any other key falls through, same as every other numbered list.
    return undefined;
  }

  /** The bookmark the typed buffer names, or which of the two ways it failed. */
  private selectedBookmark(ctx: ScreenContext): Bookmark | 'empty' | 'missing' {
    if (this.pickerBuffer === '') return 'empty';
    const typed = Number.parseInt(this.pickerBuffer, 10);
    const bookmark = Number.isNaN(typed) ? undefined : bookmarkAt(ctx.bookmarks, typed);
    return bookmark ?? 'missing';
  }

  private jumpToBookmark(ctx: ScreenContext): ScreenAction {
    const target = this.selectedBookmark(ctx);
    this.pickerBuffer = '';
    if (target === 'empty') return { kind: 'message', text: 'Type a number, then Enter.', tone: 'error' };
    if (target === 'missing') return { kind: 'message', text: 'No such bookmark.', tone: 'error' };
    return this.jumpToVerse(ctx, target.verseId);
  }

  /** `a` — bookmark the cursor verse, named after its reference to start with (`r` renames it). */
  private addBookmarkHere(ctx: ScreenContext): ScreenAction {
    this.bookmarkDeleteConfirm = undefined;
    const name = this.formatReference(ctx, ctx.tab.cursorVerse);
    return { kind: 'bookmarks', bookmarks: addBookmark(ctx.bookmarks, name, ctx.tab.cursorVerse) };
  }

  /** `r` — wait for the shell's input line to carry the new name (see `bookmarkRenameTarget`). */
  private beginRenameBookmark(ctx: ScreenContext): ScreenAction {
    const target = this.selectedBookmark(ctx);
    this.pickerBuffer = '';
    this.bookmarkDeleteConfirm = undefined;
    if (target === 'empty') return { kind: 'message', text: 'Type a bookmark number first.', tone: 'error' };
    if (target === 'missing') return { kind: 'message', text: 'No such bookmark.', tone: 'error' };
    this.bookmarkRenameTarget = target.id;
    return { kind: 'message', text: `Renaming “${target.name}” — press / and type the new name, then Enter.` };
  }

  private applyBookmarkRename(intent: Intent, ctx: ScreenContext): ScreenAction {
    const id = this.bookmarkRenameTarget;
    if (id === undefined) return { kind: 'none' };
    const name = nameFromIntent(ctx, intent);
    if (name === undefined) {
      // Left set, deliberately: `/` and try again is the way out, not losing
      // the rename because what was typed happened to parse as something else.
      return {
        kind: 'message',
        text: 'That doesn’t look like a name — press / and try again.',
        tone: 'error',
      };
    }
    this.bookmarkRenameTarget = undefined;
    return { kind: 'bookmarks', bookmarks: renameBookmark(ctx.bookmarks, id, name) };
  }

  /** `p` — re-point the selected bookmark at the verse the cursor is on now. */
  private rePointSelectedBookmark(ctx: ScreenContext): ScreenAction {
    const target = this.selectedBookmark(ctx);
    this.pickerBuffer = '';
    this.bookmarkDeleteConfirm = undefined;
    if (target === 'empty') return { kind: 'message', text: 'Type a bookmark number first.', tone: 'error' };
    if (target === 'missing') return { kind: 'message', text: 'No such bookmark.', tone: 'error' };
    return {
      kind: 'bookmarks',
      bookmarks: rePointBookmark(ctx.bookmarks, target.id, ctx.tab.cursorVerse),
    };
  }

  /**
   * `d` — delete, but only on the second press: the first just names what
   * would go. The typed row number is deliberately *not* cleared after that
   * first press, so "press `d` again" means exactly that — the second press
   * needs nothing retyped.
   */
  private deleteSelectedBookmark(ctx: ScreenContext): ScreenAction {
    const target = this.selectedBookmark(ctx);
    if (target === 'empty') return { kind: 'message', text: 'Type a bookmark number first.', tone: 'error' };
    if (target === 'missing') {
      this.bookmarkDeleteConfirm = undefined;
      return { kind: 'message', text: 'No such bookmark.', tone: 'error' };
    }
    if (this.bookmarkDeleteConfirm === target.id) {
      this.pickerBuffer = '';
      this.bookmarkDeleteConfirm = undefined;
      return { kind: 'bookmarks', bookmarks: removeBookmark(ctx.bookmarks, target.id) };
    }
    this.bookmarkDeleteConfirm = target.id;
    return { kind: 'message', text: `Press d again to delete “${target.name}”.` };
  }

  /** `[` / `]` — move the selected bookmark one place up or down; a stop at either end does nothing. */
  private reorderSelectedBookmark(ctx: ScreenContext, direction: 'up' | 'down'): ScreenAction {
    const target = this.selectedBookmark(ctx);
    this.pickerBuffer = '';
    this.bookmarkDeleteConfirm = undefined;
    if (target === 'empty') return { kind: 'message', text: 'Type a bookmark number first.', tone: 'error' };
    if (target === 'missing') return { kind: 'message', text: 'No such bookmark.', tone: 'error' };
    return { kind: 'bookmarks', bookmarks: moveBookmark(ctx.bookmarks, target.id, direction) };
  }

  /** `Genesis 1:1` for a verse id — the default name `a` gives a new bookmark, and how a rename typed as a reference is read back. */
  private formatReference(ctx: ScreenContext, verseId: number): string {
    const { bookNumber, chapter, verse } = VerseIdHelper.parse(verseId);
    return `${ctx.library.bookName(bookNumber)} ${chapter}:${verse}`;
  }

  /**
   * Handles a key in any of `PICKER_VIEWS` — cross references, the commentary
   * list, the topics list, and one topic's verses. Each is "type a number, hit
   * Enter" (questions 5 and 6): a shared buffer and a shared key shape, with
   * only what Enter *does* differing per view (`pickerSelect`).
   */
  private pickerKey(key: Key, ctx: ScreenContext): ScreenResult | undefined {
    if (key.name === 'escape') {
      // A book's table of contents backs out one level of its own stack
      // before falling to the shared per-view target below.
      if (this.studyView === 'bookSections' && this.bookSectionStack.length > 0) {
        this.bookSectionStack = this.bookSectionStack.slice(0, -1);
        this.pickerBuffer = '';
        return { kind: 'redraw' };
      }
      this.studyView = pickerEscapeTarget(this.studyView);
      this.pickerBuffer = '';
      return { kind: 'redraw' };
    }
    if (key.name === 'backspace') {
      this.pickerBuffer = this.pickerBuffer.slice(0, -1);
      return { kind: 'redraw' };
    }
    if (key.name === 'char' && key.char !== undefined && /^[0-9]$/.test(key.char)) {
      this.pickerBuffer = (this.pickerBuffer + key.char).slice(0, pickerDigits(this.studyView));
      return { kind: 'redraw' };
    }
    if (key.name === 'enter') {
      return this.pickerSelect(ctx);
    }
    // Any other key falls through — `↑`/`↓` scroll the list (the generic
    // study-mode handler in `key()`) and `<`/`>` step the verse cursor for the
    // views that follow it (`VERSE_STEP_VIEWS`), with every such picker's rows
    // following along, since every study view follows the verse cursor.
    return undefined;
  }

  private pickerSelect(ctx: ScreenContext): ScreenAction {
    const typed = Number.parseInt(this.pickerBuffer, 10);
    this.pickerBuffer = '';
    if (Number.isNaN(typed)) return { kind: 'message', text: 'Type a number, then Enter.', tone: 'error' };

    switch (this.studyView) {
      case 'crossReferences':
        return this.jumpToCrossReference(ctx, typed);
      case 'commentaryList':
        return this.chooseCommentary(ctx, typed);
      case 'topicsList':
        return this.chooseTopic(ctx, typed);
      case 'topicVerses':
        return this.jumpToTopicVerse(ctx, typed);
      case 'dictionaryList':
        return this.chooseDictionary(ctx, typed);
      case 'dictionaryLetters':
        return this.chooseDictionaryLetter(ctx, typed);
      case 'dictionaryEntries':
        return this.chooseDictionaryEntry(ctx, typed);
      case 'bookList':
        return this.chooseBook(ctx, typed);
      case 'bookSections':
        return this.chooseBookSection(ctx, typed);
      case 'searchResults':
        return this.jumpToSearchResult(ctx, typed);
      default:
        return { kind: 'none' };
    }
  }

  /** A search result's number, Enter — a plain jump, same as a cross reference or a topic's verse. */
  private jumpToSearchResult(ctx: ScreenContext, n: number): ScreenAction {
    const hit = this.searchOutcome?.hits[n - 1];
    if (hit === undefined) return { kind: 'message', text: 'No such result.', tone: 'error' };
    return this.jumpToVerse(ctx, hit.verseId);
  }

  private chooseDictionary(ctx: ScreenContext, n: number): ScreenAction {
    const row = dictionaryListRows(ctx.library).find((r) => r.number === n);
    if (row === undefined) return { kind: 'message', text: 'No such dictionary.', tone: 'error' };

    this.dictionaryAbbreviation = row.abbreviation;
    this.dictionaryLetter = undefined;
    this.studyView = 'dictionaryLetters';
    return { kind: 'redraw' };
  }

  private chooseDictionaryLetter(ctx: ScreenContext, n: number): ScreenAction {
    if (this.dictionaryAbbreviation === undefined) {
      return { kind: 'message', text: 'No dictionary open.', tone: 'error' };
    }
    const row = dictionaryLetterRows(ctx.library, this.dictionaryAbbreviation).find((r) => r.number === n);
    if (row === undefined) return { kind: 'message', text: 'No such letter.', tone: 'error' };

    this.dictionaryLetter = row.letter;
    this.studyView = 'dictionaryEntries';
    return { kind: 'redraw' };
  }

  private chooseDictionaryEntry(ctx: ScreenContext, n: number): ScreenAction {
    if (this.dictionaryAbbreviation === undefined || this.dictionaryLetter === undefined) {
      return { kind: 'message', text: 'No letter open.', tone: 'error' };
    }
    const row = dictionaryEntryRows(ctx.library, this.dictionaryAbbreviation, this.dictionaryLetter).rows.find(
      (r) => r.number === n,
    );
    if (row === undefined) return { kind: 'message', text: 'No such entry.', tone: 'error' };

    this.dictionaryEntryKey = row.entryKey;
    this.studyView = 'dictionaryEntry';
    return { kind: 'redraw' };
  }

  private chooseBook(ctx: ScreenContext, n: number): ScreenAction {
    const row = bookListRows(ctx.library).find((r) => r.number === n);
    if (row === undefined) return { kind: 'message', text: 'No such book.', tone: 'error' };

    this.bookAbbreviation = row.abbreviation;
    this.bookSectionStack = [];
    this.studyView = 'bookSections';
    return { kind: 'redraw' };
  }

  private chooseBookSection(ctx: ScreenContext, n: number): ScreenAction {
    if (this.bookAbbreviation === undefined) return { kind: 'message', text: 'No book open.', tone: 'error' };

    const parentId = this.bookSectionStack[this.bookSectionStack.length - 1];
    const row = bookSectionRows(ctx.library, this.bookAbbreviation, parentId).find((r) => r.number === n);
    if (row === undefined) return { kind: 'message', text: 'No such section.', tone: 'error' };

    if (row.hasChildren) {
      this.bookSectionStack = [...this.bookSectionStack, row.sectionId];
      return { kind: 'redraw' };
    }
    this.bookSectionId = row.sectionId;
    this.studyView = 'bookEntry';
    return { kind: 'redraw' };
  }

  private jumpToCrossReference(ctx: ScreenContext, n: number): ScreenAction {
    const groups = crossReferenceGroups(
      ctx.library,
      ctx.tab.translation,
      ctx.tab.cursorVerse,
      ctx.theme,
      ctx.display,
    );
    const row = groups.flatMap((g) => g.rows).find((r) => r.number === n);
    if (row === undefined) return { kind: 'message', text: 'No such reference.', tone: 'error' };
    return this.jumpToVerse(ctx, row.targetVerseId);
  }

  private chooseCommentary(ctx: ScreenContext, n: number): ScreenAction {
    const rows = commentaryListRows(ctx.library, ctx.tab.cursorVerse);
    const row = rows.find((r) => r.number === n);
    if (row === undefined) return { kind: 'message', text: 'No such commentary.', tone: 'error' };

    this.commentaryModuleAbbreviation = row.abbreviation;
    this.commentaryEntryOrigin = 'commentaryList';
    this.commentaryPendingVerse = undefined;
    this.studyView = 'commentaryEntry';
    return row.abbreviation === ctx.lastCommentary
      ? { kind: 'redraw' }
      : { kind: 'lastCommentary', abbreviation: row.abbreviation };
  }

  private chooseTopic(ctx: ScreenContext, n: number): ScreenAction {
    const rows = topicListRows(ctx.library, ctx.tab.cursorVerse);
    const row = rows.find((r) => r.number === n);
    if (row === undefined) return { kind: 'message', text: 'No such topic.', tone: 'error' };

    this.topicModuleAbbreviation = row.moduleAbbreviation;
    this.topicId = row.topicId;
    this.studyView = 'topicVerses';
    return { kind: 'redraw' };
  }

  private jumpToTopicVerse(ctx: ScreenContext, n: number): ScreenAction {
    if (this.topicModuleAbbreviation === undefined || this.topicId === undefined) {
      return { kind: 'message', text: 'No topic open.', tone: 'error' };
    }
    const rows = topicVerseRows(
      ctx.library,
      ctx.tab.translation,
      this.topicModuleAbbreviation,
      this.topicId,
      ctx.theme,
      ctx.display,
    );
    const row = rows.find((r) => r.number === n);
    if (row === undefined) return { kind: 'message', text: 'No such verse.', tone: 'error' };
    return this.jumpToVerse(ctx, row.targetVerseId);
  }

  /**
   * Pop back to the hints and put the reader on `verseId` — following a cross
   * reference or a topic's verse is a plain jump, the same
   * action `pickHistory` already takes for a history row.
   */
  private jumpToVerse(ctx: ScreenContext, verseId: number): ScreenAction {
    const { bookNumber, chapter } = VerseIdHelper.parse(verseId);
    const window = Math.max(1, ctx.bodyHeight - TITLE_ROWS);
    const tab: TabState = {
      ...ctx.tab,
      bookNumber,
      chapter,
      cursorVerse: verseId,
      selectionAnchor: undefined,
      scrollOffset: 0,
    };
    const relaid = this.layout({ ...ctx, tab });
    const next: TabState =
      relaid === undefined
        ? tab
        : { ...tab, scrollOffset: clampScroll(relaid.lines, VerseIdHelper.parse(verseId).verse, 0, window) };

    this.recordHistory(ctx, next);
    this.studyView = 'hints';
    return { kind: 'tab', tab: next };
  }

  private pickHistory(ctx: ScreenContext): ScreenAction {
    const typed = Number.parseInt(this.historyBuffer, 10);
    this.historyBuffer = '';
    if (Number.isNaN(typed)) return { kind: 'message', text: 'Type a number, then Enter.', tone: 'error' };

    const arrayIndex = displayIndexToArrayIndex(this.history, typed);
    const result = navigateToIndex(this.history, arrayIndex);
    if (result === undefined) return { kind: 'message', text: 'No such history entry.', tone: 'error' };

    this.history = result.slot;
    this.studyView = 'hints';

    const { entry } = result;
    const window = Math.max(1, ctx.bodyHeight - TITLE_ROWS);
    const tab: TabState = {
      ...ctx.tab,
      bookNumber: entry.bookNumber,
      chapter: entry.chapter,
      cursorVerse: entry.verseId,
      selectionAnchor: undefined,
      scrollOffset: 0,
    };
    const relaid = this.layout({ ...ctx, tab });
    if (relaid === undefined) return { kind: 'tab', tab };
    return {
      kind: 'tab',
      tab: {
        ...tab,
        scrollOffset: clampScroll(relaid.lines, VerseIdHelper.parse(entry.verseId).verse, 0, window),
      },
    };
  }

  private ensureHistorySeeded(ctx: ScreenContext): void {
    if (this.history.entries.length > 0) return;
    this.history = addHistoryEntry(this.history, this.entryFor(ctx, ctx.tab));
  }

  private recordHistory(ctx: ScreenContext, tab: TabState, options?: { replace?: boolean }): void {
    this.history = addHistoryEntry(this.history, this.entryFor(ctx, tab), options);
  }

  private entryFor(ctx: ScreenContext, tab: TabState): HistoryEntry {
    return {
      verseId: tab.cursorVerse,
      bookNumber: tab.bookNumber,
      chapter: tab.chapter,
      bookName: ctx.library.bookName(tab.bookNumber),
    };
  }

  // --- movement --------------------------------------------------------------

  private moveVerse(ctx: ScreenContext, laid: Laid, delta: number, window: number): ScreenAction {
    const current = cursorVerseNumber(ctx.tab);
    const target = current + delta;

    if (target < 1) {
      const previous = ctx.library.navigation().getPreviousChapter(laid.chapter.bookNumber, laid.chapter.chapter);
      if (!previous.canNavigate || previous.targetBookNumber === undefined) return { kind: 'none' };
      return this.enterChapter(ctx, previous.targetBookNumber, previous.targetChapter ?? 1, 'last', window);
    }
    if (target > laid.chapter.verseCount) {
      const next = ctx.library.navigation().getNextChapter(laid.chapter.bookNumber, laid.chapter.chapter);
      if (!next.canNavigate || next.targetBookNumber === undefined) return { kind: 'none' };
      return this.enterChapter(ctx, next.targetBookNumber, next.targetChapter ?? 1, 'first', window);
    }

    return this.goToVerse(ctx, laid, target, window);
  }

  private enterChapter(
    ctx: ScreenContext,
    bookNumber: number,
    chapter: number,
    land: 'first' | 'last',
    window: number,
  ): ScreenAction {
    const tab: TabState = {
      ...ctx.tab,
      bookNumber,
      chapter,
      cursorVerse: VerseIdHelper.calculate(bookNumber, chapter, 1),
      selectionAnchor: undefined,
      scrollOffset: 0,
    };
    const relaid = this.layout({ ...ctx, tab });
    if (relaid === undefined) return { kind: 'none' };

    const verse = land === 'first' ? 1 : relaid.chapter.verseCount;
    const next: TabState = {
      ...tab,
      cursorVerse: VerseIdHelper.calculate(bookNumber, chapter, verse),
      scrollOffset: clampScroll(relaid.lines, verse, 0, window),
    };
    // Crossing a chapter boundary by reading on is a page, not a jump.
    this.recordHistory(ctx, next, { replace: true });
    return { kind: 'tab', tab: next };
  }

  private moveChapter(ctx: ScreenContext, laid: Laid, delta: 1 | -1): ScreenAction {
    const nav = ctx.library.navigation();
    const result =
      delta > 0
        ? nav.getNextChapter(laid.chapter.bookNumber, laid.chapter.chapter)
        : nav.getPreviousChapter(laid.chapter.bookNumber, laid.chapter.chapter);

    if (!result.canNavigate || result.targetBookNumber === undefined) {
      return { kind: 'message', text: result.message ?? 'Nowhere to go.' };
    }

    const next: TabState = {
      ...ctx.tab,
      bookNumber: result.targetBookNumber,
      chapter: result.targetChapter ?? 1,
      cursorVerse: result.targetVerseId ?? ctx.tab.cursorVerse,
      selectionAnchor: undefined,
      scrollOffset: 0,
    };
    this.recordHistory(ctx, next, { replace: true });
    return { kind: 'tab', tab: next };
  }

  private stepVerses(ctx: ScreenContext, laid: Laid, delta: number, window: number): ScreenAction {
    let action: ScreenAction = { kind: 'none' };
    let tab = ctx.tab;
    let current = laid;
    const step = delta > 0 ? 1 : -1;

    for (let i = 0; i < Math.abs(delta); i += 1) {
      const next = this.moveVerse({ ...ctx, tab }, current, step, window);
      if (next.kind !== 'tab') break;
      action = next;
      tab = next.tab;
      const relaid = this.layout({ ...ctx, tab });
      if (relaid === undefined) break;
      current = relaid;
    }

    return action;
  }

  private goToVerse(ctx: ScreenContext, laid: Laid, verse: number, window: number): ScreenAction {
    const clamped = Math.min(Math.max(1, verse), Math.max(1, laid.chapter.verseCount));
    const verseId = VerseIdHelper.calculate(laid.chapter.bookNumber, laid.chapter.chapter, clamped);
    const next: TabState = {
      ...ctx.tab,
      cursorVerse: verseId,
      scrollOffset: clampScroll(laid.lines, clamped, ctx.tab.scrollOffset, window),
    };
    // Same chapter as whatever is already the newest entry: this dedupes and
    // updates that entry's remembered verse in place (app/history.ts).
    this.recordHistory(ctx, next);
    return { kind: 'tab', tab: next };
  }

  private goToReference(ctx: ScreenContext, reference: ResolvedReference, window: number): ScreenAction {
    // `16-17` and `3:16-17` arrive with that range selected. The verse count is the *destination* chapter's, so it is
    // resolved before the range is clamped rather than from the chapter
    // being left.
    const bible = ctx.library.bible(ctx.tab.translation);
    const destination = bible === undefined ? undefined : ctx.library.chapter(bible, reference.book, reference.chapter);
    const selected = selectionForReference(reference, destination?.verseCount ?? 1);
    const tab: TabState = {
      ...ctx.tab,
      bookNumber: reference.book,
      chapter: reference.chapter,
      cursorVerse: selected.cursorVerse,
      selectionAnchor: selected.selectionAnchor,
      scrollOffset: 0,
    };

    const relaid = this.layout({ ...ctx, tab });
    if (relaid === undefined) {
      return { kind: 'message', text: 'That passage is not in this translation.', tone: 'error' };
    }

    const next: TabState = {
      ...tab,
      scrollOffset: clampScroll(relaid.lines, VerseIdHelper.parse(selected.cursorVerse).verse, 0, window),
    };
    // A typed reference is a deliberate jump, not a page — it appends.
    this.recordHistory(ctx, next);
    return { kind: 'tab', tab: next };
  }

  private extend(ctx: ScreenContext, laid: Laid, delta: number, window: number): ScreenAction {
    const bounds: SelectionBounds = {
      bookNumber: laid.chapter.bookNumber,
      chapter: laid.chapter.chapter,
      verseCount: laid.chapter.verseCount,
    };
    const tab = moveSelection(ctx.tab, delta, bounds);
    if (tab === ctx.tab) return { kind: 'none' };

    return {
      kind: 'tab',
      tab: {
        ...tab,
        scrollOffset: clampScroll(laid.lines, VerseIdHelper.parse(tab.cursorVerse).verse, ctx.tab.scrollOffset, window),
      },
    };
  }

  private copy(ctx: ScreenContext, laid: Laid): ScreenAction {
    const range = selectedRange(ctx.tab);
    const texts = textsIn(laid, range);
    const reference = referenceOf(laid, range);
    const text = `${reference}\n${texts.join(' ')}`;
    const result = copyToClipboard(text);
    if (!result.ok) return { kind: 'message', text: describeFailure(result), tone: 'error' };
    return {
      kind: 'message',
      text: result.unverified ? `Sent ${reference} to the terminal.` : `Copied ${reference}`,
    };
  }

  // --- layout ------------------------------------------------------------

  private dimensions(ctx: ScreenContext): Dimensions {
    const totalWidth = Math.max(MIN_PANE_WIDTH, ctx.size.columns - MARGIN * 2);
    const showRightPane = totalWidth >= RIGHT_PANE_BREAKPOINT_COLUMNS;
    if (!showRightPane) return { showRightPane, totalWidth, mainWidth: totalWidth, rightWidth: 0 };

    const rightWidth = RIGHT_PANE_WIDTH;
    const mainWidth = Math.max(MIN_PANE_WIDTH, totalWidth - rightWidth - PANE_SEPARATOR_WIDTH);
    return { showRightPane, totalWidth, mainWidth, rightWidth };
  }

  /**
   * Lay out and cache the current chapter.
   *
   * **Bug fixes, both here:**
   * - `mode` used to be hardcoded to `'paragraph'`, so the Layout setting
   *   (`ctx.tab.displayMode`) had no way to reach `layoutReading` at all —
   *   "modifying layout has no visible effect" was this line, not a rendering
   *   bug in `term/reading.ts`.
   * - The cache `key` used to omit `ctx.display.verseNumbers` and
   *   `ctx.display.breakOnVerse`. Both are read below and both change what
   *   `layoutReading` draws, so leaving them out of the key meant a change to
   *   *either one alone* was served the old, cached layout — until some other
   *   setting (say, red-letter) changed the key for an unrelated reason and
   *   the recompute picked up every pending change at once. That is exactly
   *   "break on verse does nothing, until I change something else and then it
   *   does" — a stale cache, not a missing re-render, and not fixed by adding
   *   one: an extra `redraw` action would still return the same cached `Laid`.
   */
  private layout(ctx: ScreenContext): Laid | undefined {
    const bible = ctx.library.bible(ctx.tab.translation);
    if (bible === undefined) return undefined;

    const chapter = ctx.library.chapter(bible, ctx.tab.bookNumber, ctx.tab.chapter);
    if (chapter === undefined) return undefined;

    const width = this.dimensions(ctx).mainWidth;
    const key = [
      bible.abbreviation,
      chapter.bookNumber,
      chapter.chapter,
      width,
      cursorVerseNumber(ctx.tab),
      ctx.display.redLetter,
      ctx.display.showSupplied,
      ctx.tab.displayMode,
      ctx.display.verseNumbers,
      ctx.display.breakOnVerse,
    ].join('|');
    if (this.cache !== undefined && this.cache.key === key) return this.cache.laid;

    const verses = chapter.verses.map((verse) =>
      toDisplayVerse(verse, {
        theme: ctx.theme,
        redLetter: ctx.display.redLetter,
        showSupplied: ctx.display.showSupplied,
      }),
    );

    const lines = layoutReading(verses, {
      width,
      mode: ctx.tab.displayMode,
      theme: ctx.theme,
      cursorVerse: cursorVerseNumber(ctx.tab),
      verseNumbers: ctx.display.verseNumbers,
      breakOnVerse: ctx.display.breakOnVerse,
    });

    const laid: Laid = { bible, chapter, verses, lines };
    this.cache = { key, laid };
    return laid;
  }

  // --- the Study pane's default content -----------------------------------

  /**
   * The Study pane's content, scrolled and fitted to `width` × `height`.
   *
   * `studyScroll` is reset to `0` whenever the view, the cursor verse, the
   * width, or (for a commentary or a topic) which one is open changes —
   * `ensureStudyAnchor` below — so a stale scroll position from a different
   * verse's cross references never survives a move. Clamping happens here,
   * against the real row count, rather than in the key handler that changes
   * it: that is the only place both numbers are known at once.
   */
  private studyRows(ctx: ScreenContext, width: number, height: number): StyledLine[] {
    this.ensureStudyAnchor(ctx, width);
    const rows = this.studyContent(ctx, width);

    const max = Math.max(0, rows.length - height);
    this.studyScroll = Math.min(Math.max(0, this.studyScroll), max);

    const windowed = rows.slice(this.studyScroll, this.studyScroll + height);
    const fitted = windowed.map((r) => padLineTo(truncateLineToWidth(r, width), width));
    return padRows(fitted, height);
  }

  private studyContent(ctx: ScreenContext, width: number): StyledLine[] {
    switch (this.studyView) {
      case 'history':
        return this.historyRows(ctx);
      case 'crossReferences':
        return this.crossReferencesRows(ctx, width);
      case 'commentaryList':
        return this.commentaryListPane(ctx);
      case 'commentaryEntry':
        return this.commentaryEntryRows(ctx, width);
      case 'topicsList':
        return this.topicsListPane(ctx);
      case 'topicVerses':
        return this.topicVersesPane(ctx, width);
      case 'dictionaryList':
        return this.dictionaryListPane(ctx);
      case 'dictionaryLetters':
        return this.dictionaryLettersPane(ctx);
      case 'dictionaryEntries':
        return this.dictionaryEntriesPane(ctx);
      case 'dictionaryEntry':
        return this.dictionaryEntryPane(ctx, width);
      case 'bookList':
        return this.bookListPane(ctx);
      case 'bookSections':
        return this.bookSectionsPane(ctx);
      case 'bookEntry':
        return this.bookEntryPane(ctx, width);
      case 'options':
        return this.optionsRows(ctx);
      case 'bookmarksList':
        return this.bookmarksRows(ctx);
      case 'searchResults':
        return this.searchResultsRows(ctx, width);
      case 'hints':
        return this.hintsRows(ctx);
    }
  }

  private ensureStudyAnchor(ctx: ScreenContext, width: number): void {
    const anchor = [
      this.studyView,
      ctx.tab.cursorVerse,
      width,
      this.commentaryModuleAbbreviation ?? '',
      this.topicId ?? '',
      this.dictionaryAbbreviation ?? '',
      this.dictionaryLetter ?? '',
      this.dictionaryEntryKey ?? '',
      this.bookAbbreviation ?? '',
      this.bookSectionStack.join('.'),
      this.bookSectionId ?? '',
      this.searchOutcome?.query ?? '',
    ].join('|');
    if (anchor === this.studyAnchor) return;
    this.studyAnchor = anchor;
    this.studyScroll = 0;
  }

  /** Reading mode's shortcut legend — the right pane's bottom half, and the whole of `studyContent` for `'hints'`. */
  private hintsRows(ctx: ScreenContext): StyledLine[] {
    const counts = studyCounts(ctx, ctx.tab.cursorVerse);
    const muted = ctx.theme.muted;
    const line = (text: string): StyledLine => [{ text }];

    return [
      line(`x - Cross-References (${counts.crossReferences})`),
      line(`c - Commentaries      (${counts.commentaries})`),
      [
        { text: 'm - Last commentary  ' },
        ctx.lastCommentary === undefined
          ? { text: '(none opened yet)', style: muted }
          : { text: `(${ctx.lastCommentary})`, style: muted },
      ],
      line(`t - Topics            (${counts.topics})`),
      // No count here: "Dictionaries (2)" would mean two are installed, not
      // that two have something for this verse, which would mislead.
      line('d - Dictionaries'),
      line(`k - Books             (${counts.books})`),
      [],
      line('h - History'),
      line('o - Options'),
      // Only reachable at all on a narrow terminal (`narrowHintsPeek`'s
      // docblock): a wide one's right pane shows this list continuously, so
      // `s` has nothing to do there and the line would mislead.
      ...(this.dimensions(ctx).showRightPane ? [] : [line('s - Hide shortcuts')]),
      line(`b - Bookmarks           (${ctx.bookmarks.length})`),
      [],
      [{ text: 'alt+c, y  Copy', style: muted }],
      [{ text: '/         Search or navigate to passage', style: muted }],
      [{ text: 'n, >      Next chapter', style: muted }],
      [{ text: 'p, <      Previous chapter', style: muted }],
      [{ text: '↑         Previous verse', style: muted }],
      [{ text: '↓         Next verse', style: muted }],
      [{ text: '?         More/fewer shortcuts', style: muted }],
    ];
  }

  /** `x` — every cross reference on the cursor verse, grouped by phrase, numbered straight through. */
  private crossReferencesRows(ctx: ScreenContext, width: number): StyledLine[] {
    const groups = crossReferenceGroups(
      ctx.library,
      ctx.tab.translation,
      ctx.tab.cursorVerse,
      ctx.theme,
      ctx.display,
    );
    const title: StyledLine = [{ text: 'Cross-References', style: ctx.theme.title }];

    if (groups.length === 0) {
      const installed = ctx.library.study('cross_reference').length;
      const message =
        installed === 0
          ? 'No cross-reference module is installed.'
          : 'No cross references for this verse.';
      return [title, [], [{ text: message, style: ctx.theme.muted }]];
    }

    const rows: StyledLine[] = [title, []];
    for (const group of groups) {
      if (group.phrase !== undefined) {
        rows.push([{ text: `“${group.phrase}”`, style: ctx.theme.heading }]);
      }
      for (const row of group.rows) {
        rows.push(...this.numberedTextRow(row.number, row.label, row.text, width, ctx));
      }
      rows.push([]);
    }
    rows.push(this.pickerFooter(ctx, 'Type a number, Enter to go there'));
    return rows;
  }

  /** `c` — every installed commentary, alphabetical, with word counts and a fixed number. */
  private commentaryListPane(ctx: ScreenContext): StyledLine[] {
    const rows = commentaryListRows(ctx.library, ctx.tab.cursorVerse);
    const title: StyledLine = [{ text: 'Commentaries', style: ctx.theme.title }];

    if (rows.length === 0) {
      return [title, [], [{ text: 'No commentary is installed.', style: ctx.theme.muted }]];
    }

    const out: StyledLine[] = [title, []];
    for (const row of rows) {
      const style = row.hasEntry ? undefined : ctx.theme.muted;
      const number = String(row.number).padStart(2, '0');
      const words = row.hasEntry ? `${row.wordCount} words` : '—';
      const abbreviation = padTo(ellipsize(row.abbreviation, 6), 6);
      const wordCount = padTo(ellipsize(words, 10), 10);
      out.push([{ text: `${number}  ${abbreviation} ${wordCount} ${row.moduleName}`, style }]);
    }
    out.push([]);
    out.push(this.pickerFooter(ctx, 'Type a commentary number, Enter to read it'));
    return out;
  }

  /** The reading pane for `c` (a chosen number) or `m` (the last one opened). */
  private commentaryEntryRows(ctx: ScreenContext, width: number): StyledLine[] {
    const abbreviation = this.commentaryModuleAbbreviation;
    const module = abbreviation === undefined ? undefined : ctx.library.studyModule('commentary', abbreviation);
    if (module === undefined) {
      return [[{ text: 'No commentary is open.', style: ctx.theme.muted }]];
    }

    const header: StyledLine = [{ text: module.moduleName, style: ctx.theme.title }];
    const notice = this.commentaryStepNotice(ctx);
    const entry = bestCommentaryEntry(module, ctx.tab.cursorVerse);
    if (entry === undefined) {
      return [
        header,
        [],
        ...notice,
        [{ text: `${module.moduleName} has nothing on this verse.`, style: ctx.theme.muted }],
      ];
    }

    return [header, [], ...notice, ...layoutCommentary(entry.content, { width, theme: ctx.theme })];
  }

  /**
   * `stepStudyVerse`'s "this verse is part of the same passage" notice — see
   * `commentaryPendingVerse`. `undefined` (as `[]`) once nothing is pending.
   */
  private commentaryStepNotice(ctx: ScreenContext): readonly StyledLine[] {
    const pending = this.commentaryPendingVerse;
    if (pending === undefined) return [];
    const direction = pending > ctx.tab.cursorVerse ? 'next' : 'previous';
    return [
      [{ text: `This verse is part of the ${direction} commentary passage.`, style: ctx.theme.muted }],
      [{ text: 'Press f to show it anyway.', style: ctx.theme.muted }],
      [],
    ];
  }

  /** `t` — every topic on the cursor verse, alphabetical, numbered straight through. */
  private topicsListPane(ctx: ScreenContext): StyledLine[] {
    const rows = topicListRows(ctx.library, ctx.tab.cursorVerse);
    const title: StyledLine = [{ text: 'Topics', style: ctx.theme.title }];

    if (rows.length === 0) {
      const installed = ctx.library.study('topical_index').length;
      const message =
        installed === 0 ? 'No topical index is installed.' : 'No topics on this verse.';
      return [title, [], [{ text: message, style: ctx.theme.muted }]];
    }

    const out: StyledLine[] = [title, []];
    for (const row of rows) {
      const number = String(row.number).padStart(2, '0');
      const verses = `${row.verseCount} ${row.verseCount === 1 ? 'verse' : 'verses'}`;
      out.push([{ text: `${number}  ${padTo(ellipsize(row.name, 28), 28)} ${verses}` }]);
    }
    out.push([]);
    out.push(this.pickerFooter(ctx, 'Type a topic number, Enter to open it'));
    return out;
  }

  /** The verses under one topic, opened from `topicsListPane`. */
  private topicVersesPane(ctx: ScreenContext, width: number): StyledLine[] {
    if (this.topicModuleAbbreviation === undefined || this.topicId === undefined) {
      return [[{ text: 'No topic is open.', style: ctx.theme.muted }]];
    }

    const rows = topicVerseRows(
      ctx.library,
      ctx.tab.translation,
      this.topicModuleAbbreviation,
      this.topicId,
      ctx.theme,
      ctx.display,
    );
    const name = topicListRows(ctx.library, ctx.tab.cursorVerse).find(
      (r) => r.moduleAbbreviation === this.topicModuleAbbreviation && r.topicId === this.topicId,
    )?.name;
    const title: StyledLine = [{ text: name ?? 'Topic', style: ctx.theme.title }];

    if (rows.length === 0) {
      return [title, [], [{ text: 'No verses under this topic.', style: ctx.theme.muted }]];
    }

    const out: StyledLine[] = [title, []];
    for (const row of rows) out.push(...this.numberedTextRow(row.number, row.label, row.text, width, ctx));
    out.push([]);
    out.push(this.pickerFooter(ctx, 'Type a number, Enter to go there'));
    return out;
  }

  // --- dictionaries (`d`) -------------------------------------------------

  /** `d` — every installed dictionary, alphabetical (not verse-scoped). */
  private dictionaryListPane(ctx: ScreenContext): StyledLine[] {
    const rows = dictionaryListRows(ctx.library);
    const title: StyledLine = [{ text: 'Dictionaries', style: ctx.theme.title }];

    if (rows.length === 0) {
      return [title, [], [{ text: 'No dictionary is installed.', style: ctx.theme.muted }]];
    }

    const digits = pickerDigits(this.studyView);
    const out: StyledLine[] = [title, []];
    for (const row of rows) {
      const number = String(row.number).padStart(digits, '0');
      out.push([
        { text: `${number}  ${row.moduleName}` },
        { text: `  (${row.entryCount} entries)`, style: ctx.theme.muted },
      ]);
    }
    out.push([]);
    out.push(this.pickerFooter(ctx, 'Type a dictionary number, Enter to browse it'));
    return out;
  }

  /** The letter index (`IDictionaryRepository.getLetterIndex`) of the dictionary chosen from the list above. */
  private dictionaryLettersPane(ctx: ScreenContext): StyledLine[] {
    if (this.dictionaryAbbreviation === undefined) {
      return [[{ text: 'No dictionary is open.', style: ctx.theme.muted }]];
    }

    const rows = dictionaryLetterRows(ctx.library, this.dictionaryAbbreviation);
    const title: StyledLine = [{ text: this.dictionaryModuleName(ctx) ?? 'Dictionary', style: ctx.theme.title }];

    if (rows.length === 0) {
      return [title, [], [{ text: 'This dictionary has no entries.', style: ctx.theme.muted }]];
    }

    const digits = pickerDigits(this.studyView);
    const out: StyledLine[] = [title, []];
    for (const row of rows) {
      const number = String(row.number).padStart(digits, '0');
      out.push([{ text: `${number}  ${row.letter}` }, { text: `  (${row.count})`, style: ctx.theme.muted }]);
    }
    out.push([]);
    out.push(this.pickerFooter(ctx, 'Type a letter number, Enter to browse it'));
    return out;
  }

  /** One letter's entries — the view whose picker buffer takes four digits, not two (see the class docblock). */
  private dictionaryEntriesPane(ctx: ScreenContext): StyledLine[] {
    if (this.dictionaryAbbreviation === undefined || this.dictionaryLetter === undefined) {
      return [[{ text: 'No letter is open.', style: ctx.theme.muted }]];
    }

    const { rows, total } = dictionaryEntryRows(ctx.library, this.dictionaryAbbreviation, this.dictionaryLetter);
    const name = this.dictionaryModuleName(ctx) ?? 'Dictionary';
    const title: StyledLine = [{ text: `${name} — ${this.dictionaryLetter}`, style: ctx.theme.title }];

    if (rows.length === 0) {
      return [title, [], [{ text: 'No entries under this letter.', style: ctx.theme.muted }]];
    }

    const digits = pickerDigits(this.studyView);
    const out: StyledLine[] = [title, []];
    for (const row of rows) {
      const number = String(row.number).padStart(digits, '0');
      out.push([{ text: `${number}  ${row.word}` }]);
    }
    if (total > rows.length) {
      out.push([]);
      out.push([{ text: `Showing the first ${rows.length} of ${total}.`, style: ctx.theme.muted }]);
    }
    out.push([]);
    out.push(this.pickerFooter(ctx, 'Type an entry number, Enter to read it'));
    return out;
  }

  /** The reading view for a chosen dictionary entry — each field reuses `layoutCommentary`, same as a commentary entry. */
  private dictionaryEntryPane(ctx: ScreenContext, width: number): StyledLine[] {
    if (this.dictionaryAbbreviation === undefined || this.dictionaryEntryKey === undefined) {
      return [[{ text: 'No entry is open.', style: ctx.theme.muted }]];
    }

    const entry = dictionaryEntry(ctx.library, this.dictionaryAbbreviation, this.dictionaryEntryKey);
    if (entry === undefined) {
      return [[{ text: 'That entry could not be read.', style: ctx.theme.muted }]];
    }

    const headword = entry.word && entry.word.length > 0 ? entry.word : entry.entryKey;
    const header: StyledLine = [{ text: headword, style: ctx.theme.title }];
    const meta = [entry.transliteration, entry.pronunciation, entry.partOfSpeech].filter(
      // Core types these `string | undefined`, but its row mapping passes
      // SQL `NULL` through as `null` (Strong's entries have no pronunciation).
      (s): s is string => typeof s === 'string' && s.length > 0,
    );

    const out: StyledLine[] = [header];
    if (meta.length > 0) out.push([{ text: meta.join(' · '), style: ctx.theme.muted }]);
    out.push([]);

    const field = (label: string, content: string | null | undefined): void => {
      if (typeof content !== 'string' || content.trim().length === 0) return;
      out.push([{ text: label, style: ctx.theme.heading }]);
      out.push(...layoutCommentary(content, { width, theme: ctx.theme }));
      out.push([]);
    };

    field('Definition', entry.definition);
    field('Etymology', entry.etymology);
    field('Usage', entry.usageNotes);
    field('Semantic range', entry.semanticRange);

    if (entry.relatedWords.length > 0) {
      out.push([{ text: `Related: ${entry.relatedWords.join(', ')}`, style: ctx.theme.muted }]);
      out.push([]);
    }

    return out;
  }

  private dictionaryModuleName(ctx: ScreenContext): string | undefined {
    return dictionaryListRows(ctx.library).find((r) => r.abbreviation === this.dictionaryAbbreviation)?.moduleName;
  }

  // --- books (`k`) ---------------------------------------------------------

  /** `k` — every installed book module, alphabetical (not verse-scoped). */
  private bookListPane(ctx: ScreenContext): StyledLine[] {
    const rows = bookListRows(ctx.library);
    const title: StyledLine = [{ text: 'Books', style: ctx.theme.title }];

    if (rows.length === 0) {
      return [title, [], [{ text: 'No book is installed.', style: ctx.theme.muted }]];
    }

    const digits = pickerDigits(this.studyView);
    const out: StyledLine[] = [title, []];
    for (const row of rows) {
      const number = String(row.number).padStart(digits, '0');
      out.push([{ text: `${number}  ${row.moduleName}` }]);
    }
    out.push([]);
    out.push(this.pickerFooter(ctx, 'Type a book number, Enter to open it'));
    return out;
  }

  /**
   * One level of the open book's table of contents — the top level, or one
   * section's children, per `bookSectionStack`'s last id. `▸` marks a row
   * that opens another list rather than the section itself.
   */
  private bookSectionsPane(ctx: ScreenContext): StyledLine[] {
    if (this.bookAbbreviation === undefined) {
      return [[{ text: 'No book is open.', style: ctx.theme.muted }]];
    }

    const parentId = this.bookSectionStack[this.bookSectionStack.length - 1];
    const rows = bookSectionRows(ctx.library, this.bookAbbreviation, parentId);
    const name = bookListRows(ctx.library).find((r) => r.abbreviation === this.bookAbbreviation)?.moduleName ?? 'Book';
    const title: StyledLine = [{ text: name, style: ctx.theme.title }];

    if (rows.length === 0) {
      return [title, [], [{ text: 'This book has no sections.', style: ctx.theme.muted }]];
    }

    const digits = pickerDigits(this.studyView);
    const out: StyledLine[] = [title, []];
    for (const row of rows) {
      const number = String(row.number).padStart(digits, '0');
      const marker = row.hasChildren ? '▸' : ' ';
      out.push([{ text: `${number} ${marker} ${row.title}` }]);
    }
    out.push([]);
    out.push(this.pickerFooter(ctx, 'Type a section number, Enter to open it'));
    return out;
  }

  /** The reading view for a leaf section — `layoutCommentary` again, same as a commentary or dictionary entry. */
  private bookEntryPane(ctx: ScreenContext, width: number): StyledLine[] {
    if (this.bookAbbreviation === undefined || this.bookSectionId === undefined) {
      return [[{ text: 'No section is open.', style: ctx.theme.muted }]];
    }

    const section = bookSection(ctx.library, this.bookAbbreviation, this.bookSectionId);
    if (section === undefined) {
      return [[{ text: 'That section could not be read.', style: ctx.theme.muted }]];
    }

    const header: StyledLine = [{ text: section.title, style: ctx.theme.title }];
    return [header, [], ...layoutCommentary(section.content, { width, theme: ctx.theme })];
  }

  /** One wrapped `NN label "text"` row, shared by the cross-reference and topic-verse lists. */
  private numberedTextRow(
    number: number,
    label: string,
    text: string,
    width: number,
    ctx: ScreenContext,
  ): StyledLine[] {
    const prefix = `${String(number).padStart(2, ' ')} ${label} `;
    const tokens = [makeToken([{ text: prefix, style: ctx.theme.muted }]), ...tokenizeText(text)];
    const wrapped = wrapTokens(tokens, { width, firstIndent: 0, hangingIndent: 4 });
    return wrapped.map((line) => line.segments);
  }

  /** `Type a number, Enter to go there: 12`, the same footer every picker view ends on. */
  private pickerFooter(ctx: ScreenContext, prompt: string): StyledLine {
    return [
      { text: `${prompt}: `, style: ctx.theme.muted },
      { text: this.pickerBuffer.length > 0 ? this.pickerBuffer : '_' },
    ];
  }

  private historyRows(ctx: ScreenContext): StyledLine[] {
    const title: StyledLine = [{ text: 'History', style: ctx.theme.title }];
    const ordered = displayOrder(this.history);
    if (ordered.length === 0) {
      return [title, [], [{ text: 'Nothing visited yet this session.', style: ctx.theme.muted }]];
    }

    const rows: StyledLine[] = [title, []];
    ordered.forEach((entry, i) => {
      const arrayIndex = this.history.entries.length - 1 - i;
      const displayNumber = arrayIndexToDisplayIndex(this.history, arrayIndex);
      const current = arrayIndex === this.history.index;
      const label = `${current ? '▸' : ' '}${displayNumber} ${entry.bookName} ${entry.chapter}`;
      rows.push([{ text: label, style: current ? ctx.theme.tabActive : ctx.theme.text }]);
    });

    rows.push([]);
    rows.push([
      { text: 'Type a number, Enter to go: ', style: ctx.theme.muted },
      { text: this.historyBuffer.length > 0 ? this.historyBuffer : '_' },
    ]);
    return rows;
  }

  /** `o` — one row per setting; the selected one is marked, `←`/`→` change its value. */
  private optionsRows(ctx: ScreenContext): StyledLine[] {
    const title: StyledLine = [{ text: 'Options', style: ctx.theme.title }];
    const out: StyledLine[] = [title, []];
    OPTION_ROWS.forEach((row, i) => {
      const selected = i === this.optionsSelected;
      const style = selected ? ctx.theme.cursorVerse : undefined;
      out.push([
        { text: `${selected ? '▸' : ' '} ${padTo(row.label, 16)} `, style },
        { text: row.current(ctx), style },
      ]);
    });
    out.push([]);
    out.push([{ text: '↑↓ select a setting   ← → change its value', style: ctx.theme.muted }]);
    return out;
  }

  /** `b` — every bookmark, in the user's own order, and what each key here does. */
  private bookmarksRows(ctx: ScreenContext): StyledLine[] {
    const title: StyledLine = [{ text: 'Bookmarks', style: ctx.theme.title }];
    const out: StyledLine[] = [title, []];

    if (ctx.bookmarks.length === 0) {
      out.push([{ text: 'No bookmarks yet — press a to add this verse.', style: ctx.theme.muted }]);
    } else {
      ctx.bookmarks.forEach((bookmark, i) => {
        const number = String(i + 1).padStart(2, '0');
        out.push([
          { text: `${number}  ${padTo(ellipsize(bookmark.name, 24), 24)} ` },
          { text: this.formatReference(ctx, bookmark.verseId), style: ctx.theme.muted },
        ]);
      });
    }

    out.push([]);
    out.push([
      { text: 'a add   r rename   p re-point   d delete   [ ] reorder', style: ctx.theme.muted },
    ]);
    out.push(this.pickerFooter(ctx, 'Type a number, Enter to go there'));
    return out;
  }

  /**
   * `/` text that was not a reference — the distribution graph, then every hit, numbered like any other picker
   * (`numberedTextRow`, the same helper `topicVersesPane` uses for full verse
   * text). An empty result, an unanswerable query and a rejected one are
   * three different answers (`app/search.ts`'s own note on why), not one
   * "no results" message.
   */
  private searchResultsRows(ctx: ScreenContext, width: number): StyledLine[] {
    const outcome = this.searchOutcome;
    if (outcome === undefined) return [[{ text: 'No search has been run yet.', style: ctx.theme.muted }]];

    const title: StyledLine = [{ text: `Search: ${outcome.query}`, style: ctx.theme.title }];

    if (outcome.error !== undefined) {
      return [
        title,
        [],
        [{ text: 'That search could not be run.', style: ctx.theme.error }],
        [],
        [{ text: outcome.error, style: ctx.theme.text }],
      ];
    }
    if (outcome.unanswerable !== undefined) {
      return [
        title,
        [],
        [{ text: `${outcome.module} cannot answer that search.`, style: ctx.theme.error }],
        [],
        [{ text: outcome.unanswerable, style: ctx.theme.text }],
      ];
    }
    if (outcome.hits.length === 0) {
      return [title, [], [{ text: `No verse in ${outcome.module} matches "${outcome.query}".`, style: ctx.theme.muted }]];
    }

    const graph = distributionGraph(outcome.hits, ctx.theme, width);
    const count = outcome.hits.length === 1 ? '1 result' : `${outcome.hits.length} results`;
    const out: StyledLine[] = [
      title,
      [{ text: `${outcome.module} · ${count}`, style: ctx.theme.muted }],
      [],
      ...graph,
    ];
    outcome.hits.forEach((hit, i) => {
      out.push(...this.numberedTextRow(i + 1, hit.reference, hit.text, width, ctx));
    });
    if (outcome.hits.length >= MAX_SEARCH_RESULTS) {
      out.push([]);
      out.push([{ text: `Showing the first ${MAX_SEARCH_RESULTS} matches.`, style: ctx.theme.muted }]);
    }
    out.push([]);
    out.push(this.pickerFooter(ctx, 'Type a number, Enter to go there'));
    return out;
  }

  // --- the right pane: current verse, then the shortcut legend ------------

  /**
   * The right-hand pane: the current verse reference (and, unless the legend
   * is expanded, its text) on top, the shortcut legend on the bottom,
   * expanding to fill the pane when the legend does not otherwise fit — the
   * Layout requirement's "expandable to show more shortcuts when there are
   * more than fit".
   */
  private rightPaneRows(ctx: ScreenContext, laid: Laid, width: number, height: number): StyledLine[] {
    const cursorNum = cursorVerseNumber(ctx.tab);
    const rows: StyledLine[] = [
      [{ text: `${laid.chapter.bookName} ${laid.chapter.chapter}:${cursorNum}`, style: ctx.theme.title }],
    ];

    if (this.shortcutsExpanded) {
      rows.push([{ text: '? for the verse text', style: ctx.theme.muted }]);
    } else {
      rows.push(...laid.lines.filter((l) => l.verse === cursorNum).map((l) => l.segments));
    }
    rows.push([]);

    const shortcuts = this.shortcutLines(ctx);
    const budget = Math.max(0, height - rows.length);
    if (shortcuts.length > budget && budget > 0) {
      const shown = shortcuts.slice(0, budget - 1);
      rows.push(...shown);
      rows.push([{ text: `+${shortcuts.length - shown.length} more — ? for all`, style: ctx.theme.muted }]);
    } else {
      rows.push(...shortcuts.slice(0, budget));
    }

    return padRows(
      rows.map((r) => padLineTo(truncateLineToWidth(r, width), width)),
      height,
    );
  }

  /**
   * The shortcut legend for whatever `studyView` is active — reading mode
   * reuses `hintsRows` wholesale (it is already this shape); every study view
   * gets its own short list, built from the same view-membership sets the key
   * handlers use, so the two cannot say different things about what a key does.
   */
  private shortcutLines(ctx: ScreenContext): StyledLine[] {
    if (this.studyView === 'hints') return this.hintsRows(ctx);

    const muted = ctx.theme.muted;
    const row = (keys: string, desc: string): StyledLine => [
      { text: padTo(keys, 9) },
      { text: desc, style: muted },
    ];

    if (this.studyView === 'options') {
      return [row('↑↓', 'select a setting'), row('←→', 'change its value'), row('esc', 'back')];
    }

    const lines: StyledLine[] = [row('↑↓', 'scroll')];
    if (VERSE_STEP_VIEWS.has(this.studyView)) {
      lines.push(row('< >', this.studyView === 'commentaryEntry' ? 'verse, same commentary' : 'verse, same view'));
    }
    if (this.studyView === 'commentaryEntry' && this.commentaryPendingVerse !== undefined) {
      lines.push(row('f', 'show that verse anyway'));
    }
    if (PICKER_VIEWS.has(this.studyView)) lines.push(row('0-9 ⏎', 'open'));
    if (this.studyView === 'history') lines.push(row('0-9 ⏎', 'go there'));
    if (this.studyView === 'bookmarksList') {
      lines.push(row('0-9 ⏎', 'go there'));
      lines.push(row('a', 'add this verse'));
      lines.push(row('r', 'rename'));
      lines.push(row('p', 're-point'));
      lines.push(row('d', 'delete (twice)'));
      lines.push(row('[ ]', 'reorder'));
    }
    lines.push(row('esc', 'back'));
    return lines;
  }

  // --- the "/" popup --------------------------------------------------------

  /**
   * The overlay `view()` returns while the input line is open — replaces the
   * old permanently-open entry box (`app/frame.ts`'s docblock). Usage text,
   * plus, once something is typed, a live preview of how it classifies
   * (`classifyInput` — the same function the shell will actually call on
   * Enter, so the preview cannot say something different from what happens)
   * and up to five book names it could be the start of.
   */
  private commandPopup(ctx: ScreenContext): Overlay {
    const query = ctx.input.trim();
    const rows: StyledLine[] = [
      [{ text: 'Type a reference (john 3:16, 3:16-18, +5) or free text to search.' }],
      [{ text: 'Enter to go  ·  Esc to cancel', style: ctx.theme.muted }],
    ];

    if (query.length === 0) {
      rows.push([]);
      rows.push([{ text: 'Examples: john 3:16   3:16-18   ps 23   +5   faith', style: ctx.theme.muted }]);
      return { title: 'Go to or search', rows };
    }

    const intent = classifyInput(query, { book: ctx.tab.bookNumber, chapter: ctx.tab.chapter });
    rows.push([]);
    rows.push(this.classificationPreview(ctx, intent));

    const matches = bookSuggestions(ctx, query);
    if (matches.length > 0) {
      rows.push([]);
      rows.push([{ text: `Books: ${matches.join(', ')}`, style: ctx.theme.muted }]);
    }

    return { title: 'Go to or search', rows };
  }

  /** What Enter would do with the text typed so far, in the popup. */
  private classificationPreview(ctx: ScreenContext, intent: Intent): StyledLine {
    const style = ctx.theme.title;
    switch (intent.kind) {
      case 'reference':
        return [{ text: `→ ${formatResolvedReference(ctx, intent.reference)}`, style }];
      case 'search':
        return [{ text: `→ Search for "${intent.query}"`, style }];
      case 'step-unit':
        return [{ text: `→ ${intent.delta > 0 ? 'Next' : 'Previous'} chapter`, style }];
      case 'step-verse':
        return [
          {
            text: `→ ${intent.delta > 0 ? '+' : ''}${intent.delta} verse${Math.abs(intent.delta) === 1 ? '' : 's'}`,
            style,
          },
        ];
      case 'empty':
        return [];
    }
  }

  // --- footer hints (the narrow-terminal fallback) --------------------------

  /**
   * The one-line footer hint. On a wide terminal this is a fallback — the
   * right pane's `shortcutLines` says the same things at more leisure — but on
   * a narrow one, with no right pane, it is the only shortcut legend there is.
   */
  private hintsText(showRightPane: boolean, reading: boolean): string {
    if (this.studyView === 'options') return '↑↓ select  ← → change  esc back';
    if (this.studyView === 'history') return '↑↓ scroll  0-9 number  enter go  esc back';
    if (this.studyView === 'bookmarksList') {
      return '↑↓ scroll  0-9 number  enter go  a add  r rename  p re-point  d delete  esc back';
    }
    if (PICKER_VIEWS.has(this.studyView)) {
      const step = VERSE_STEP_VIEWS.has(this.studyView) ? '  < > verse' : '';
      return `↑↓ scroll  0-9 number  enter open${step}  esc back`;
    }
    if (this.studyView === 'commentaryEntry') {
      const confirm = this.commentaryPendingVerse === undefined ? '' : '  f show anyway';
      return `↑↓ scroll  < > verse${confirm}  esc back`;
    }
    if (this.studyView === 'dictionaryEntry' || this.studyView === 'bookEntry') {
      return '↑↓ scroll  esc back';
    }
    if (!reading) return '↑↓ scroll  esc back';
    if (showRightPane) return '↑↓ verse  n p chapter  y copy  / go to or search';
    return '↑↓ verse  s shortcuts  / go to or search';
  }
}

/** Up to five book names `query` could be the start of — the "/" popup's autocomplete. */
function bookSuggestions(ctx: ScreenContext, query: string): string[] {
  const prefix = query.toLowerCase();
  if (prefix.length === 0) return [];

  const seen = new Set<number>();
  const names: string[] = [];
  for (const [key, book] of ENGLISH_BOOK_NAMES) {
    if (!key.startsWith(prefix)) continue;
    if (seen.has(book)) continue;
    seen.add(book);
    names.push(ctx.library.bookName(book));
    if (names.length >= 5) break;
  }
  return names;
}

function status(laid: Laid, ctx: ScreenContext): string {
  const verse = cursorVerseNumber(ctx.tab);
  return `${laid.bible.abbreviation}  v${verse}/${laid.chapter.verseCount}`;
}

function emptyLibraryView(ctx: ScreenContext): ScreenView {
  const muted = { style: ctx.theme.muted };
  return {
    status: 'no module',
    body: [
      [{ text: 'No Bible module found.', style: ctx.theme.title }],
      [],
      [{ text: 'Drop a .db module into ~/.bible/modules/ and start again.', ...muted }],
    ],
    hints: 'q quit',
  };
}

function referenceOf(laid: Laid, range: VerseRange): string {
  const start = range.start;
  const end = range.end;
  const passage = start === end ? `${start}` : `${start}-${end}`;
  return `${laid.chapter.bookName} ${laid.chapter.chapter}:${passage}`;
}

function textsIn(laid: Laid, range: VerseRange): string[] {
  return laid.verses.filter((v) => v.verse >= range.start && v.verse <= range.end).map((v) => v.plainText);
}

function padRows(rows: readonly StyledLine[], height: number): StyledLine[] {
  const out = rows.slice(0, height).map((r) => [...r]);
  while (out.length < height) out.push([]);
  return out;
}

function composeSideBySide(
  mainRows: readonly StyledLine[],
  rightRows: readonly StyledLine[],
  dims: Dimensions,
  height: number,
  theme: ScreenContext['theme'],
): StyledLine[] {
  const rows: StyledLine[] = [];
  for (let i = 0; i < height; i += 1) {
    const left = padLineTo(truncateLineToWidth(mainRows[i] ?? [], dims.mainWidth), dims.mainWidth);
    const right = padLineTo(truncateLineToWidth(rightRows[i] ?? [], dims.rightWidth), dims.rightWidth);
    rows.push([...left, { text: ' │ ', style: theme.rule }, ...right]);
  }
  return rows;
}

interface StudyCounts {
  readonly crossReferences: number;
  readonly topics: number;
  readonly books: number;
  readonly commentaries: number;
}

function studyCounts(ctx: ScreenContext, verseId: number): StudyCounts {
  const crossReferences = ctx.library
    .study('cross_reference')
    .reduce((sum, m) => sum + m.repository.getEntryCount(verseId), 0);
  const topics = ctx.library
    .study('topical_index')
    .reduce((sum, m) => sum + m.repository.getTopicsByVerse(verseId).length, 0);
  // Not verse-scoped — an installed count, unlike `d`'s hint row, which
  // shows none.
  const books = ctx.library.study('book').length;
  const commentaries = ctx.library
    .study('commentary')
    .filter((m) => m.repository.getEntriesForVerse(verseId).length > 0).length;
  return { crossReferences, topics, books, commentaries };
}
