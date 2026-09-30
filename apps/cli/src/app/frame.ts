/**
 * The frame every screen is drawn inside.
 *
 * The input line is **not permanent**. Closed — the common case — the frame
 * is header, rule, body, rule, hints:
 *
 * ```
 *   ▸John 3  Romans 8  Psalm 23                          KJV  v16/36  ¶   header
 *  ────────────────────────────────────────────────────────────────────   rule
 *   John 3                                                                body
 *   ¹⁶For God so loved the world…                                         ⋮
 *  ────────────────────────────────────────────────────────────────────   rule
 *  ↑↓ verse  < > chapter  s study  y copy  / go to or search               hints
 * ```
 *
 * `/` opens it, and the frame grows a rule and an input row (a screen typically
 * also returns an `overlay` at this point — its usage popup — which is drawn
 * over the bottom of the body, directly above the new input row):
 *
 * ```
 *  ┌─ Go to or search ─────────────────────────────────────────────────┐
 *  │ Type a reference or search text. Enter to go, Esc to cancel.       │
 *  └──────────────────────────────────────────────────────────────────┘
 *  ────────────────────────────────────────────────────────────────────   rule
 *  > 16-17█                                                               input
 * ```
 *
 * Closed, the terminal cursor is not drawn at all — see {@link Frame.cursor} —
 * which is the terminal's own way of saying nothing is being typed.
 *
 * The one thing worth stating: **no row leaves here wider than the terminal.**
 * A row that overshoots wraps, and a wrapped row shifts everything below it by
 * one, so a single miscounted column corrupts the whole frame rather than one
 * line of it. That is the failure the `padTo` discipline in `layout.ts` exists
 * to prevent, and this is the last place it can be enforced.
 */
import {
  lineWidth,
  padLineTo,
  stringWidth,
  truncateLineToWidth,
  truncateToWidth,
} from '../term/layout';
import type { CursorPosition } from '../term/screen';
import { renderStyledLine, type StyledLine, type StyledSegment, type Theme } from '../term/style';
import type { TerminalSize } from '../term/raw';
import type { Overlay } from '../screens/types';

/** Widest the reading column is allowed to get. */
export const MAX_TEXT_WIDTH = 84;

/** Columns of blank margin on each side of the body. */
export const MARGIN = 2;

/** Below this the rules and the hints line are dropped, in that order. */
const COMPACT_ROWS = 12;
const MINIMAL_ROWS = 8;

/**
 * Which chrome rows exist for a given terminal height and input state.
 *
 * The input line is not always there — see the module docblock's rewrite of
 * why the entry box is no longer permanent — so the rules either side of it
 * are conditional on it too: closed, the rule that used to separate the body
 * from the input instead separates the body straight from the hints, rather
 * than leaving two blank rules with nothing between them.
 *
 * `rows` is every row this plan spends before/after the body: `bodyMetrics`
 * and `renderFrame` both need it and must agree, which is the whole reason
 * this is a function rather than two copies of the same arithmetic.
 */
interface ChromePlan {
  readonly ruleAfterHeader: boolean;
  readonly ruleBeforeInput: boolean;
  readonly input: boolean;
  readonly ruleBeforeHints: boolean;
  readonly hints: boolean;
  /** Total rows this plan spends outside the body and the notice. */
  readonly rows: number;
}

function chromePlan(rows: number, inputOpen: boolean): ChromePlan {
  if (rows < MINIMAL_ROWS) {
    // Header, and the input line if it is open. No room for rules or hints.
    return {
      ruleAfterHeader: false,
      ruleBeforeInput: false,
      input: inputOpen,
      ruleBeforeHints: false,
      hints: false,
      rows: inputOpen ? 2 : 1,
    };
  }
  if (rows < COMPACT_ROWS) {
    // Header, a rule, and the input line if it is open. Still no hints.
    return {
      ruleAfterHeader: true,
      ruleBeforeInput: inputOpen,
      input: inputOpen,
      ruleBeforeHints: false,
      hints: false,
      rows: inputOpen ? 4 : 2,
    };
  }
  // Full chrome: header, rule, body, [rule, input], rule, hints.
  return {
    ruleAfterHeader: true,
    ruleBeforeInput: inputOpen,
    input: inputOpen,
    ruleBeforeHints: true,
    hints: true,
    rows: inputOpen ? 6 : 4,
  };
}

export interface FrameTab {
  readonly label: string;
  readonly active: boolean;
}

export interface FrameMessage {
  readonly text: string;
  readonly tone: 'info' | 'error';
}

