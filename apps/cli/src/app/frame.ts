/**
 * The frame every screen is drawn inside.
 *
 * Six rows of chrome:
 *
 * ```
 *   ▸John 3  Romans 8  Psalm 23                          KJV  v16/36  ¶   header
 *  ────────────────────────────────────────────────────────────────────   rule
 *   John 3                                                                body
 *   ¹⁶For God so loved the world…                                         ⋮
 *  ────────────────────────────────────────────────────────────────────   rule
 *  > 16-17█                                                               input
 *  ────────────────────────────────────────────────────────────────────   rule
 *  ↑↓ verse  < > chapter  s study  y copy                                 hints
 * ```
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

/** Rows of chrome: header, rule, rule, input, rule, hints. */
export const CHROME_ROWS = 6;

/** Below this the rules and the hints line are dropped, in that order. */
const COMPACT_ROWS = 12;
const MINIMAL_ROWS = 8;

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
   * Drawn differently in each state, because the app has exactly one mode and a
   * mode the user cannot see is a trap. Open shows the prompt and the caret;
   * closed shows what the two keys that open it are for.
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
  readonly cursor: CursorPosition;
}

/** How much room a screen's body actually gets, given the terminal. */
export function bodyMetrics(size: TerminalSize, noticeRows = 0): {
  width: number;
  height: number;
} {
  const width = Math.max(20, Math.min(size.columns - MARGIN * 2, MAX_TEXT_WIDTH));
  const height = Math.max(1, size.rows - chromeRows(size.rows) - noticeRows);
  return { width, height };
}

function chromeRows(rows: number): number {
  if (rows < MINIMAL_ROWS) return 2; // header + input only
  if (rows < COMPACT_ROWS) return 4; // header, rule, rule, input
  return CHROME_ROWS;
}

export function renderFrame(options: FrameOptions): Frame {
  const { size, theme } = options;
  const columns = Math.max(20, size.columns);
  const rows = Math.max(3, size.rows);
  const chrome = chromeRows(rows);
  const notice = options.notice ?? [];

  const bodyHeight = Math.max(0, rows - chrome - notice.length);
  const lines: StyledLine[] = [];

  lines.push(headerLine(options, columns));
  if (chrome >= 4) lines.push(ruleLine(theme, columns));

  const body = composite(options, bodyHeight, columns).slice(0, bodyHeight);
  for (const row of body) lines.push(indent(row));
  for (let i = body.length; i < bodyHeight; i += 1) lines.push([]);

  for (const row of notice) lines.push(indent(row));

  if (chrome >= 4) lines.push(ruleLine(theme, columns));
  const inputRow = lines.length;
  lines.push(inputLine(options, theme));

  if (chrome >= 6) {
    lines.push(ruleLine(theme, columns));
    lines.push(hintsLine(options, theme));
  }

  return {
    lines: lines
      .slice(0, rows)
      .map((line) => renderStyledLine(fit(line, columns), theme.depth)),
    // The hardware cursor sits after the typed text: this is a terminal, and a
    // text cursor that is not where the text is reads as a hung application.
    cursor: {
      row: inputRow,
      column: options.inputOpen ? PROMPT.length + stringWidth(options.input) : 0,
    },
  };
}

const PROMPT = '> ';

/**
 * What the input row says while the line is closed.
 *
 * Two columns wide like {@link PROMPT}, so the row does not shift as the line
 * opens and closes.
 */
const CLOSED_PROMPT = '  ';
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

function inputLine(options: FrameOptions, theme: Theme): StyledLine {
  if (options.inputOpen) {
    return [
      { text: PROMPT, style: theme.prompt },
      { text: options.input },
    ];
  }

  // Closed. This row is the only place the opening key is guaranteed to be
  // visible -- the hints line belongs to the screen and can say anything -- so it
  // states it rather than drawing an inert prompt that looks broken when typing
  // into it does nothing.
  return [
    { text: CLOSED_PROMPT, style: theme.muted },
    { text: CLOSED_HINT, style: theme.muted },
  ];
}

function hintsLine(options: FrameOptions, theme: Theme): StyledLine {
  const message = options.message;
  if (message !== undefined) {
    return [
      { text: ' ' },
      { text: message.text, style: message.tone === 'error' ? theme.error : theme.muted },
    ];
  }
  return [{ text: ' ' }, { text: options.hints, style: theme.muted }];
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