export interface FrameOptions {
  readonly size: TerminalSize;
  readonly theme: Theme;
  readonly tabs: readonly FrameTab[];
  /** Replaces the tab strip on the left of the header, for a screen that is not a passage. */
  readonly title?: string | undefined;
  /** Right-hand header text. */
  readonly status: string;
  readonly body: readonly StyledLine[];
  readonly notice?: readonly StyledLine[] | undefined;
  readonly input: string;
  /**
   * Whether the input line is open.
   *
   * Governs whether the input row (and the rule that would separate it from
   * the rest of the frame) is drawn at all — see the module docblock. Closed
   * is the common case and reclaims that row for the body; `/` grows the
   * frame back by it.
   */
  readonly inputOpen: boolean;
  readonly hints: string;
  /** Replaces the hints line until the next keystroke. */
  readonly message?: FrameMessage | undefined;
  /** A box drawn over the lower part of the body. */
  readonly overlay?: Overlay | undefined;
}

export interface Frame {
  readonly lines: string[];
  /**
   * `undefined` while the input line is closed — nothing is being typed, so
   * the terminal's own hardware cursor is hidden rather than parked
   * somewhere arbitrary (`term/screen.ts`'s `draw` leaves it hidden when no
   * cursor is given).
   */
  readonly cursor: CursorPosition | undefined;
}

/** How much room a screen's body actually gets, given the terminal. */
export function bodyMetrics(
  size: TerminalSize,
  noticeRows = 0,
  inputOpen = false,
): {
  width: number;
  height: number;
} {
  const width = Math.max(20, Math.min(size.columns - MARGIN * 2, MAX_TEXT_WIDTH));
  const height = Math.max(1, size.rows - chromePlan(size.rows, inputOpen).rows - noticeRows);
  return { width, height };
}

export function renderFrame(options: FrameOptions): Frame {
  const { size, theme } = options;
  const columns = Math.max(20, size.columns);
  const rows = Math.max(3, size.rows);
  const plan = chromePlan(rows, options.inputOpen);
  const notice = options.notice ?? [];

  const bodyHeight = Math.max(0, rows - plan.rows - notice.length);
  const lines: StyledLine[] = [];

  lines.push(headerLine(options, columns));
  if (plan.ruleAfterHeader) lines.push(ruleLine(theme, columns));

  const body = composite(options, bodyHeight, columns).slice(0, bodyHeight);
  for (const row of body) lines.push(indent(row));
  for (let i = body.length; i < bodyHeight; i += 1) lines.push([]);

  for (const row of notice) lines.push(indent(row));

  let inputRow: number | undefined;
  if (plan.input) {
    if (plan.ruleBeforeInput) lines.push(ruleLine(theme, columns));
    inputRow = lines.length;
    lines.push(inputLine(options, theme));
  }

  if (plan.hints) {
    if (plan.ruleBeforeHints) lines.push(ruleLine(theme, columns));
    lines.push(hintsLine(options, theme));
  }

  return {
    lines: lines
      .slice(0, rows)
      .map((line) => renderStyledLine(fit(line, columns), theme.depth)),
    // The hardware cursor sits after the typed text: this is a terminal, and a
    // text cursor that is not where the text is reads as a hung application.
    cursor:
      inputRow === undefined
        ? undefined
        : { row: inputRow, column: PROMPT.length + stringWidth(options.input) },
  };
}

const PROMPT = '> ';

/** Said in the footer hints while the line is closed — see `hintsLine`. */
const CLOSED_HINT = '/ go to or search';

/**
 * Tab strip on the left, status on the right.
 *
 * The strip is truncated before the status is: a status of `KJV  v16/36` is
 * short, fixed, and tells you where you are, whereas the far end of a long tab
 * strip is the tab you are least likely to be looking for.
 */
function headerLine(options: FrameOptions, columns: number): StyledLine {
  const { theme } = options;
  const status = truncateToWidth(options.status, Math.max(0, columns - MARGIN * 2));
  const room = columns - MARGIN * 2 - stringWidth(status) - 2;

  // A screen that is not a passage names itself here instead. Showing the tab
  // strip over a search result would claim the result belongs to the tab it is
  // sitting on, and `↵` has not been pressed yet — it does not.
  const strip: StyledSegment[] =
    options.title === undefined
      ? tabStrip(options, theme)
      : [{ text: options.title, style: theme.title }];

  const trimmed = truncateLineToWidth(strip, Math.max(0, room));
  const gap = columns - MARGIN * 2 - lineWidth(trimmed) - stringWidth(status);

  return [
    { text: ' '.repeat(MARGIN) },
    ...trimmed,
    { text: ' '.repeat(Math.max(0, gap)) },
    { text: status, style: theme.muted },
  ];
}

function tabStrip(options: FrameOptions, theme: Theme): StyledSegment[] {
  const strip: StyledSegment[] = [];
  for (const tab of options.tabs) {
    if (strip.length > 0) strip.push({ text: '  ' });
    strip.push({
      text: tab.active ? `▸${tab.label}` : ` ${tab.label}`,
      style: tab.active ? theme.tabActive : theme.tabInactive,
    });
  }
  return strip;
}

/**
 * Draw the overlay box over the bottom of the body.
 *
 * Over the bottom, not the middle: the box is a list you are choosing from and
 * the input line you are typing into is directly below it, so anything else puts
 * a gap between the two halves of one action. The rows it covers are the oldest
 * ones on screen, which in the reader are the verses you have already read.
 *
 * When the box is taller than the body it wins and the body disappears — a
 * truncated list of choices is worse than no context, because you cannot tell
 * that it was truncated.
 */
function composite(
  options: FrameOptions,
  bodyHeight: number,
  columns: number,
): readonly StyledLine[] {
  const overlay = options.overlay;
  if (overlay === undefined) return options.body;

  const width = Math.max(8, Math.min(columns - MARGIN * 2, MAX_TEXT_WIDTH));
  const box = overlayBox(overlay, options.theme, width);
  if (box.length >= bodyHeight) return box.slice(0, bodyHeight);

  // Keep the *top* of the body and push the box against the input line, so the
  // rows that survive are the ones nearest the header — a passage reads down.
  const kept = options.body.slice(0, bodyHeight - box.length);
  const padding: StyledLine[] = [];
  for (let i = kept.length; i < bodyHeight - box.length; i += 1) padding.push([]);
  return [...kept, ...padding, ...box];
}

function overlayBox(overlay: Overlay, theme: Theme, width: number): StyledLine[] {
  const inner = Math.max(2, width - 4);
  const label = ` ${overlay.title} `;
  const dashes = Math.max(0, width - 2 - stringWidth(label) - 1);
  const lines: StyledLine[] = [
    [
      { text: '┌─', style: theme.rule },
      { text: truncateToWidth(label, Math.max(0, width - 3)), style: theme.title },
      { text: `${'─'.repeat(dashes)}┐`, style: theme.rule },
    ],
  ];

  for (const row of overlay.rows) {
    lines.push([
      { text: '│ ', style: theme.rule },
      ...padLineTo(truncateLineToWidth(row, inner), inner),
      { text: ' │', style: theme.rule },
    ]);
  }

  lines.push([{ text: `└${'─'.repeat(Math.max(0, width - 2))}┘`, style: theme.rule }]);
  return lines;
}

function ruleLine(theme: Theme, columns: number): StyledLine {
  return [{ text: '─'.repeat(columns), style: theme.rule }];
}

/** Only ever called while the line is open — closed, this row does not exist. */
function inputLine(options: FrameOptions, theme: Theme): StyledLine {
  return [
    { text: PROMPT, style: theme.prompt },
    { text: options.input },
  ];
}

/**
 * The hints line — and, closed, the only place the opening key is guaranteed
 * to be visible.
 *
 * With the input row gone while closed (see the module docblock), nothing
 * else says `/` opens it: a screen's own `hints` can say anything, and a
 * short terminal drops this row entirely before it drops the input row (see
 * `chromePlan`), so this is a best-effort guarantee rather than an absolute
 * one — the same trade the rest of this frame already makes under space
 * pressure.
 */
function hintsLine(options: FrameOptions, theme: Theme): StyledLine {
  const message = options.message;
  if (message !== undefined) {
    return [
      { text: ' ' },
      { text: message.text, style: message.tone === 'error' ? theme.error : theme.muted },
    ];
  }
  const text = options.inputOpen ? options.hints : `${options.hints}   ${CLOSED_HINT}`;
  return [{ text: ' ' }, { text, style: theme.muted }];
}

function indent(line: StyledLine): StyledLine {
  return line.length === 0 ? line : [{ text: ' '.repeat(MARGIN) }, ...line];
}

/**
 * Cut a row to the terminal width. Deliberately does *not* pad.
 *
 * Truncating is essential: a row one column too wide wraps, and everything
 * below it is then drawn one row lower than the diff believes — one miscounted
 * column corrupts the whole frame rather than one line of it.
 *
 * Padding would be actively harmful. `screen.ts` erases to end of line after
 * every row it rewrites, so a short row already clears what was to its right;
 * padding to full width instead makes every changed row cost `columns` bytes on
 * the wire, which is precisely the cost the renderer's diff exists to avoid.
 */
function fit(line: StyledLine, columns: number): StyledLine {
  return lineWidth(line) > columns ? truncateLineToWidth(line, columns) : line;
}
